import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/coupons — list all coupons
export async function GET() {
  try {
    await requireAdmin()
    const coupons = await db.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ coupons })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load coupons' }, { status: 500 })
  }
}

// POST /api/admin/coupons — create a new coupon
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { code, description, discountPercent, discountAmount, maxUses, expiresAt, isActive } = body || {}
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    const codeUpper = String(code).trim().toUpperCase()
    const existing = await db.coupon.findUnique({ where: { code: codeUpper } })
    if (existing) {
      return NextResponse.json({ error: 'Coupon code already exists' }, { status: 400 })
    }
    const pct = typeof discountPercent === 'number' ? Math.max(0, Math.min(100, discountPercent)) : 0
    const amt = typeof discountAmount === 'number' ? Math.max(0, discountAmount) : 0
    if (pct <= 0 && amt <= 0) {
      return NextResponse.json({ error: 'Either discountPercent or discountAmount must be > 0' }, { status: 400 })
    }
    const coupon = await db.coupon.create({
      data: {
        code: codeUpper,
        description: description ? String(description).slice(0, 500) : null,
        discountPercent: pct,
        discountAmount: amt,
        maxUses: typeof maxUses === 'number' ? Math.max(0, maxUses) : 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    })
    return NextResponse.json({ coupon })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 })
  }
}
