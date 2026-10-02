import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { USERNAME_RE } from '@/lib/validation'
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit'

// GET /api/auth/username-check?username=foo
//
// Lightweight availability probe used by the profile-setup form so the user
// gets feedback before submitting. The authoritative check still happens in
// POST /api/auth/complete-profile.
export async function GET(req: NextRequest) {
  // This endpoint answers "is this username taken?", so unlimited access is an
  // enumeration oracle (audit 2026-10-02, LOW-4). Budget it: 20/min per host
  // for interactive use, 100/day per host to stop a long grind.
  const perMinute = rateLimit({
    scope: 'auth:username-check:ip:min',
    identifier: clientIp(req),
    limit: 20,
    windowMs: 60 * 1000,
  })
  if (!perMinute.ok) return rateLimitResponse(perMinute)

  const perDay = rateLimit({
    scope: 'auth:username-check:ip:day',
    identifier: clientIp(req),
    limit: 100,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!perDay.ok) return rateLimitResponse(perDay)

  const raw = (req.nextUrl.searchParams.get('username') || '').trim().toLowerCase()

  if (!USERNAME_RE.test(raw)) {
    return NextResponse.json({ available: false, reason: 'invalid' })
  }

  const existing = await db.user.findUnique({ where: { username: raw }, select: { id: true } })
  return NextResponse.json({ available: !existing })
}
