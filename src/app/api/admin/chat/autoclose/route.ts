// Optional cron endpoint: auto-complete stale support conversations.
//
// POST /api/admin/chat/autoclose
//   - closes conversations with no activity for 7+ days (status → complete)
//   - stamps a system message noting the auto-close
//   - audits every transition with who/what/when
//
// Protection: requires admin auth OR a matching CRON_SECRET bearer token so
// an external scheduler (Vercel Cron / GitHub Actions / cron-job.org) can
// call it without an admin session. Visiting the URL with GET does nothing.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { addSystemMessage, logChatEvent } from '@/lib/support-chat'

const STALE_DAYS = 7

export async function POST(req: NextRequest) {
  try {
    // Auth: admin session OR cron secret.
    let authorized = false
    let actorEmail = 'system:cron'
    try {
      const admin = await requireAdmin()
      authorized = true
      actorEmail = admin.email
    } catch {
      const secret = process.env.CRON_SECRET
      const header = req.headers.get('authorization') || ''
      if (secret && header === `Bearer ${secret}`) authorized = true
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000)
    const stale = await db.conversation.findMany({
      where: { status: 'processing', lastMessageAt: { lt: cutoff } },
      select: { id: true, topic: true },
      take: 500,
    })

    let closed = 0
    for (const c of stale) {
      await db.conversation.update({ where: { id: c.id }, data: { status: 'complete' } })
      await addSystemMessage(c.id, '[System] Conversation auto-closed after inactivity.')
      await logChatEvent({
        req,
        admin: null,
        action: 'Support conversation auto-closed',
        conversationId: c.id,
        description: `Conversation ${c.id} auto-closed after ${STALE_DAYS} days of inactivity by ${actorEmail}`,
        metadata: { conversationId: c.id, reason: 'stale', days: STALE_DAYS, actor: actorEmail },
      })
      closed++
    }

    // PII protection (spec 7.5): guest conversations with no activity for
    // 90 days are deleted outright (messages + notes cascade). Registered
    // users' history is kept — it belongs to their account.
    const guestCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const staleGuests = await db.conversation.findMany({
      where: { userId: null, lastMessageAt: { lt: guestCutoff } },
      select: { id: true },
      take: 500,
    })
    for (const g of staleGuests) {
      await db.conversation.delete({ where: { id: g.id } })
      await logChatEvent({
        req,
        admin: null,
        action: 'Guest support conversation purged',
        description: `Guest conversation ${g.id} deleted after 90 days of inactivity by ${actorEmail}`,
        metadata: { conversationId: g.id, reason: 'guest-90d-retention', actor: actorEmail },
      })
    }

    return NextResponse.json({ ok: true, closed, purgedGuests: staleGuests.length })
  } catch {
    return NextResponse.json({ error: 'Auto-close failed' }, { status: 500 })
  }
}
