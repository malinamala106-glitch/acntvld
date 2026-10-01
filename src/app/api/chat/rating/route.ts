import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveBuyerIdentity } from '@/lib/support-chat'

// POST /api/chat/rating — buyer (or guest) rates a completed conversation.
// Body: { conversationId, stars: 1-5, comment?: string, guestSession?: string }
//
// Rules:
//   - 1 rating per conversation (unique index enforces it)
//   - only the conversation's owner can rate it (ownership re-verified here)
//   - only conversations with status 'complete' can be rated
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const identity = await resolveBuyerIdentity(body?.guestSession)
    if (!identity) {
      return NextResponse.json({ error: 'Authentication or valid guest session required' }, { status: 401 })
    }

    const conversationId = String(body?.conversationId || '')
    const stars = Number(body?.stars)
    if (!conversationId || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return NextResponse.json({ error: 'Rating must be 1-5 stars' }, { status: 400 })
    }

    // Ownership: the rater must own the conversation.
    const convo = await db.conversation.findFirst({
      where: identity.userId
        ? { id: conversationId, userId: identity.userId }
        : { id: conversationId, guestSessionId: identity.guestSessionId },
    })
    if (!convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (convo.status !== 'complete') {
      return NextResponse.json({ error: 'Only completed conversations can be rated' }, { status: 400 })
    }

    const existing = await db.conversationRating.findUnique({ where: { conversationId } })
    if (existing) {
      return NextResponse.json({ ok: true, alreadyRated: true })
    }

    const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 500) : null
    await db.conversationRating.create({
      data: { conversationId, buyerId: identity.userId, stars, comment },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
  }
}
