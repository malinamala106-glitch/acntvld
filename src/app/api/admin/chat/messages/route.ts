import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { guestLabel, maskIp } from '@/lib/support-chat'

// GET /api/admin/chat/messages?conversationId=...&before=...&limit=...
//
// Returns the full thread for a conversation plus conversation metadata.
// Side effect: marks buyer/guest messages as read by admin (clears the
// admin-side unread badge for that thread).
//
// Notes are NOT returned here (they live on their own endpoint) so a
// compromised render can't leak them into the buyer-visible thread.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(req.url)
    const conversationId = searchParams.get('conversationId')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    const convo = await db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
        assignee: { select: { id: true, email: true, name: true } },
      },
    })
    if (!convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const limitRaw = parseInt(searchParams.get('limit') || '100', 10)
    const limit = Math.max(1, Math.min(200, Number.isNaN(limitRaw) ? 100 : limitRaw))
    const beforeRaw = searchParams.get('before')
    const before = beforeRaw ? new Date(beforeRaw) : null

    const where: any = { conversationId }
    if (before && !Number.isNaN(before.getTime())) {
      where.createdAt = { lt: before }
    }

    const rows = await db.supportMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).reverse()

    // Mark buyer messages as read + delivered by admin.
    await db.supportMessage.updateMany({
      where: { conversationId, senderType: { in: ['user', 'guest'] }, readAt: null },
      data: { readAt: new Date() },
    })
    await db.supportMessage.updateMany({
      where: { conversationId, senderType: { in: ['user', 'guest'] }, deliveredAt: null },
      data: { deliveredAt: new Date() },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: { unreadByAdmin: false },
    })

    const ratingRow = await db.conversationRating.findUnique({ where: { conversationId } })

    return NextResponse.json({
      conversation: {
        id: convo.id,
        topic: convo.topic,
        status: convo.status,
        isGuest: !convo.userId,
        userId: convo.userId,
        name: convo.user?.name || convo.user?.email || guestLabel(convo.guestSessionId),
        email: convo.user?.email ?? null,
        guestSessionId: convo.guestSessionId,
        guestIpMasked: maskIp(convo.guestIp),
        assignedTo: convo.assignedTo,
        assignedToName: convo.assignee?.email ?? null,
        rating: ratingRow?.stars ?? null,
        contextOrderId: convo.contextOrderId,
        contextProductId: convo.contextProductId,
        lastMessageAt: convo.lastMessageAt.toISOString(),
        userTypingAt: convo.userTypingAt,
      },
      messages,
      hasMore,
    })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
