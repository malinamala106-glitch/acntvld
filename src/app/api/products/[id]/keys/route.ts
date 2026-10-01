import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// Admin: bulk add license keys to a product
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { keys } = body || {}

    const keyList: string[] = Array.isArray(keys)
      ? keys.map((k: any) => String(k).trim()).filter(Boolean)
      : String(keys || '').split(/\r?\n/).map((k) => k.trim()).filter(Boolean)

    if (!keyList.length) {
      return NextResponse.json({ error: 'No valid keys provided' }, { status: 400 })
    }

    await db.licenseKey.createMany({
      data: keyList.map((k) => ({ key: k, productId: id })),
    })

    // Update stock count
    const available = await db.licenseKey.count({ where: { productId: id, status: 'AVAILABLE' } })
    await db.product.update({ where: { id }, data: { stock: available } })

    return NextResponse.json({ added: keyList.length, stock: available })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to add keys' }, { status: 500 })
  }
}

// Admin: list keys of a product
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const keys = await db.licenseKey.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, status: true, orderId: true, createdAt: true },
    })
    return NextResponse.json({ keys })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load keys' }, { status: 500 })
  }
}
