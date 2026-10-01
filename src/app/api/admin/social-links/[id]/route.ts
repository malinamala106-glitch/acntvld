import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// PATCH /api/admin/social-links/[id] — update a social link
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { platform, url, label, order, isActive } = body || {}
    const data: any = {}
    if (typeof platform === 'string') data.platform = platform.trim().slice(0, 50)
    if (typeof url === 'string') data.url = url.trim().slice(0, 500)
    if (label !== undefined) data.label = label ? String(label).trim().slice(0, 100) : null
    if (typeof order === 'number') data.order = order
    if (typeof isActive === 'boolean') data.isActive = isActive
    const link = await db.socialLink.update({ where: { id }, data })
    return NextResponse.json({ link })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update social link' }, { status: 500 })
  }
}

// DELETE /api/admin/social-links/[id] — delete a social link
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    await db.socialLink.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete social link' }, { status: 500 })
  }
}
