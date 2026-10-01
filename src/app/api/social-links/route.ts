import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/social-links — public list of active social links (for footer + nav)
export async function GET() {
  const links = await db.socialLink.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ links })
}
