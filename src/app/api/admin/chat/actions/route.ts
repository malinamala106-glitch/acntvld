import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  MESSAGE_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  stripHtml,
  isValidTopic,
  TOPIC_LABELS,
  parsePinnedBy,
  serializePinnedBy,
  PIN_LIMIT,
  addSystemMessage,
  logChatEvent,
} from '@/lib/support-chat'

// POST /api/admin/chat/actions — one endpoint for all conversation actions,
// dispatched by `action`. Every branch re-verifies the conversation exists
// and re-validates its inputs; nothing is trusted from the client.
//
// Actions:
//   reply  { conversationId, message }          — admin reply (senderType admin)
//   pin    { conversationId }                   — toggle pin (max 5 per admin)
//   status { conversationId, status }           — processing | complete | revoke
//   topic  { conversationId, topic }            — admin-only topic change
//   assign { conversationId, adminId | null }   — assign/unassign
//   note   { conversationId, body }             — add internal note (admin-only)
//   delete { conversationId }                   — delete conversation + messages + notes
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({} as any))
    const action = body?.action

    // Global per-admin cap; per-action tighter limits below where needed.
    const global = rateLimit({ scope: 'admin-chat:actions', identifier: admin.id, limit: 120, windowMs: 60 * 1000 })
    if (!global.ok) return rateLimitResponse(global)

    switch (action) {
      case 'reply': {
        const rl = rateLimit({ scope: 'admin-chat:reply', identifier: admin.id, limit: 60, windowMs: 60 * 1000 })
        if (!rl.ok) return rateLimitResponse(rl)
        const conversationId = String(body?.conversationId || '')
        const text = stripHtml(String(body?.message || '')).slice(0, MESSAGE_MAX_LENGTH)
        if (!conversationId || !text) {
          return NextResponse.json({ error: 'conversationId and message required' }, { status: 400 })
        }
        const convo = await db.conversation.findUnique({ where: { id: conversationId } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

        const msg = await db.supportMessage.create({
          data: {
            conversationId,
            senderId: admin.id,
            senderType: 'admin',
            body: text,
          },
        })
        await db.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: msg.createdAt, unreadByUser: true, unreadByAdmin: false },
        })
        return NextResponse.json({ ok: true, message: { id: msg.id, createdAt: msg.createdAt, body: msg.body, senderType: 'admin' } })
      }

      case 'pin': {
        const conversationId = String(body?.conversationId || '')
        const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, pinnedBy: true } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        const pins = parsePinnedBy(convo.pinnedBy)
        const has = pins.includes(admin.id)
        let next: string[]
        if (has) {
          next = pins.filter((id) => id !== admin.id)
        } else {
          if (pins.length >= PIN_LIMIT) {
            return NextResponse.json({ error: `You can pin up to ${PIN_LIMIT} conversations. Unpin one first.` }, { status: 400 })
          }
          next = [...pins, admin.id]
        }
        const updated = await db.conversation.update({ where: { id: conversationId }, data: { pinnedBy: serializePinnedBy(next) } })
        return NextResponse.json({ ok: true, pinned: !has, pinnedBy: parsePinnedBy(updated.pinnedBy) })
      }

      case 'status': {
        const conversationId = String(body?.conversationId || '')
        const status = body?.status
        if (!['processing', 'complete', 'revoke'].includes(status)) {
          return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        const convo = await db.conversation.findUnique({ where: { id: conversationId } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        if (convo.status === status) {
          return NextResponse.json({ ok: true, status, unchanged: true })
        }

        const updated = await db.conversation.update({ where: { id: conversationId }, data: { status } })

        // Buyer-visible system message on completion. This is the ONE place
        // completion is announced — the widget no longer renders its own copy
        // (that was the duplicate the buyer saw twice).
        if (status === 'complete') {
          await addSystemMessage(conversationId, '[System] Conversation marked as complete.')
        }

        await logChatEvent({
          req,
          admin: { id: admin.id, email: admin.email },
          action: `Support conversation ${status}`,
          conversationId,
          description: `Admin ${admin.email} set conversation ${conversationId} status: ${convo.status} → ${status}`,
          metadata: { conversationId, from: convo.status, to: status },
        })
        return NextResponse.json({ ok: true, status: updated.status })
      }

      case 'topic': {
        const conversationId = String(body?.conversationId || '')
        if (!isValidTopic(body?.topic)) {
          return NextResponse.json({ error: 'Invalid topic' }, { status: 400 })
        }
        const convo = await db.conversation.findUnique({ where: { id: conversationId } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        const from = convo.topic
        const updated = await db.conversation.update({ where: { id: conversationId }, data: { topic: body.topic } })
        await addSystemMessage(conversationId, `[System] Topic changed: ${TOPIC_LABELS[body.topic]}`)
        await logChatEvent({
          req,
          admin: { id: admin.id, email: admin.email },
          action: 'Support conversation topic changed',
          conversationId,
          description: `Admin ${admin.email} changed conversation ${conversationId} topic: ${from} → ${body.topic}`,
          metadata: { conversationId, from, to: body.topic },
        })
        return NextResponse.json({ ok: true, topic: updated.topic })
      }

      case 'assign': {
        const conversationId = String(body?.conversationId || '')
        const adminId = body?.adminId ? String(body.adminId) : null
        const convo = await db.conversation.findUnique({ where: { id: conversationId } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        if (adminId) {
          const target = await db.user.findFirst({ where: { id: adminId, role: 'ADMIN' }, select: { id: true, email: true } })
          if (!target) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
        }
        const updated = await db.conversation.update({ where: { id: conversationId }, data: { assignedTo: adminId } })
        await logChatEvent({
          req,
          admin: { id: admin.id, email: admin.email },
          action: adminId ? 'Support conversation assigned' : 'Support conversation unassigned',
          conversationId,
          description: `Admin ${admin.email} ${adminId ? `assigned conversation ${conversationId} to ${adminId}` : `unassigned conversation ${conversationId}`}`,
          metadata: { conversationId, from: convo.assignedTo, to: adminId },
        })
        return NextResponse.json({ ok: true, assignedTo: updated.assignedTo })
      }

      case 'note': {
        const conversationId = String(body?.conversationId || '')
        const noteText = stripHtml(String(body?.body || '')).slice(0, NOTE_MAX_LENGTH)
        if (!conversationId || !noteText) {
          return NextResponse.json({ error: 'conversationId and body required' }, { status: 400 })
        }
        const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        const rl = rateLimit({ scope: 'admin-chat:note', identifier: admin.id, limit: 30, windowMs: 60 * 1000 })
        if (!rl.ok) return rateLimitResponse(rl)
        const note = await db.messageNote.create({
          data: { conversationId, adminId: admin.id, body: noteText },
        })
        return NextResponse.json({ ok: true, note: { id: note.id, body: note.body, createdAt: note.createdAt, adminEmail: admin.email } })
      }

      case 'delete': {
        const conversationId = String(body?.conversationId || '')
        const convo = await db.conversation.findUnique({ where: { id: conversationId } })
        if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        await db.conversation.delete({ where: { id: conversationId } }) // messages + notes cascade
        await logChatEvent({
          req,
          admin: { id: admin.id, email: admin.email },
          action: 'Support conversation deleted',
          description: `Admin ${admin.email} deleted conversation ${conversationId} (topic ${convo.topic}, status ${convo.status})`,
          metadata: { conversationId, topic: convo.topic, status: convo.status },
        })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
