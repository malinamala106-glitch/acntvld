import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveBuyerIdentity } from '@/lib/support-chat'

// GET /api/chat/read — number of admin messages the buyer hasn't read yet
// (drives the unread badge on the floating chat button).
//
// POST /api/chat/read — mark all admin messages in the buyer's active
// conversation(s) as read (called when the widget is opened).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const identity = await resolveBuyerIdentity(searchParams.get('guestSession') ?? undefined)
    if (!identity) return NextResponse.json({ unread: 0 })

    const convoIds = await db.conversation.findMany({
      where: identity.userId ? { userId: identity.userId } : { guestSessionId: identity.guestSessionId },
      select: { id: true },
    })
    if (convoIds.length === 0) return NextResponse.json({ unread: 0 })

    const unread = await db.supportMessage.count({
      where: { conversationId: { in: convoIds.map((c) => c.id) }, senderType: 'admin', readAt: null },
    })
    return NextResponse.json({ unread })
  } catch {
    return NextResponse.json({ unread: 0 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const { searchParams } = new URL(req.url)
    const identity = await resolveBuyerIdentity(body?.guestSession ?? searchParams.get('guestSession') ?? undefined)
    if (!identity) return NextResponse.json({ ok: true, updated: 0 })

    const convos = await db.conversation.findMany({
      where: identity.userId ? { userId: identity.userId } : { guestSessionId: identity.guestSessionId },
      select: { id: true },
    })
    if (convos.length === 0) return NextResponse.json({ ok: true, updated: 0 })

    const result = await db.supportMessage.updateMany({
      where: { conversationId: { in: convos.map((c) => c.id) }, senderType: 'admin', readAt: null },
      data: { readAt: new Date() },
    })

    // Opening the widget clears the buyer-side unread flag.
    await db.conversation.updateMany({
      where: { id: { in: convos.map((c) => c.id) } },
      data: { unreadByUser: false },
    })

    return NextResponse.json({ ok: true, updated: result.count })
  } catch {
    return NextResponse.json({ ok: true, updated: 0 })
  }
}
