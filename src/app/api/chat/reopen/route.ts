import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveBuyerIdentity, addSystemMessage, logChatEvent } from '@/lib/support-chat'

// POST /api/chat/reopen — buyer explicitly reopens a completed conversation.
// Body: { conversationId: string, guestSession?: string }
//
// Ownership is re-verified from the caller's identity (never trusted from the
// client). Only a completed conversation can be reopened; a revoked one stays
// archived (the buyer starts a fresh conversation instead).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const identity = await resolveBuyerIdentity(body?.guestSession)
    if (!identity) {
      return NextResponse.json({ error: 'Authentication or valid guest session required' }, { status: 401 })
    }

    const conversationId = String(body?.conversationId || '')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    const convo = await db.conversation.findFirst({
      where: identity.userId
        ? { id: conversationId, userId: identity.userId }
        : { id: conversationId, guestSessionId: identity.guestSessionId },
    })
    if (!convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (convo.status !== 'complete') {
      // Already open (or revoked) — nothing to do.
      return NextResponse.json({ ok: true, status: convo.status, unchanged: true })
    }

    const updated = await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'processing', lastMessageAt: new Date() },
    })
    await addSystemMessage(conversationId, '[System] Conversation reopened.')

    await logChatEvent({
      req,
      admin: null,
      action: identity.userId ? 'Support conversation reopened (buyer)' : 'Support conversation reopened (guest)',
      conversationId,
      description: `Conversation ${conversationId} reopened by ${identity.userId ? 'buyer' : 'guest'}`,
      metadata: { conversationId, from: 'complete', to: 'processing', isGuest: !identity.userId },
    })

    return NextResponse.json({ ok: true, status: updated.status })
  } catch {
    return NextResponse.json({ error: 'Failed to reopen conversation' }, { status: 500 })
  }
}
