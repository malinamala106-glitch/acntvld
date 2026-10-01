import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { couponValidateSchema } from '@/lib/validation'

// POST /api/coupons/validate
// Body: { code, productId, quantity, unitPrice? }
// Returns: { valid, discountPercent, discountAmount, discountValue, newTotal, originalTotal, message }
//
// When `unitPrice` is provided (e.g. when buying from a specific batch with
// a price override), the discount is computed against that price instead of
// the product's default price. This keeps coupon math correct when batches
// have different prices.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Brute-force guard: 10 code attempts per minute per user (codes are
    // case-normalised, so guessing is the only attack vector here).
    const rl = rateLimit({ scope: 'coupons:validate', identifier: user.id, limit: 10, windowMs: 60 * 1000 })
    if (!rl.ok) return rateLimitResponse(rl)

    const body = await req.json()
    const parsed = couponValidateSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ error: issue?.message || 'Invalid coupon request' }, { status: 400 })
    }
    const { code, productId, quantity, unitPrice } = parsed.data

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product || !product.isActive) {
      return NextResponse.json({ error: 'Product not available' }, { status: 404 })
    }

    const coupon = await db.coupon.findUnique({
      where: { code: String(code).trim().toUpperCase() },
    })

    if (!coupon || !coupon.isActive) {
      return NextResponse.json({ valid: false, message: 'Coupon not found or inactive' })
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return NextResponse.json({ valid: false, message: 'Coupon expired' })
    }
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
      return NextResponse.json({ valid: false, message: 'Coupon usage limit reached' })
    }

    const qty = Math.max(1, Number(quantity) | 0)
    // Use the provided unitPrice if the caller passed one (batch checkout),
    // otherwise fall back to the product's default price.
    const effectiveUnitPrice =
      typeof unitPrice === 'number' && !isNaN(unitPrice) && unitPrice >= 0
        ? unitPrice
        : product.price
    const originalTotal = effectiveUnitPrice * qty
    let discountValue = 0
    if (coupon.discountPercent > 0) {
      discountValue = (originalTotal * coupon.discountPercent) / 100
    } else if (coupon.discountAmount > 0) {
      discountValue = coupon.discountAmount
    }
    // Don't allow discount to exceed total
    discountValue = Math.min(discountValue, originalTotal)
    const newTotal = Math.max(0, originalTotal - discountValue)

    return NextResponse.json({
      valid: true,
      code: coupon.code,
      description: coupon.description,
      discountPercent: coupon.discountPercent,
      discountAmount: coupon.discountAmount,
      discountValue,
      originalTotal,
      newTotal,
      message: coupon.discountPercent > 0
        ? `${coupon.discountPercent}% off applied`
        : `$${coupon.discountAmount.toFixed(2)} off applied`,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to validate coupon' }, { status: 500 })
  }
}
