import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/social-links — list ALL social links (admin only, includes inactive)
export async function GET() {
  try {
    await requireAdmin()
    const links = await db.socialLink.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ links })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load social links' }, { status: 500 })
  }
}

// POST /api/admin/social-links — create a new social link
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { platform, url, label, order, isActive } = body || {}
    if (!platform || typeof platform !== 'string') {
      return NextResponse.json({ error: 'platform is required' }, { status: 400 })
    }
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }
    const link = await db.socialLink.create({
      data: {
        platform: String(platform).trim().slice(0, 50),
        url: String(url).trim().slice(0, 500),
        label: label ? String(label).trim().slice(0, 100) : null,
        order: typeof order === 'number' ? order : 0,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    })
    return NextResponse.json({ link })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create social link' }, { status: 500 })
  }
}
