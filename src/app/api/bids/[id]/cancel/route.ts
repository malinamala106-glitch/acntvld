import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { safeClientMessage } from '@/lib/safe-error'

// POST /api/bids/[id]/cancel
// User requests to cancel their own bid.
// - Sets bid.cancelStatus = 'PENDING' + cancelRequestedAt = now
// - Admin must approve via /api/admin/bids/[id]/cancel (POST with action=approve|reject)
// - Cannot cancel if already PENDING (must wait for admin decision) or already APPROVED
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

    const bid = await db.bid.findUnique({
      where: { id },
      include: { auction: { select: { title: true, slug: true } } },
    })
    if (!bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }
    if (bid.userId !== user.id) {
      return NextResponse.json({ error: 'You can only cancel your own bid.' }, { status: 403 })
    }

    if (bid.cancelStatus === 'PENDING') {
      return NextResponse.json({ error: 'Your cancellation request is already pending admin review.' }, { status: 400 })
    }
    if (bid.cancelStatus === 'APPROVED') {
      return NextResponse.json({ error: 'This bid has already been cancelled.' }, { status: 400 })
    }

    // If REJECTED previously, user can re-request. If NONE, this is the first request.
    const updated = await db.bid.update({
      where: { id },
      data: {
        cancelStatus: 'PENDING',
        cancelRequestedAt: new Date(),
        cancelDecidedAt: null,
        cancelAdminNote: null,
      },
    })

    // Log the cancel request
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'BID_CANCEL_REQUESTED',
      action: 'Requested bid cancellation',
      description: `Requested to cancel bid of $${bid.amount.toFixed(2)} on "${bid.auction?.title ?? 'Auction'}" — awaiting admin approval. Funds still locked.`,
      status: 'PENDING',
      referenceId: generateReferenceId('BID'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { bidId: bid.id, auctionId: bid.auctionId, auctionTitle: bid.auction?.title ?? null, amount: bid.amount },
    })

    return NextResponse.json({
      bid: updated,
      message: 'Cancellation request submitted. Admin will review and approve/reject it shortly. Once approved, your locked funds will be refunded and you can place a new bid.',
    })
  } catch (e: any) {
    return NextResponse.json({ error: safeClientMessage(e, 'Failed to request cancellation') }, { status: 500 })
  }
}
