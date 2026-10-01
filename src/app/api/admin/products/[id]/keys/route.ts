import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/products/[id]/keys?status=all|available|sold|hold
// Returns keys with buyer info for sold keys.
// Keys are returned with their batch info attached so the admin modal can
// group them by batch.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'all'

    const where: any = { productId: id }
    if (status === 'available') where.status = 'AVAILABLE'
    else if (status === 'sold') where.status = 'SOLD'
    else if (status === 'hold') where.status = 'HOLD'

    const keys = await db.licenseKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        key: true,
        status: true,
        orderId: true,
        batchId: true,
        createdAt: true,
        batch: { select: { id: true, label: true, priceOverride: true } },
        order: {
          select: {
            user: { select: { email: true, name: true } },
            createdAt: true,
          },
        },
      },
    })

    return NextResponse.json({ keys })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load keys' }, { status: 500 })
  }
}

// POST /api/admin/products/[id]/keys
// Bulk add keys. Two payload shapes are accepted:
//
//   1. Single batch (backwards-compatible):
//      { keys: string[] | "line1\nline2" }
//      → creates one implicit batch labeled with today's date (MM/DD/YY),
//        priceOverride = null.
//
//   2. Multiple batches (new):
//      { batches: [{ label: "10/05/25", priceOverride: 1.00, keys: "...\n..." }, ...] }
//      → creates one Batch row per item, keys assigned to their batch.
//
// Duplicate detection runs across ALL batches for the product (existing +
// new), so a key can't be uploaded twice even if listed in two batches.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()

    // Normalize the payload into a list of { label, priceOverride, keys[] }.
    type PendingBatch = { label: string; priceOverride: number | null; keys: string[] }
    let pendingBatches: PendingBatch[] = []

    if (Array.isArray(body?.batches)) {
      for (const b of body.batches) {
        const label = String(b?.label || '').trim()
        if (!label) {
          return NextResponse.json({ error: 'Each batch must have a date label' }, { status: 400 })
        }
        const priceRaw = b?.priceOverride
        const priceOverride =
          priceRaw === null || priceRaw === undefined || priceRaw === ''
            ? null
            : Number(priceRaw)
        if (priceOverride !== null && (isNaN(priceOverride) || priceOverride < 0)) {
          return NextResponse.json({ error: `Batch "${label}" has invalid price override` }, { status: 400 })
        }
        const keyList: string[] = Array.isArray(b?.keys)
          ? b.keys.map((k: any) => String(k).trim()).filter(Boolean)
          : String(b?.keys || '').split(/\r?\n/).map((k: string) => k.trim()).filter(Boolean)
        pendingBatches.push({ label, priceOverride, keys: keyList })
      }
    } else {
      // Legacy shape — convert to a single default batch labeled with today's date.
      const keyList: string[] = Array.isArray(body?.keys)
        ? body.keys.map((k: any) => String(k).trim()).filter(Boolean)
        : String(body?.keys || '').split(/\r?\n/).map((k: string) => k.trim()).filter(Boolean)
      const today = new Date()
      const label = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`
      pendingBatches.push({ label, priceOverride: null, keys: keyList })
    }

    // Drop empty batches early.
    pendingBatches = pendingBatches.filter((b) => b.keys.length > 0)
    if (pendingBatches.length === 0) {
      return NextResponse.json({ error: 'No valid keys provided' }, { status: 400 })
    }

    // Flatten all incoming keys for duplicate detection.
    const allNewKeys = pendingBatches.flatMap((b) => b.keys)
    const uniqueNewKeys = Array.from(new Set(allNewKeys))

    // Check for duplicates against existing keys AND across incoming batches.
    const existing = await db.licenseKey.findMany({
      where: { productId: id, key: { in: uniqueNewKeys } },
      select: { key: true },
    })
    const existingSet = new Set(existing.map((e) => e.key))
    const skipped = uniqueNewKeys.filter((k) => existingSet.has(k))

    // Create one Batch row per pending batch (even empty-key ones? no — we
    // already filtered those out above) and assign its keys.
    let totalAdded = 0
    const batchSummaries: { label: string; priceOverride: number | null; added: number; skipped: number }[] = []

    await db.$transaction(async (tx) => {
      for (const pb of pendingBatches) {
        // Filter out duplicates for THIS batch.
        const uniqueHere = pb.keys.filter((k) => !existingSet.has(k))
        if (uniqueHere.length === 0) {
          batchSummaries.push({ label: pb.label, priceOverride: pb.priceOverride, added: 0, skipped: pb.keys.length })
          continue
        }

        // Create the batch row first.
        const batch = await tx.batch.create({
          data: {
            productId: id,
            label: pb.label.slice(0, 60),
            priceOverride: pb.priceOverride,
          },
        })

        // Bulk-create the keys assigned to this batch.
        await tx.licenseKey.createMany({
          data: uniqueHere.map((k) => ({ key: k, productId: id, batchId: batch.id })),
        })

        totalAdded += uniqueHere.length
        batchSummaries.push({
          label: pb.label,
          priceOverride: pb.priceOverride,
          added: uniqueHere.length,
          skipped: pb.keys.length - uniqueHere.length,
        })
      }

      // Update product stock count (denormalized).
      const available = await tx.licenseKey.count({ where: { productId: id, status: 'AVAILABLE' } })
      await tx.product.update({ where: { id }, data: { stock: available } })
    })

    const batchesCreated = batchSummaries.filter((b) => b.added > 0).length
    const totalSkipped = skipped.length

    return NextResponse.json({
      added: totalAdded,
      skipped: totalSkipped,
      batchesCreated,
      stock: await db.licenseKey.count({ where: { productId: id, status: 'AVAILABLE' } }),
      batches: batchSummaries,
      message:
        batchesCreated === 0
          ? 'No new entries added (all duplicates)'
          : batchesCreated === 1
            ? `${totalAdded} entries added${totalSkipped > 0 ? `, ${totalSkipped} skipped (already exist)` : ''}`
            : `${totalAdded} entries uploaded across ${batchesCreated} batches${totalSkipped > 0 ? `, ${totalSkipped} skipped (already exist)` : ''}`,
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to add keys' }, { status: 500 })
  }
}

// PATCH /api/admin/products/[id]/keys
// Body: { keyIds: string[], action: 'edit' | 'delete' | 'status', status?: 'AVAILABLE'|'SOLD'|'HOLD', newKey?: string }
// - action='edit': { keyId, newKey } — edit a single key's credential
// - action='delete': { keyIds } — delete multiple keys
// - action='status': { keyIds, status } — bulk change status
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { action, keyId, keyIds, newKey, status } = body || {}

    if (action === 'edit') {
      if (!keyId || typeof newKey !== 'string') {
        return NextResponse.json({ error: 'keyId and newKey required' }, { status: 400 })
      }
      const updated = await db.licenseKey.update({
        where: { id: keyId },
        data: { key: String(newKey).trim().slice(0, 5000) },
      })
      return NextResponse.json({ key: updated })
    }

    if (action === 'delete') {
      if (!Array.isArray(keyIds) || keyIds.length === 0) {
        return NextResponse.json({ error: 'keyIds array required' }, { status: 400 })
      }
      // Only allow deleting AVAILABLE or HOLD keys (not SOLD — they're tied to orders)
      const result = await db.licenseKey.deleteMany({
        where: { id: { in: keyIds }, productId: id, status: { in: ['AVAILABLE', 'HOLD'] } },
      })
      // Update stock
      const available = await db.licenseKey.count({ where: { productId: id, status: 'AVAILABLE' } })
      await db.product.update({ where: { id }, data: { stock: available } })
      return NextResponse.json({ deleted: result.count, stock: available })
    }

    if (action === 'status') {
      if (!Array.isArray(keyIds) || keyIds.length === 0 || !status) {
        return NextResponse.json({ error: 'keyIds and status required' }, { status: 400 })
      }
      const validStatuses = ['AVAILABLE', 'SOLD', 'HOLD']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      const result = await db.licenseKey.updateMany({
        where: { id: { in: keyIds }, productId: id },
        data: { status },
      })
      // Update stock count
      const available = await db.licenseKey.count({ where: { productId: id, status: 'AVAILABLE' } })
      await db.product.update({ where: { id }, data: { stock: available } })
      return NextResponse.json({ updated: result.count, stock: available })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to process' }, { status: 500 })
  }
}
