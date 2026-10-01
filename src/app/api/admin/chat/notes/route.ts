import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/chat/notes?conversationId=... — internal notes for one
// conversation. Admin-only; buyers never see these.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(req.url)
    const conversationId = searchParams.get('conversationId')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }
    const notes = await db.messageNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { conversation: { select: { id: true } } },
    })
    const adminIds = Array.from(new Set(notes.map((n) => n.adminId).filter((x): x is string => !!x)))
    const admins = adminIds.length
      ? await db.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true, name: true } })
      : []
    const adminMap = new Map(admins.map((a) => [a.id, a.name || a.email]))
    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        adminName: n.adminId ? adminMap.get(n.adminId) ?? 'Admin' : 'Admin',
      })),
    })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
  }
}
