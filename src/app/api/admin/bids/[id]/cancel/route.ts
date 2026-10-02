import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { safeClientMessage } from '@/lib/safe-error'

// POST /api/admin/bids/[id]/cancel
// Body: { action: 'approve' | 'reject', adminNote?: string }
// - approve: refund the locked funds to the user's balance, mark bid as APPROVED + released
// - reject: keep the bid active, mark as REJECTED (user can re-request later if they want)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { action, adminNote } = body || {}

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
    }

    const bid = await db.bid.findUnique({
      where: { id },
      include: { auction: { select: { title: true, slug: true } }, user: { select: { id: true, email: true } } },
    })
    if (!bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }
    if (bid.cancelStatus !== 'PENDING') {
      return NextResponse.json({ error: `Bid is not pending cancellation (current status: ${bid.cancelStatus}).` }, { status: 400 })
    }

    if (action === 'approve') {
      // Refund locked funds + mark bid as approved-cancelled
      const result = await db.$transaction(async (tx) => {
        // Claim the bid inside the transaction before refunding anything. The
        // `cancelStatus !== 'PENDING'` read above happens outside the
        // transaction, so without this two parallel approvals would both pass
        // it and refund the same locked funds twice.
        const claimed = await tx.bid.updateMany({
          where: { id, cancelStatus: 'PENDING' },
          data: {
            cancelStatus: 'APPROVED',
            cancelDecidedAt: new Date(),
            cancelAdminNote: adminNote ? String(adminNote).slice(0, 500) : null,
            released: true,
          },
        })
        if (claimed.count === 0) throw new Error('BID_ALREADY_DECIDED')

        // Refund the user's locked balance back to free balance
        await tx.user.update({
          where: { id: bid.userId },
          data: {
            balance: { increment: bid.amount },
            lockedBalance: { decrement: bid.amount },
          },
        })

        const updatedBid = await tx.bid.findUnique({ where: { id } })

        // Release the LockedBalance entry
        await tx.lockedBalance.updateMany({
          where: { bidId: bid.id, status: 'LOCKED' },
          data: { status: 'RELEASED', releasedAt: new Date() },
        })

        // If this bid was the current highest, recompute the auction's currentBid + currentBidderId
        const auction = await tx.auction.findUnique({ where: { id: bid.auctionId } })
        if (auction && auction.currentBidderId === bid.userId && auction.currentBid === bid.amount) {
          // Find the next-highest active bid (cancelStatus NONE or REJECTED)
          const nextTop = await tx.bid.findFirst({
            where: {
              auctionId: bid.auctionId,
              cancelStatus: { in: ['NONE', 'REJECTED'] },
              released: false,
            },
            orderBy: { amount: 'desc' },
          })
          await tx.auction.update({
            where: { id: bid.auctionId },
            data: {
              currentBid: nextTop ? nextTop.amount : auction.askingPrice,
              currentBidderId: nextTop ? nextTop.userId : null,
            },
          })
        }

        return updatedBid
      })

      // Log bid cancellation approval (under the bidder's activity)
      await logActivity({
        userId: bid.userId,
        userEmail: bid.user?.email ?? null,
        actionType: 'BID_CANCEL_APPROVED',
        action: 'Bid cancelled — funds refunded',
        description: `Admin approved your cancellation request for bid of $${bid.amount.toFixed(2)} on "${bid.auction?.title ?? 'Auction'}". Locked funds refunded to your wallet.`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('BID'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { bidId: bid.id, auctionId: bid.auctionId, auctionTitle: bid.auction?.title ?? null, amount: bid.amount, approvedBy: admin.email, adminNote: adminNote || null },
      })
      // Admin audit entry
      await logActivity({
        userId: admin.id,
        userEmail: admin.email,
        actionType: 'ADMIN_ACTION',
        action: `Approved bid cancellation ${bid.id.slice(0, 8)}`,
        description: `Admin approved cancellation of bid ($${bid.amount.toFixed(2)}) on "${bid.auction?.title ?? 'Auction'}" for user ${bid.user?.email ?? bid.userId}. Funds refunded.`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ADM'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { bidId: bid.id, auctionId: bid.auctionId, action: 'bid_cancel_approve', amount: bid.amount },
      })

      return NextResponse.json({
        bid: result,
        message: 'Cancellation approved. Locked funds refunded to the user. The user can now place a new bid on this deal.',
      })
    } else {
      // Reject the cancellation request — bid stays active. Claim it first, for
      // the same reason as the approve path.
      const claimed = await db.bid.updateMany({
        where: { id, cancelStatus: 'PENDING' },
        data: {
          cancelStatus: 'REJECTED',
          cancelDecidedAt: new Date(),
          cancelAdminNote: adminNote ? String(adminNote).slice(0, 500) : null,
        },
      })
      if (claimed.count === 0) {
        return NextResponse.json({ error: 'Bid cancellation was already decided' }, { status: 409 })
      }
      const updated = await db.bid.findUnique({ where: { id } })

      // Log rejection (under the bidder's activity)
      await logActivity({
        userId: bid.userId,
        userEmail: bid.user?.email ?? null,
        actionType: 'BID_CANCEL_REJECTED',
        action: 'Bid cancellation rejected',
        description: `Admin rejected your cancellation request for bid of $${bid.amount.toFixed(2)} on "${bid.auction?.title ?? 'Auction'}". Your bid stays active.${adminNote ? ` Note: ${adminNote}` : ''}`,
        status: 'FAILED',
        referenceId: generateReferenceId('BID'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { bidId: bid.id, auctionId: bid.auctionId, auctionTitle: bid.auction?.title ?? null, amount: bid.amount, rejectedBy: admin.email, adminNote: adminNote || null },
      })
      // Admin audit entry
      await logActivity({
        userId: admin.id,
        userEmail: admin.email,
        actionType: 'ADMIN_ACTION',
        action: `Rejected bid cancellation ${bid.id.slice(0, 8)}`,
        description: `Admin rejected cancellation of bid ($${bid.amount.toFixed(2)}) on "${bid.auction?.title ?? 'Auction'}" for user ${bid.user?.email ?? bid.userId}.`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ADM'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { bidId: bid.id, auctionId: bid.auctionId, action: 'bid_cancel_reject', amount: bid.amount },
      })

      return NextResponse.json({
        bid: updated,
        message: 'Cancellation request rejected. The bid stays active.',
      })
    }
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Lost the race against a parallel decision on the same bid.
    if (e.message === 'BID_ALREADY_DECIDED') {
      return NextResponse.json({ error: 'Bid cancellation was already decided' }, { status: 409 })
    }
    return NextResponse.json({ error: safeClientMessage(e, 'Failed to process cancellation') }, { status: 500 })
  }
}
