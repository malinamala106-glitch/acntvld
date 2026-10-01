import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// POST /api/admin/chat/typing — admin heartbeat: "I'm typing".
// Body: { conversationId }
//
// Refreshes Conversation.adminTypingAt. The buyer's widget shows
// "Support is typing…" while adminTypingAt is within a few seconds of now.
// Throttled client-side; a stale timestamp simply means typing stopped.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({} as any))
    const conversationId = String(body?.conversationId || '')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }
    const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true } })
    if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    await db.conversation.update({ where: { id: conversationId }, data: { adminTypingAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
