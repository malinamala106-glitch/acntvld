import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveBuyerIdentity } from '@/lib/support-chat'

// GET /api/chat/messages — the caller's conversation + messages.
//
// Query params:
//   guestSession  — required for anonymous visitors (validated, 8-32 alnum)
//   conversationId — optional; when present, loads THAT conversation's
//                    messages (ownership re-verified — used for lazy-loading
//                    older history of previous threads).
//   before        — ISO timestamp; loads messages older than it (pagination)
//   limit         — page size (default 50, max 100)
//
// Response: { conversation, messages, hasMore, unreadCount }
//   conversation is null when the buyer hasn't picked a topic yet — that's
//   the widget's cue to show the topic picker.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const identity = await resolveBuyerIdentity(searchParams.get('guestSession') ?? undefined)
    if (!identity) {
      // Not signed in and no valid guest session → nothing to show. The
      // widget treats this as "topic picker" state (or guest session is
      // corrupted → it will regenerate one).
      return NextResponse.json({ conversation: null, messages: [], hasMore: false, unreadCount: 0 })
    }

    const userId = identity.userId
    const guestSessionId = identity.guestSessionId

    // Conversation list scoping: all threads belonging to this identity,
    // newest first. A revoked thread is hidden from the buyer (archived —
    // they see a fresh picker).
    const conversations = await db.conversation.findMany({
      where: userId ? { userId, status: { not: 'revoke' } } : { guestSessionId, status: { not: 'revoke' } },
      orderBy: { lastMessageAt: 'desc' },
      take: 20,
    })

    const requestedId = searchParams.get('conversationId')
    let convo = null as any
    if (requestedId) {
      // Lazy-load path: only threads owned by this identity are accessible
      // (strict ownership check — never trust the client-supplied id alone).
      convo = conversations.find((c) => c.id === requestedId) ?? null
    } else {
      convo = conversations[0] ?? null
    }

    if (!convo) {
      return NextResponse.json({ conversation: null, messages: [], hasMore: false, unreadCount: 0 })
    }

    const limitRaw = parseInt(searchParams.get('limit') || '50', 10)
    const limit = Math.max(1, Math.min(100, Number.isNaN(limitRaw) ? 50 : limitRaw))
    const beforeRaw = searchParams.get('before')
    const before = beforeRaw ? new Date(beforeRaw) : null
    const afterRaw = searchParams.get('after')
    const after = afterRaw ? new Date(afterRaw) : null

    // Receipts: mark admin messages delivered the moment a client fetches them.
    await db.supportMessage.updateMany({
      where: { conversationId: convo.id, senderType: 'admin', deliveredAt: null },
      data: { deliveredAt: new Date() },
    })

    // Incremental fetch (Bug 6): only messages newer than `after`, ascending.
    // Used by the 1s poll so it transfers just the new tail, not the thread.
    if (after && !Number.isNaN(after.getTime())) {
      const newer = await db.supportMessage.findMany({
        where: { conversationId: convo.id, createdAt: { gt: after } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      const ratingRow = await db.conversationRating.findUnique({ where: { conversationId: convo.id } })
      return NextResponse.json({
        conversation: await serializeBuyerConversation(convo, ratingRow?.stars ?? null),
        messages: newer,
        hasMore: false,
        unreadCount: await countUnread(convo.id),
      })
    }

    const where: any = { conversationId: convo.id }
    if (before && !Number.isNaN(before.getTime())) {
      where.createdAt = { lt: before }
    }

    const rows = await db.supportMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // one extra to detect hasMore
    })
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).reverse() // chronological order

    const ratingRow = await db.conversationRating.findUnique({ where: { conversationId: convo.id } })

    return NextResponse.json({
      conversation: await serializeBuyerConversation(convo, ratingRow?.stars ?? null),
      messages,
      hasMore,
      unreadCount: await countUnread(convo.id),
    })
  } catch {
    return NextResponse.json({ conversation: null, messages: [], hasMore: false, unreadCount: 0 }, { status: 200 })
  }
}

// Used by the widget only; admin endpoints do their own auth.
export const dynamic = 'force-dynamic'

/** Admin messages not yet read by the buyer (drives the widget badge). */
function countUnread(conversationId: string) {
  return db.supportMessage.count({ where: { conversationId, senderType: 'admin', readAt: null } })
}

/**
 * Buyer-facing conversation payload. Adds the things the widget needs to drive
 * the complete/rating flow and the page-context line: whether the conversation
 * already has a rating, and which order/product page the buyer came from.
 */
async function serializeBuyerConversation(convo: any, rating: number | null) {
  let context: { orderId: string; shortId: number | null; productName: string | null } | null = null
  if (convo.contextOrderId) {
    // The captured value may be a human order number (shortId, numeric) or the
    // raw order id — accept either.
    const numeric = /^\d+$/.test(convo.contextOrderId) ? parseInt(convo.contextOrderId, 10) : null
    const order = await db.order.findFirst({
      where: numeric != null ? { shortId: numeric } : { id: convo.contextOrderId },
      select: { id: true, shortId: true, product: { select: { name: true } } },
    })
    if (order) context = { orderId: order.id, shortId: order.shortId, productName: order.product?.name ?? null }
  }
  return {
    id: convo.id,
    topic: convo.topic,
    status: convo.status,
    createdAt: convo.createdAt,
    lastMessageAt: convo.lastMessageAt,
    rated: rating != null,
    rating,
    context,
  }
}
