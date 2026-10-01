import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

// GET /api/bids
// Returns all bids placed by the current user, with auction info attached.
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Bounded at 100 (newest first) — one active bid per auction keeps this
    // small in practice, but never trust that forever.
    const bids = await db.bid.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        auction: {
          select: {
            id: true,
            title: true,
            slug: true,
            image: true,
            endsAt: true,
            status: true,
            currentBid: true,
            currentBidderId: true,
            askingPrice: true,
          },
        },
      },
    })

    return NextResponse.json({ bids })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load bids' }, { status: 500 })
  }
}
