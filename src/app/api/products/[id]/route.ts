import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { revalidateProducts } from '@/lib/cache'

// Admin: update product
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const data: any = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name || name.length > 200) {
        return NextResponse.json({ error: 'Name must be 1-200 characters' }, { status: 400 })
      }
      data.name = name
    }
    if (typeof body.description === 'string') data.description = body.description.slice(0, 20000)
    if (typeof body.renderHtml === 'boolean') data.renderHtml = body.renderHtml
    if (typeof body.category === 'string') data.category = body.category.slice(0, 80)
    if (typeof body.deliveryFormat === 'string') data.deliveryFormat = body.deliveryFormat.trim().slice(0, 200) || null
    if (typeof body.price === 'number') {
      if (!Number.isFinite(body.price) || body.price < 0) {
        return NextResponse.json({ error: 'Price must be a number of zero or more' }, { status: 400 })
      }
      data.price = body.price
    }
    if (typeof body.image === 'string') data.image = body.image.slice(0, 500)
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive
    // Handle metadata — accept a JSON array string or a JS array, validate it
    if (body.metadata !== undefined) {
      if (body.metadata === null) {
        data.metadata = null
      } else if (typeof body.metadata === 'string') {
        try {
          const parsed = JSON.parse(body.metadata)
          if (Array.isArray(parsed)) {
            data.metadata = JSON.stringify(parsed.filter((f: any) => f && typeof f.name === 'string' && typeof f.value === 'string').slice(0, 50))
          } else {
            data.metadata = null
          }
        } catch {
          data.metadata = null
        }
      } else if (Array.isArray(body.metadata)) {
        data.metadata = JSON.stringify(body.metadata.filter((f: any) => f && typeof f.name === 'string' && typeof f.value === 'string').slice(0, 50))
      }
    }

    const product = await db.product.update({ where: { id }, data })
    revalidateProducts([id])
    return NextResponse.json({ product })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

// Admin: delete product
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    await db.product.delete({ where: { id } })
    revalidateProducts([id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
