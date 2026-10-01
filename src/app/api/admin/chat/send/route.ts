import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

// POST /api/admin/chat/send — admin posts a reply to a specific user/guest.
//
// Body: { userId: string, message: string }
//
// Stores the message with isAdmin=true and userId=<the recipient's id>
// (NOT the admin's id) so the recipient's GET /api/chat/messages query
// picks it up alongside their own outgoing messages.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const { userId, message } = body || {}

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }
    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message too long (max 5000 chars)' }, { status: 400 })
    }

    // Reject replies to self (admin shouldn't chat with themselves).
    if (userId === admin.id) {
      return NextResponse.json({ error: "You can't message yourself" }, { status: 400 })
    }

    // If the recipient is a real user (not guest_), verify they exist.
    if (!userId.startsWith('guest_')) {
      const exists = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
      if (!exists) {
        return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
      }
    }

    const msg = await db.chatMessage.create({
      data: {
        userId,
        message: message.trim().slice(0, 5000),
        isAdmin: true,
        isRead: false, // unread from the user's perspective until they open the chat
      },
    })

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: `Admin replied to chat conversation ${userId}`,
      description: `Admin ${admin.email} replied to support chat for user ${userId}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('CHAT'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { messageId: msg.id, recipientUserId: userId, messageLength: msg.message.length },
    }).catch(() => {})

    return NextResponse.json({ message: msg })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
