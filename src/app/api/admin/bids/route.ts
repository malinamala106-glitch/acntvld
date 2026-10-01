import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/bids — list all bids with cancel requests (for admin approval queue)
// Optional: ?status=PENDING to filter only pending-cancel bids
export async function GET(req: Request) {
  try {
    await requireAdmin()
    const url = new URL(req.url)
    const status = url.searchParams.get('status')

    const where: any = {}
    if (status === 'PENDING') {
      where.cancelStatus = 'PENDING'
    }

    const bids = await db.bid.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true, balance: true, lockedBalance: true } },
        auction: { select: { id: true, title: true, slug: true, image: true, endsAt: true, status: true, currentBid: true, currentBidderId: true } },
      },
    })

    return NextResponse.json({ bids })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load bids' }, { status: 500 })
  }
}
