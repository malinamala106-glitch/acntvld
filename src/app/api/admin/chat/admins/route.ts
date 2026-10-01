import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/chat/admins — list admin users (for the Assign menu in the
// Support Console). Admin-only.
export async function GET() {
  try {
    await requireAdmin()
    const admins = await db.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, email: true, name: true },
      orderBy: { email: 'asc' },
    })
    return NextResponse.json({ admins })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load admins' }, { status: 500 })
  }
}
