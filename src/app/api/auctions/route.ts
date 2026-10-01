import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, requireAdmin } from '@/lib/auth'

// GET /api/auctions — list active auctions (public)
// admin=1 → include all (even inactive / cancelled)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const admin = searchParams.get('admin') === '1'

  if (admin) {
    try {
      await requireAdmin()
      const auctions = await db.auction.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { bids: true } },
          bids: { orderBy: { amount: 'desc' }, take: 1, include: { user: { select: { email: true, name: true } } } },
        },
      })
      return NextResponse.json({ auctions })
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const auctions = await db.auction.findMany({
    where: { isActive: true },
    orderBy: { endsAt: 'asc' },
    include: {
      _count: { select: { bids: true } },
    },
  })

  return NextResponse.json({ auctions })
}

// POST /api/auctions — admin creates a new auction
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { title, description, category, askingPrice, image, endsAt, deliveryFormat } = body || {}

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    if (typeof askingPrice !== 'number' || askingPrice < 0) {
      return NextResponse.json({ error: 'askingPrice must be a non-negative number' }, { status: 400 })
    }
    if (!endsAt) {
      return NextResponse.json({ error: 'endsAt is required' }, { status: 400 })
    }
    const endsAtDate = new Date(endsAt)
    if (isNaN(endsAtDate.getTime()) || endsAtDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'endsAt must be a future date' }, { status: 400 })
    }

    // Generate a URL-friendly slug from the title: lowercase, hyphens, no special chars
    const baseSlug = String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `deal-${Date.now()}`

    // Ensure slug uniqueness by appending a short suffix if needed
    let slug = baseSlug
    const existing = await db.auction.findUnique({ where: { slug } })
    if (existing) {
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
    }

    const auction = await db.auction.create({
      data: {
        title: String(title).trim().slice(0, 200),
        slug,
        description: description ? String(description).slice(0, 2000) : null,
        category: category ? String(category).slice(0, 80) : 'General',
        askingPrice: Number(askingPrice),
        currentBid: Number(askingPrice),
        image: image ? String(image).slice(0, 500) : null,
        endsAt: endsAtDate,
        deliveryFormat: deliveryFormat ? String(deliveryFormat).slice(0, 200) : null,
        status: 'ACTIVE',
        isActive: true,
      },
    })

    return NextResponse.json({ auction })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create auction' }, { status: 500 })
  }
}
