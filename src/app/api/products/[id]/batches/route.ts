import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products/[id]/batches
//
// Public endpoint — returns all batches for a product that have at least one
// AVAILABLE key, with their effective price and available count.
//
// Used by the buyer's checkout page to render the batch dropdown. Batches
// with zero stock are excluded — buyers can't select them anyway, and
// hiding them keeps the dropdown clean.
//
// Batches are sorted cheapest-first so the default selection (first item)
// is the cheapest available batch, per the spec.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const product = await db.product.findUnique({
      where: { id },
      select: { id: true, price: true, isActive: true },
    })
    if (!product || !product.isActive) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Get all batches for this product, with the count of AVAILABLE keys per batch.
    // We can't filter the relation count directly in Prisma v6, so we group separately.
    const batches = await db.batch.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        priceOverride: true,
      },
    })

    if (batches.length === 0) {
      return NextResponse.json({ batches: [], productPrice: product.price })
    }

    const batchIds = batches.map((b) => b.id)
    const availableCounts = await db.licenseKey.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: 'AVAILABLE' },
      _count: { _all: true },
    })
    const availMap = new Map(availableCounts.map((r) => [r.batchId, r._count._all]))

    const result = batches
      .map((b) => ({
        id: b.id,
        label: b.label,
        priceOverride: b.priceOverride,
        effectivePrice: b.priceOverride ?? product.price,
        availableCount: availMap.get(b.id) ?? 0,
      }))
      .filter((b) => b.availableCount > 0)
      // Sort cheapest-first so the default selection is the cheapest batch.
      .sort((a, b) => a.effectivePrice - b.effectivePrice)

    return NextResponse.json({ batches: result, productPrice: product.price })
  } catch {
    return NextResponse.json({ error: 'Failed to load batches' }, { status: 500 })
  }
}
