import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  resolveBuyerIdentity,
  addSystemMessage,
  TOPIC_LABELS,
  MESSAGE_MAX_LENGTH,
  stripHtml,
  serializeAttachmentMeta,
  logChatEvent,
} from '@/lib/support-chat'

// POST /api/chat/send — buyer (or guest) sends a message into their
// conversation. HTML is stripped server-side; the body is always rendered as
// plain text on both ends, so stored content can never execute.
//
// Body: { message: string, guestSession?: string, attachmentUrl?, attachmentMeta? }
//   attachmentUrl must match the exact URL shape returned by
//   POST /api/chat/upload; attachmentMeta is { name, size, mime } used to
//   render the file card. Attachment-only messages (no text) are allowed.
//
// Behavior on closed conversations:
//   complete → replying reopens the conversation (back to processing) and a
//              system message notes the reopen.
//   revoke   → replying starts a fresh conversation (the old one stays
//              archived for the admin).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const identity = await resolveBuyerIdentity(body?.guestSession)
    if (!identity) {
      return NextResponse.json({ error: 'Authentication or valid guest session required' }, { status: 401 })
    }

    const raw = typeof body?.message === 'string' ? body.message : ''
    const text = stripHtml(raw).slice(0, MESSAGE_MAX_LENGTH)

    const attachmentUrlRaw = typeof body?.attachmentUrl === 'string' ? body.attachmentUrl : ''
    const attachmentUrl = /^\/uploads\/chat\/[A-Za-z0-9._-]+$/.test(attachmentUrlRaw) ? attachmentUrlRaw : null
    const attachmentMeta = attachmentUrl ? normalizeAttachmentMeta(body?.attachmentMeta) : null

    if (!text && !attachmentUrl) {
      return NextResponse.json({ error: 'Message or attachment required' }, { status: 400 })
    }

    // Anti-flood: 30 messages per minute per user/guest.
    const userId = identity.userId
    const guestSessionId = identity.guestSessionId
    const flood = rateLimit({
      scope: 'chat:send',
      identifier: userId ?? `guest_${guestSessionId}`,
      limit: 30,
      windowMs: 60 * 1000,
    })
    if (!flood.ok) {
      return rateLimitResponse(flood, 'You are sending messages too quickly. Please slow down.')
    }

    // Ownership: the conversation is looked up from the caller's identity —
    // never from a client-supplied conversation id.
    let convo = userId
      ? await db.conversation.findFirst({ where: { userId }, orderBy: { lastMessageAt: 'desc' } })
      : await db.conversation.findFirst({ where: { guestSessionId }, orderBy: { lastMessageAt: 'desc' } })

    if (!convo) {
      return NextResponse.json({ error: 'Pick a topic to start the conversation first' }, { status: 400 })
    }

    if (convo.status === 'revoke') {
      // Archived — a reply is really a request to start over.
      const fresh = await db.conversation.create({
        data: {
          userId: userId ?? null,
          guestSessionId: userId ? null : guestSessionId,
          topic: convo.topic,
          status: 'processing',
          guestIp: clientIp(req),
          guestUserAgent: req.headers.get('user-agent'),
        },
      })
      await addSystemMessage(fresh.id, `[System] Topic: ${TOPIC_LABELS[convo.topic as keyof typeof TOPIC_LABELS] ?? convo.topic}`)
      await addSystemMessage(fresh.id, '[System] Support will reply shortly. Please describe your issue.')
      convo = fresh
    } else if (convo.status === 'complete') {
      // Replying to a completed conversation reopens it (buyer-visible note).
      await db.conversation.update({ where: { id: convo.id }, data: { status: 'processing' } })
      await addSystemMessage(convo.id, '[System] Conversation reopened by buyer.')
      convo.status = 'processing'
    }

    const msg = await db.supportMessage.create({
      data: {
        conversationId: convo.id,
        senderId: userId,
        senderType: userId ? 'user' : 'guest',
        body: text,
        attachmentUrl,
        attachmentMeta,
        deliveredAt: new Date(),
      },
    })

    await db.conversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: msg.createdAt, unreadByAdmin: true, unreadByUser: false },
    })

    // Offline auto-reply: when no admin has been active recently, reassure the
    // buyer once, right after their first message.
    await maybeSendOfflineNotice(convo.id).catch(() => {})

    // Audit the send without ever logging the message body (PII protection).
    await logChatEvent({
      req,
      admin: null,
      action: userId ? 'Support message sent (buyer)' : 'Support message sent (guest)',
      conversationId: convo.id,
      description: userId
        ? `Buyer sent a support message (conversation ${convo.id})`
        : `Guest sent a support message (conversation ${convo.id})`,
      metadata: { conversationId: convo.id, messageId: msg.id, length: text.length, isGuest: !userId },
    })

    return NextResponse.json({
      message: serializeMessage(msg),
      conversationId: convo.id,
      status: convo.status,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export function serializeMessage(m: any) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderType: m.senderType,
    body: m.body,
    attachmentUrl: m.attachmentUrl,
    attachmentMeta: m.attachmentMeta ?? null,
    createdAt: m.createdAt,
    deliveredAt: m.deliveredAt ?? null,
    readAt: m.readAt,
  }
}

/** Coerce client-supplied attachment metadata into a storable JSON string. */
function normalizeAttachmentMeta(raw: unknown): string | null {
  let obj: any = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const mime = typeof obj.mime === 'string' ? obj.mime : ''
  if (!mime) return null
  const size = typeof obj.size === 'number' ? obj.size : Number(obj.size) || 0
  return serializeAttachmentMeta({ name: typeof obj.name === 'string' ? obj.name : 'attachment', size, mime })
}

/**
 * Bug 8 — offline auto-reply. "Online" is approximated by any admin action in
 * the last 15 minutes (the User model has no last-seen column). The notice is
 * written at most once per conversation, and only right after the buyer's
 * first message.
 */
async function maybeSendOfflineNotice(conversationId: string) {
  const recentAdmin = await db.activityLog.findFirst({
    where: { actionType: 'ADMIN_ACTION', createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } },
    select: { id: true },
  })
  if (recentAdmin) return

  const already = await db.supportMessage.findFirst({
    where: { conversationId, senderType: 'system', body: { contains: 'currently offline' } },
    select: { id: true },
  })
  if (already) return

  const buyerCount = await db.supportMessage.count({
    where: { conversationId, senderType: { in: ['user', 'guest'] } },
  })
  if (buyerCount <= 1) {
    await addSystemMessage(conversationId, "[System] We're currently offline. You'll get a reply within a few hours.")
  }
}
