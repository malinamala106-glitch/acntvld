import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { USERNAME_RE } from '@/lib/validation'

// GET /api/auth/username-check?username=foo
//
// Lightweight availability probe used by the profile-setup form so the user
// gets feedback before submitting. The authoritative check still happens in
// POST /api/auth/complete-profile.
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('username') || '').trim().toLowerCase()

  if (!USERNAME_RE.test(raw)) {
    return NextResponse.json({ available: false, reason: 'invalid' })
  }

  const existing = await db.user.findUnique({ where: { username: raw }, select: { id: true } })
  return NextResponse.json({ available: !existing })
}
