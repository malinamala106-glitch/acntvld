import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { revalidateProducts } from '@/lib/cache'
import {
  generateReferenceId,
  getRequestIp,
  getRequestUserAgent,
  logActivity,
} from '@/lib/activity-log'

// Admin: persist the manual storefront order.
//
// The client sends the COMPLETE ordered list of ids after a drop, and this
// handler rewrites every sortOrder in one transaction. Deliberately not a
// per-row update: two admin tabs each moving one product would otherwise
// interleave and leave sortOrder values with gaps and duplicates. Sending the
// whole list also makes the request self-healing — a stale tab that reloads
// later simply overwrites with its own full ordering rather than merging.
//
// Ids that no longer exist are rejected rather than skipped. A partial write
// would shift every subsequent index by one and silently reorder the catalog.
export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => null)
    const order: unknown = body?.order

    if (!Array.isArray(order) || order.length === 0) {
      return NextResponse.json(
        { error: 'order must be a non-empty array of product ids' },
        { status: 400 },
      )
    }

    const ids = order.map((id: unknown) => String(id))
    if (ids.some((id: string) => id.length === 0)) {
      return NextResponse.json({ error: 'order contains an empty id' }, { status: 400 })
    }
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'order contains duplicate ids' }, { status: 400 })
    }

    const products = await db.product.findMany({
      select: { id: true, name: true, sortOrder: true },
    })

    // Every product must be present exactly once. This catches a client that
    // reordered only a filtered subset (e.g. an active search box was on) or
    // that was holding a stale list from before a product was created.
    if (ids.length !== products.length) {
      const missing = products
        .map((p) => p.id)
        .filter((id: string) => !ids.includes(id))
      return NextResponse.json(
        {
          error:
            'order must list every product exactly once — reload the page and try again',
          missingCount: missing.length,
        },
        { status: 409 },
      )
    }

    const known = new Set(products.map((p) => p.id))
    const unknown = ids.filter((id: string) => !known.has(id))
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'order contains unknown product ids', unknownCount: unknown.length },
        { status: 409 },
      )
    }

    // Only write when the order actually changed — a no-op drop should not
    // bump updatedAt on every row or spam the audit log.
    const currentOrder = [...products]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.id)
    if (currentOrder.join(',') === ids.join(',')) {
      return NextResponse.json({ ok: true, changed: false })
    }

    const nameById = new Map(products.map((p) => [p.id, p.name]))
    await db.$transaction(
      ids.map((id: string, index: number) =>
        db.product.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )

    // Storefront order changed — drop the catalog cache.
    revalidateProducts()

    // Keep it terse in the log: the full id list is noise, the names are what
    // an admin reading the audit trail actually wants to see.
    const summary = ids
      .slice(0, 6)
      .map((id: string) => nameById.get(id) ?? id)
      .join(' → ')

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: 'Admin reordered products',
      description:
        `Reordered ${ids.length} product(s)` +
        (ids.length <= 6 ? `: ${summary}` : `: ${summary} → …`),
      status: 'SUCCESS',
      referenceId: generateReferenceId('ORD'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { count: ids.length, order: ids },
    })

    return NextResponse.json({ ok: true, changed: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to save product order' }, { status: 500 })
  }
}