import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, requireAdmin } from '@/lib/auth'
import { revalidateProducts } from '@/lib/cache'

// Public: list active products with available stock
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  const { searchParams } = new URL(req.url)
  const admin = searchParams.get('admin') === '1'

  if (admin) {
    try {
      await requireAdmin()
      const products = await db.product.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { keys: { where: { status: 'AVAILABLE' } } } } },
      })
      return NextResponse.json({ products })
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const where = user?.role === 'ADMIN' ? {} : { isActive: true }
  const products = await db.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      renderHtml: true,
      category: true,
      metadata: true,
      deliveryFormat: true,
      price: true,
      stock: true,
      image: true,
      isActive: true,
      createdAt: true,
    },
  })

  // Compute per-product price ranges from the Batch table so the storefront
  // can show "From $0.30" or "$0.30 – $1.00" when a product has multiple
  // batches with different price overrides.
  //
  // For batches with priceOverride = null, the product's own price is the
  // effective price. We compute min/max across all batches that have at
  // least one AVAILABLE key, so the range only reflects in-stock batches.
  const productIds = products.map((p) => p.id)
  const batches = await db.batch.findMany({
    where: { productId: { in: productIds } },
    select: {
      productId: true,
      priceOverride: true,
      keys: { where: { status: 'AVAILABLE' }, select: { id: true }, take: 1 },
    },
  })

  // Group effective prices per product (only counting batches with stock).
  const priceMap = new Map<string, number[]>()
  for (const b of batches) {
    if (b.keys.length === 0) continue // batch has no available keys — skip
    const product = products.find((p) => p.id === b.productId)
    if (!product) continue
    const eff = b.priceOverride ?? product.price
    const arr = priceMap.get(b.productId) ?? []
    arr.push(eff)
    priceMap.set(b.productId, arr)
  }

  const productsWithPricing = products.map((p) => {
    const prices = priceMap.get(p.id)
    if (!prices || prices.length === 0) {
      // No batches with stock — fall back to product.price.
      return { ...p, fromPrice: p.price, maxPrice: p.price, hasBatchPricing: false }
    }
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return {
      ...p,
      fromPrice: min,
      maxPrice: max,
      hasBatchPricing: prices.length > 1 || min !== p.price,
    }
  })

  // The payload depends on the caller's role (admins also see inactive
  // products), so this must stay `private`: browsers may reuse it briefly,
  // but no shared cache may ever hand one user's view to another.
  return NextResponse.json(
    { products: productsWithPricing },
    {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
      },
    }
  )
}

// Admin: create product
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { name, description, renderHtml, category, metadata, deliveryFormat, price, image, keys } = body || {}
    // Name is bounded server-side on purpose: it is echoed into the product
    // page's JSON-LD (see lib/json-ld.ts) and into <title>/meta tags, so an
    // unbounded value is both a storage and a rendering-footgun.
    const nameClean = typeof name === 'string' ? name.trim() : ''
    if (!nameClean || nameClean.length > 200) {
      return NextResponse.json({ error: 'Name is required and must be at most 200 characters' }, { status: 400 })
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'Price must be a number of zero or more' }, { status: 400 })
    }

    const keyList: string[] = Array.isArray(keys)
      ? keys.map((k: any) => String(k).trim()).filter(Boolean)
      : String(keys || '').split(/\r?\n/).map((k) => k.trim()).filter(Boolean)

    // Validate metadata — must be a JSON array of {name, value} pairs, or null
    let metadataStr: string | null = null
    if (metadata !== undefined && metadata !== null) {
      if (typeof metadata === 'string') {
        // Try parsing if it's a string
        try {
          const parsed = JSON.parse(metadata)
          if (Array.isArray(parsed)) {
            metadataStr = JSON.stringify(parsed.filter((f: any) => f && typeof f.name === 'string' && typeof f.value === 'string').slice(0, 50))
          }
        } catch {
          metadataStr = null
        }
      } else if (Array.isArray(metadata)) {
        metadataStr = JSON.stringify(metadata.filter((f: any) => f && typeof f.name === 'string' && typeof f.value === 'string').slice(0, 50))
      }
    }

    const product = await db.product.create({
      data: {
        name: nameClean,
        description: typeof description === 'string' ? description.slice(0, 20000) : null,
        renderHtml: typeof renderHtml === 'boolean' ? renderHtml : false,
        category: category || 'General',
        metadata: metadataStr,
        deliveryFormat: deliveryFormat ? String(deliveryFormat).trim().slice(0, 200) : null,
        price: Number(price),
        image: image || null,
        stock: keyList.length,
        keys: keyList.length
          ? {
              create: keyList.map((k) => ({ key: k })),
            }
          : undefined,
      },
      include: { keys: { select: { id: true, key: true, status: true } } },
    })

    // New product changes the storefront listing — drop the catalog cache.
    revalidateProducts()

    return NextResponse.json({ product })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}
