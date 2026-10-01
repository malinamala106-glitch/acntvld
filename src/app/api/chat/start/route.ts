import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  resolveBuyerIdentity,
  createConversation,
  addSystemMessage,
  isValidTopic,
  TOPIC_LABELS,
  safeContextId,
  logChatEvent,
} from '@/lib/support-chat'

// POST /api/chat/start — pick a topic and open a conversation.
//
// Body: { topic: 'order'|'purchase'|'deposit'|'product'|'other', guestSession?: string }
//
// Creates the conversation, seeds the two system messages:
//   [System] Topic: Deposit-related issue
//   [System] Support will reply shortly. Please describe your issue.
//
// Rate limit: max 5 conversations started per hour per IP (anti-spam-bot).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const identity = await resolveBuyerIdentity(body?.guestSession)
    if (!identity) {
      return NextResponse.json({ error: 'Topic and a valid session are required' }, { status: 400 })
    }

    if (!isValidTopic(body?.topic)) {
      return NextResponse.json({ error: 'Please choose a valid topic' }, { status: 400 })
    }

    // Anti-spam: 5 new conversations per hour per IP. Only charged when a
    // genuinely new conversation would be created — reopening/reusing an
    // existing thread is free, so page reloads can't lock a buyer out.
    const userId = identity.userId
    const guestSessionId = identity.guestSessionId
    const existing = userId
      ? await db.conversation.findFirst({ where: { userId, status: { not: 'revoke' } }, orderBy: { lastMessageAt: 'desc' } })
      : await db.conversation.findFirst({ where: { guestSessionId, status: { not: 'revoke' } }, orderBy: { lastMessageAt: 'desc' } })

    // "Start new conversation" after a completed thread forces a fresh one;
    // the old thread stays in history (read-only) for the admin.
    const forceNew = body?.forceNew === true
    if (existing && !forceNew) {
      // Topic was already chosen for this thread; admins can change it later.
      return NextResponse.json({ conversation: serializeConversation(existing), created: false })
    }

    const ip = clientIp(req)
    const convoLimit = rateLimit({ scope: 'chat:start:ip', identifier: ip, limit: 5, windowMs: 60 * 60 * 1000 })
    if (!convoLimit.ok) {
      return rateLimitResponse(convoLimit, 'Too many support conversations started. Please try again later.')
    }

    const convo = await createConversation({
      userId,
      guestSessionId,
      topic: body.topic,
      ip,
      userAgent: req.headers.get('user-agent'),
      contextOrderId: safeContextId(body?.contextOrderId),
      contextProductId: safeContextId(body?.contextProductId),
    })

    await addSystemMessage(convo.id, `[System] Topic: ${TOPIC_LABELS[body.topic]}`)
    await addSystemMessage(convo.id, '[System] Support will reply shortly. Please describe your issue.')

    // Audit: conversation started (who/what/when; message bodies never logged).
    await logChatEvent({
      req,
      admin: null,
      action: userId ? 'Support conversation started (buyer)' : 'Support conversation started (guest)',
      conversationId: convo.id,
      description: userId
        ? `Buyer started a support conversation (topic: ${body.topic})`
        : `Guest started a support conversation (topic: ${body.topic})`,
      metadata: { conversationId: convo.id, topic: body.topic, isGuest: !userId },
    })

    return NextResponse.json({ conversation: serializeConversation(convo), created: true })
  } catch {
    return NextResponse.json({ error: 'Failed to start conversation' }, { status: 500 })
  }
}

function serializeConversation(c: any) {
  return {
    id: c.id,
    topic: c.topic,
    status: c.status,
    userId: c.userId,
    guestSessionId: c.guestSessionId,
    createdAt: c.createdAt,
    lastMessageAt: c.lastMessageAt,
  }
}
