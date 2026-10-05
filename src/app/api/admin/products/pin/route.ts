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

// Admin: pin / unpin a product to the top of the storefront.
//
// Separate from PATCH /api/products/[id] on purpose: pinning is a deliberate,
// audited merchandising action rather than an incidental field edit, so it
// gets its own endpoint and its own audit entry instead of riding along
// inside a bulk field update where it would be invisible.
//
// Pinning never touches sortOrder, so unpinning drops the product straight
// back into its own manual slot instead of losing its place in the catalog.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => null)
    const id: unknown = body?.id
    const pinned: unknown = body?.pinned

    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    if (typeof pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned must be a boolean' }, { status: 400 })
    }

    const existing = await db.product.findUnique({
      where: { id },
      select: { id: true, name: true, pinned: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Already in the requested state — no write, no audit noise.
    if (existing.pinned === pinned) {
      return NextResponse.json({ ok: true, changed: false, product: existing })
    }

    const product = await db.product.update({
      where: { id },
      data: { pinned },
      select: { id: true, name: true, pinned: true, sortOrder: true },
    })

    // Pinned rows sort above every unpinned one, so the listing changed.
    revalidateProducts([id])

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: pinned
        ? `Admin pinned ${existing.name}`
        : `Admin unpinned ${existing.name}`,
      description: pinned
        ? `Pinned "${existing.name}" to the top of the storefront`
        : `Unpinned "${existing.name}" — back to its manual position`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ORD'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { productId: id, pinned },
    })

    return NextResponse.json({ ok: true, changed: true, product })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update pin' }, { status: 500 })
  }
}