import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// POST /api/admin/auctions/[id]/unlock
// Refunds ALL locked bids for an auction back to their respective users.
// Used when the admin wants to release funds (e.g. after support contact).
// Optionally, body: { userId } to unlock only a specific user's bids.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { userId } = body || {}

    const auction = await db.auction.findUnique({ where: { id } })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Find all LOCKED locked-balance entries for this auction (optionally filtered by user)
    const where: any = { auctionId: id, status: 'LOCKED' }
    if (userId) where.userId = userId

    const lockedEntries = await db.lockedBalance.findMany({ where })

    if (lockedEntries.length === 0) {
      return NextResponse.json({ message: 'No locked funds to release.', releasedCount: 0 })
    }

    // Refund each entry — atomically
    const result = await db.$transaction(async (tx) => {
      let totalReleased = 0
      let releasedCount = 0
      for (const entry of lockedEntries) {
        // Claim the row inside the transaction before paying it out. Without
        // this, two parallel "release funds" calls both read the same LOCKED
        // rows (the findMany above is outside the transaction) and both refund
        // — the same double-credit class as the deposit-approval race.
        const claimed = await tx.lockedBalance.updateMany({
          where: { id: entry.id, status: 'LOCKED' },
          data: { status: 'RELEASED', releasedAt: new Date() },
        })
        if (claimed.count === 0) continue
        await tx.user.update({
          where: { id: entry.userId },
          data: {
            balance: { increment: entry.amount },
            lockedBalance: { decrement: entry.amount },
          },
        })
        await tx.bid.updateMany({
          where: { id: entry.bidId },
          data: { released: true },
        })
        totalReleased += entry.amount
        releasedCount += 1
      }
      return { releasedCount, totalReleased }
    })

    return NextResponse.json({
      message: `Released ${result.releasedCount} locked bid(s), total $${result.totalReleased.toFixed(2)} refunded to users.`,
      ...result,
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to unlock bids' }, { status: 500 })
  }
}
