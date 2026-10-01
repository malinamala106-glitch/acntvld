import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { parsePinnedBy, guestLabel, maskIp } from '@/lib/support-chat'

// GET /api/admin/chat/conversations — admin conversation list for the
// Support Console.
//
// Query params:
//   tab    — all | registered | guest | mine
//   search — matches user name/email or guest session id
//   limit  — max rows (default 200)
//
// Each row carries: identity (registered vs guest), topic, status, unread
// count (admin-side), pins, assignment, and the last message preview.
// Total unread across all conversations drives the floating button badge.
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const { searchParams } = new URL(req.url)
    const tab = searchParams.get('tab') || 'all'
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const limitRaw = parseInt(searchParams.get('limit') || '200', 10)
    const limit = Math.max(1, Math.min(500, Number.isNaN(limitRaw) ? 200 : limitRaw))

    const where: any = {}
    if (tab === 'registered') where.userId = { not: null }
    if (tab === 'guest') where.guestSessionId = { not: null }
    if (tab === 'mine') where.assignedTo = admin.id

    if (search) {
      // Search by user email/name via the relation, or by guest session id.
      where.OR = [
        { user: { email: { contains: search } } },
        { user: { name: { contains: search } } },
        { guestSessionId: { contains: search } },
      ]
    }

    const convos = await db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
        assignee: { select: { id: true, email: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, senderType: true, createdAt: true },
        },
        _count: {
          select: {
            messages: { where: { senderType: { in: ['user', 'guest'] }, readAt: null } },
            notes: true,
          },
        },
      },
    })

    // First buyer/guest message per conversation — used as the list preview
    // ("what did they come in about?"), distinct from the latest message.
    const ids = convos.map((c) => c.id)
    const firsts = ids.length
      ? await db.supportMessage.findMany({
          where: { conversationId: { in: ids }, senderType: { in: ['user', 'guest'] } },
          orderBy: { createdAt: 'asc' },
          distinct: ['conversationId'],
          select: { conversationId: true, body: true, attachmentUrl: true },
        })
      : []
    const firstByConvo = new Map(firsts.map((m) => [m.conversationId, m]))

    const conversations = convos.map((c) => {
      const last = c.messages[0] ?? null
      const first = firstByConvo.get(c.id)
      const firstPreview = (first?.body || (first?.attachmentUrl ? 'Attachment' : '')).replace(/\s+/g, ' ').trim().slice(0, 120)
      return {
        id: c.id,
        isGuest: !c.userId,
        userId: c.userId,
        name: c.user?.name || c.user?.email || guestLabel(c.guestSessionId),
        email: c.user?.email ?? null,
        userStatus: c.user?.status ?? null,
        guestSessionId: c.guestSessionId,
        guestIpMasked: maskIp(c.guestIp),
        topic: c.topic,
        status: c.status,
        assignedTo: c.assignedTo,
        assignedToName: c.assignee?.email ?? null,
        pinnedBy: parsePinnedBy(c.pinnedBy),
        unreadCount: c._count.messages,
        notesCount: c._count.notes,
        firstMessage: firstPreview,
        lastMessage: last?.body ?? '',
        lastFromAdmin: last?.senderType === 'admin',
        contextOrderId: c.contextOrderId,
        contextProductId: c.contextProductId,
        lastMessageAt: c.lastMessageAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
      }
    })

    // Unread totals for the floating badge (across all conversations,
    // independent of the current tab).
    const unreadAgg = await db.conversation.aggregate({
      where: { unreadByAdmin: true },
      _count: true,
    })
    const totalUnread = await db.supportMessage.count({
      where: { senderType: { in: ['user', 'guest'] }, readAt: null, conversation: { unreadByAdmin: true } },
    })
    void unreadAgg

    return NextResponse.json({ conversations, totalUnread })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
  }
}
