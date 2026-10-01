import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { bidPlaceSchema } from '@/lib/validation'
import { safeClientMessage } from '@/lib/safe-error'

// POST /api/auctions/[id]/bid
// Body: { amount }
// Rules:
//   - User must be signed in.
//   - Auction must be ACTIVE and not ended.
//   - User can only have ONE active bid per auction.
//     If they already have an active bid (cancelStatus = NONE or REJECTED), they must request cancellation first.
//     Once admin approves the cancellation, they can place a new bid.
//   - Bid amount can be any positive number (even lower than current highest bid) — bidding flexibility.
//   - Locks `amount` from the user's wallet: balance -= amount, lockedBalance += amount.
//   - If this bid is the new highest (amount > auction.currentBid), update currentBid + currentBidderId.
//     Previous highest bidder's funds are NOT auto-refunded — they stay locked until they request cancellation or the auction ends.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'You must be signed in to place a bid.' }, { status: 401 })

    // Flood guard: 20 bids per minute per user (legit bidding is never this fast).
    const rl = rateLimit({ scope: 'bids:place', identifier: user.id, limit: 20, windowMs: 60 * 1000 })
    if (!rl.ok) return rateLimitResponse(rl)

    const body = await req.json()
    const parsed = bidPlaceSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ error: issue?.message || 'Bid amount must be a positive number' }, { status: 400 })
    }
    const { amount } = parsed.data

    const auction = await db.auction.findUnique({ where: { id } })
    if (!auction || !auction.isActive) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }
    if (auction.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This auction is no longer accepting bids.' }, { status: 400 })
    }
    if (new Date(auction.endsAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This auction has ended.' }, { status: 400 })
    }

    // Check if user already has an active bid on this auction
    // An "active" bid is one where cancelStatus is NONE or REJECTED (i.e. not pending cancellation, not approved-cancelled)
    const existingBid = await db.bid.findFirst({
      where: {
        auctionId: id,
        userId: user.id,
        cancelStatus: { in: ['NONE', 'REJECTED'] },
      },
    })
    if (existingBid) {
      return NextResponse.json({
        error: 'You already have an active bid on this deal. You must request to cancel it first. Once the admin approves your cancellation, you can place a new bid.',
      }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: user.id } })
      if (!u) throw new Error('User not found')

      const a = await tx.auction.findUnique({ where: { id } })
      if (!a) throw new Error('Auction not found')
      if (a.status !== 'ACTIVE') throw new Error('This auction is no longer accepting bids.')
      if (new Date(a.endsAt).getTime() <= Date.now()) throw new Error('This auction has ended.')

      // Double-check inside transaction that no active bid exists
      const innerExisting = await tx.bid.findFirst({
        where: {
          auctionId: id,
          userId: user.id,
          cancelStatus: { in: ['NONE', 'REJECTED'] },
        },
      })
      if (innerExisting) {
        throw new Error('You already have an active bid on this deal. Request cancellation first.')
      }

      // Check the user has enough free balance to lock
      if (u.balance < amount) {
        throw new Error(`Insufficient balance. You need $${amount.toFixed(2)} (free) but have $${u.balance.toFixed(2)}.`)
      }

      // Lock the bidder's funds
      await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { decrement: amount },
          lockedBalance: { increment: amount },
        },
      })

      // Create the bid record
      const bid = await tx.bid.create({
        data: {
          auctionId: id,
          userId: user.id,
          amount,
          cancelStatus: 'NONE',
        },
      })

      // Create the locked-balance record
      await tx.lockedBalance.create({
        data: {
          userId: user.id,
          auctionId: id,
          bidId: bid.id,
          amount,
          status: 'LOCKED',
        },
      })

      // Update the auction's currentBid + currentBidderId ONLY if this is the new highest bid
      let updatedAuction = a
      if (amount > a.currentBid) {
        updatedAuction = await tx.auction.update({
          where: { id },
          data: {
            currentBid: amount,
            currentBidderId: user.id,
          },
        })
      }

      return { bid, auction: updatedAuction, auctionTitle: a.title }
    })

    // Log bid placement
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'BID_PLACED',
      action: 'Placed a bid',
      description: `Bid $${amount.toFixed(2)} on "${result.auctionTitle}" — funds locked from wallet`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('BID'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: {
        bidId: result.bid.id,
        auctionId: id,
        auctionTitle: result.auctionTitle,
        amount,
        isHighest: amount > result.auction.currentBid - amount, // was this the new highest?
      },
    })

    return NextResponse.json({
      bid: result.bid,
      auction: result.auction,
      message: 'Bid placed successfully. The bid amount is now locked from your wallet. You cannot place another bid on this deal unless you request cancellation and the admin approves it.',
    })
  } catch (e: any) {
    // Business-rule throws (insufficient balance, ended auction…) pass through;
    // engine/internal errors are masked.
    return NextResponse.json({ error: safeClientMessage(e, 'Failed to place bid') }, { status: 400 })
  }
}
