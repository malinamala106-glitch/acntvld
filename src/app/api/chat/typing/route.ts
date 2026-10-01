import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveBuyerIdentity } from '@/lib/support-chat'

// POST /api/chat/typing — buyer heartbeat: "I'm typing".
// Body: { guestSession?: string }
//
// Refreshes Conversation.userTypingAt. The admin console shows "Buyer is
// typing…" while userTypingAt is within a few seconds of now. Cheap single
// update; throttled client-side to at most every 2s.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const identity = await resolveBuyerIdentity(body?.guestSession)
    if (!identity) return NextResponse.json({ ok: false }, { status: 401 })

    const convo = await db.conversation.findFirst({
      where: identity.userId
        ? { userId: identity.userId, status: { not: 'revoke' } }
        : { guestSessionId: identity.guestSessionId, status: { not: 'revoke' } },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    })
    if (!convo) return NextResponse.json({ ok: true })

    await db.conversation.update({ where: { id: convo.id }, data: { userTypingAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
