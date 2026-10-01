import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { stripHtml, MESSAGE_MAX_LENGTH } from '@/lib/support-chat'

// GET /api/admin/chat/canned — list canned responses (admin only).
export async function GET() {
  try {
    await requireAdmin()
    const items = await db.cannedResponse.findMany({ orderBy: { shortcut: 'asc' } })
    return NextResponse.json({ items })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load canned responses' }, { status: 500 })
  }
}

// POST /api/admin/chat/canned — create or update one canned response.
// Body: { shortcut: '/refund_sent', body: 'Your refund has been processed...' }
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({} as any))
    const shortcut = String(body?.shortcut || '').trim().toLowerCase()
    const text = stripHtml(String(body?.body || '')).slice(0, MESSAGE_MAX_LENGTH)
    if (!shortcut || !text) {
      return NextResponse.json({ error: 'Shortcut and body required' }, { status: 400 })
    }
    const normalized = shortcut.startsWith('/') ? shortcut : `/${shortcut}`
    if (!/^\/[a-z0-9_]{2,40}$/.test(normalized)) {
      return NextResponse.json({ error: 'Shortcut must be like /refund_sent (letters, numbers, underscores)' }, { status: 400 })
    }
    const item = await db.cannedResponse.upsert({
      where: { shortcut: normalized },
      update: { body: text, createdBy: admin.id },
      create: { shortcut: normalized, body: text, createdBy: admin.id },
    })
    return NextResponse.json({ item })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to save canned response' }, { status: 500 })
  }
}

// DELETE /api/admin/chat/canned — body { shortcut } or { id }.
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json().catch(() => ({} as any))
    if (body?.id) {
      await db.cannedResponse.delete({ where: { id: String(body.id) } }).catch(() => {})
      return NextResponse.json({ ok: true })
    }
    if (body?.shortcut) {
      const normalized = String(body.shortcut).trim().toLowerCase()
      const key = normalized.startsWith('/') ? normalized : `/${normalized}`
      await db.cannedResponse.delete({ where: { shortcut: key } }).catch(() => {})
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'id or shortcut required' }, { status: 400 })
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN' || e?.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete canned response' }, { status: 500 })
  }
}
