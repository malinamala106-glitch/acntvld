import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { safeClientMessage } from '@/lib/safe-error'

// Buyer: purchase a product (atomic)
// Body: { productId, quantity, couponCode?, batchId? }
//
// When batchId is provided:
//   - Stock is taken ONLY from that batch (not all product keys).
//   - Unit price = batch.priceOverride ?? product.price.
//   - Order is tagged with batchId so the admin Orders page can show
//     "10/05/25" next to it.
//
// When batchId is NOT provided:
//   - Backwards-compat: keys are taken from any AVAILABLE batch on the
//     product. The order's batchId is set to the batch the first picked
//     key belongs to (so historical orders without a batchId still display
//     correctly when retried).
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { productId, quantity = 1, couponCode, batchId } = body || {}
    if (!productId) return NextResponse.json({ error: 'Product ID required' }, { status: 400 })
    const qty = Math.max(1, Math.min(100, Number(quantity) | 0))

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product || !product.isActive) {
      return NextResponse.json({ error: 'Product not available' }, { status: 404 })
    }

    // Resolve the batch (if provided) and the effective unit price.
    let batch: { id: string; label: string; priceOverride: number | null; productId: string } | null = null
    let unitPrice = product.price

    if (batchId) {
      batch = await db.batch.findUnique({
        where: { id: batchId },
        select: { id: true, label: true, priceOverride: true, productId: true },
      })
      if (!batch || batch.productId !== productId) {
        return NextResponse.json({ error: 'Batch not found for this product' }, { status: 400 })
      }
      unitPrice = batch.priceOverride ?? product.price
    }

    const originalTotal = unitPrice * qty
    let discountValue = 0
    let appliedCoupon: { id: string; code: string } | null = null

    // Validate + apply coupon if provided
    if (couponCode && typeof couponCode === 'string' && couponCode.trim().length > 0) {
      const coupon = await db.coupon.findUnique({
        where: { code: String(couponCode).trim().toUpperCase() },
      })
      if (!coupon || !coupon.isActive) {
        return NextResponse.json({ error: 'Coupon not found or inactive' }, { status: 400 })
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return NextResponse.json({ error: 'Coupon expired' }, { status: 400 })
      }
      if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
        return NextResponse.json({ error: 'Coupon usage limit reached' }, { status: 400 })
      }
      if (coupon.discountPercent > 0) {
        discountValue = (originalTotal * coupon.discountPercent) / 100
      } else if (coupon.discountAmount > 0) {
        discountValue = coupon.discountAmount
      }
      discountValue = Math.min(discountValue, originalTotal)
      appliedCoupon = { id: coupon.id, code: coupon.code }
    }

    const total = Math.max(0, originalTotal - discountValue)
    const fresh = await db.user.findUnique({ where: { id: user.id } })
    if (!fresh) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (fresh.balance < total) {
      return NextResponse.json({ error: `Insufficient balance. You need ${total.toFixed(2)} but have ${fresh.balance.toFixed(2)}` }, { status: 400 })
    }

    // Atomic: pick keys, deduct balance, create order, mark keys as sold
    try {
      const result = await db.$transaction(async (tx) => {
        // Lock the user by re-reading inside the transaction
        const u = await tx.user.findUnique({ where: { id: user.id } })
        if (!u || u.balance < total) {
          throw new Error('Insufficient balance')
        }

        // Pick available keys. If a batchId was specified, ONLY take keys
        // from that batch — buyers can't mix batches in one checkout.
        const keysWhere = batch
          ? { productId, batchId: batch.id, status: 'AVAILABLE' as const }
          : { productId, status: 'AVAILABLE' as const }
        const keys = await tx.licenseKey.findMany({
          where: keysWhere,
          take: qty,
        })
        if (keys.length < qty) {
          // Re-read the available count for a helpful error message.
          const avail = await tx.licenseKey.count({ where: keysWhere })
          throw new Error(
            batch
              ? `Not enough stock in batch ${batch.label}. Only ${avail} available.`
              : `Not enough stock. Only ${avail} keys available.`,
          )
        }

        // If no explicit batchId was provided but we picked keys that all
        // belong to the same batch, tag the order with that batch so the
        // admin Orders view can display it.
        const effectiveBatchId = batch?.id ?? keys[0]?.batchId ?? null
        const effectiveBatch = batch ?? (effectiveBatchId
          ? await tx.batch.findUnique({ where: { id: effectiveBatchId }, select: { id: true, label: true, priceOverride: true } })
          : null)
        // If the buyer didn't specify a batch and the picked keys span
        // multiple batches, we still use product.price as the unit price
        // (since there's no single override that applies). The order is
        // tagged with the first key's batch for display only.
        const effectiveUnitPrice = batch
          ? (batch.priceOverride ?? product.price)
          : product.price

        // Deduct balance
        await tx.user.update({
          where: { id: user.id },
          data: { balance: { decrement: total } },
        })

        // Generate a readable shortId (e.g. #1024) — find max existing + 1
        const maxOrder = await tx.order.findFirst({ orderBy: { shortId: 'desc' }, select: { shortId: true } })
        const nextShortId = (maxOrder?.shortId ?? 1000) + 1

        // Create order
        const order = await tx.order.create({
          data: {
            shortId: nextShortId,
            userId: user.id,
            productId,
            batchId: effectiveBatchId,
            quantity: qty,
            unitPrice: effectiveUnitPrice,
            totalAmount: total,
            status: 'COMPLETED',
          },
        })

        // Mark keys as sold
        await tx.licenseKey.updateMany({
          where: { id: { in: keys.map((k) => k.id) } },
          data: { status: 'SOLD', orderId: order.id },
        })

        // Update product stock count (denormalized across ALL batches).
        const remaining = await tx.licenseKey.count({ where: { productId, status: 'AVAILABLE' } })
        await tx.product.update({ where: { id: productId }, data: { stock: remaining } })

        // Increment coupon usage if applied
        if (appliedCoupon) {
          await tx.coupon.update({
            where: { id: appliedCoupon.id },
            data: { usedCount: { increment: 1 } },
          })
        }

        return { order, keys, batch: effectiveBatch }
      })

      // Log successful purchase
      await logActivity({
        userId: user.id,
        userEmail: user.email,
        actionType: 'PURCHASE',
        action: 'Purchased product',
        description: `Purchased ${qty} × ${product.name} for $${total.toFixed(2)}${result.batch ? ` (batch: ${result.batch.label})` : ''}${appliedCoupon ? ` (coupon: ${appliedCoupon.code}, saved $${discountValue.toFixed(2)})` : ''}`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ORD'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: {
          orderId: result.order.id,
          productId,
          productName: product.name,
          quantity: qty,
          unitPrice: result.order.unitPrice,
          total,
          discountApplied: discountValue,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          keyCount: result.keys.length,
          batchId: result.batch?.id ?? null,
          batchLabel: result.batch?.label ?? null,
        },
      })

      return NextResponse.json({
        order: result.order,
        keys: result.keys.map((k) => ({ id: k.id, key: k.key })),
        newBalance: (await db.user.findUnique({ where: { id: user.id } }))?.balance ?? 0,
        appliedCoupon: appliedCoupon ? appliedCoupon.code : null,
        discountApplied: discountValue,
      })
    } catch (e: any) {
      // Log failed purchase attempt
      await logActivity({
        userId: user.id,
        userEmail: user.email,
        actionType: 'PURCHASE',
        action: 'Purchase failed',
        description: `Failed to purchase ${qty} × ${product.name}: ${safeClientMessage(e, 'Unknown error')}`,
        status: 'FAILED',
        referenceId: generateReferenceId('ORD'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { productId, quantity: qty, batchId: batch?.id ?? null, error: e.message },
      })
      return NextResponse.json({ error: safeClientMessage(e, 'Purchase failed') }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: 'Purchase failed' }, { status: 500 })
  }
}

// Buyer: list own orders with keys
// Admin: list all orders with filters (search, status, productId, dateFrom, dateTo, page, pageSize)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const admin = searchParams.get('admin') === '1'

    if (admin) {
      try {
        const u = await getCurrentUser()
        if (u?.role !== 'ADMIN') throw new Error('FORBIDDEN')

        // Filters
        const search = (searchParams.get('search') || '').trim().toLowerCase()
        const status = searchParams.get('status')
        const productId = searchParams.get('productId')
        const dateFrom = searchParams.get('dateFrom')
        const dateTo = searchParams.get('dateTo')
        const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
        const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50')))

        const where: any = {}
        if (status && status !== 'all') where.status = status.toUpperCase()
        if (productId && productId !== 'all') where.productId = productId
        if (dateFrom || dateTo) {
          where.createdAt = {}
          if (dateFrom) where.createdAt.gte = new Date(dateFrom)
          if (dateTo) where.createdAt.lte = new Date(new Date(dateTo).getTime() + 86400000)
        }
        if (search) {
          where.OR = [
            { user: { email: { contains: search } } },
            { user: { name: { contains: search } } },
            { product: { name: { contains: search } } },
          ]
        }

        const [orders, total] = await Promise.all([
          db.order.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              user: { select: { id: true, email: true, name: true } },
              product: { select: { id: true, name: true } },
              batch: { select: { id: true, label: true, priceOverride: true } },
              keys: { select: { id: true, key: true } },
            },
          }),
          db.order.count({ where }),
        ])

        return NextResponse.json({ orders, total, page, pageSize })
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Buyer's own order history. Bounded at 100 (newest first) — a lifetime
    // unbounded fetch would grow forever and slow every dashboard visit.
    const orders = await db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        product: { select: { id: true, name: true, image: true } },
        batch: { select: { id: true, label: true, priceOverride: true } },
        keys: { select: { id: true, key: true } },
      },
    })
    return NextResponse.json({ orders })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}
