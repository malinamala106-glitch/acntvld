import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// PATCH /api/admin/coupons/[id] — update a coupon
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { code, description, discountPercent, discountAmount, maxUses, expiresAt, isActive } = body || {}
    const data: any = {}
    if (typeof code === 'string') {
      const codeUpper = String(code).trim().toUpperCase()
      const existing = await db.coupon.findUnique({ where: { code: codeUpper } })
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: 'Coupon code already exists' }, { status: 400 })
      }
      data.code = codeUpper
    }
    if (description !== undefined) data.description = description ? String(description).slice(0, 500) : null
    if (typeof discountPercent === 'number') data.discountPercent = Math.max(0, Math.min(100, discountPercent))
    if (typeof discountAmount === 'number') data.discountAmount = Math.max(0, discountAmount)
    if (typeof maxUses === 'number') data.maxUses = Math.max(0, maxUses)
    if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null
    if (typeof isActive === 'boolean') data.isActive = isActive
    const coupon = await db.coupon.update({ where: { id }, data })
    return NextResponse.json({ coupon })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 })
  }
}

// DELETE /api/admin/coupons/[id] — delete a coupon
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    await db.coupon.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete coupon' }, { status: 500 })
  }
}
