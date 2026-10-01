import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/products/[id]/batches
//
// Returns all batches for a product with aggregated counts:
//   - availableCount
//   - soldCount
//   - holdCount
//   - totalCount
//   - effectivePrice (priceOverride ?? product.price)
//
// Used by the admin EntriesModal to group keys by batch and by the buyer's
// checkout page to render the batch dropdown.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params

    const product = await db.product.findUnique({
      where: { id },
      select: { id: true, price: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const batches = await db.batch.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            keys: { where: { status: 'AVAILABLE' } },
          },
        },
      },
    })

    // For sold + hold counts we need separate queries since Prisma's
    // _count only supports one filter at a time per relation.
    const batchIds = batches.map((b) => b.id)
    const soldCounts = await db.licenseKey.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: 'SOLD' },
      _count: { _all: true },
    })
    const holdCounts = await db.licenseKey.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: 'HOLD' },
      _count: { _all: true },
    })
    const totalCounts = await db.licenseKey.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds } },
      _count: { _all: true },
    })

    const soldMap = new Map(soldCounts.map((r) => [r.batchId, r._count._all]))
    const holdMap = new Map(holdCounts.map((r) => [r.batchId, r._count._all]))
    const totalMap = new Map(totalCounts.map((r) => [r.batchId, r._count._all]))

    const result = batches.map((b) => ({
      id: b.id,
      label: b.label,
      priceOverride: b.priceOverride,
      effectivePrice: b.priceOverride ?? product.price,
      availableCount: b._count.keys,
      soldCount: soldMap.get(b.id) ?? 0,
      holdCount: holdMap.get(b.id) ?? 0,
      totalCount: totalMap.get(b.id) ?? 0,
      createdAt: b.createdAt.toISOString(),
    }))

    return NextResponse.json({ batches: result, productPrice: product.price })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load batches' }, { status: 500 })
  }
}
