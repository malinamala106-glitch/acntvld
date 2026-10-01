import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isValidGuestSession } from '@/lib/support-chat'

// POST /api/chat/merge — attach a guest's conversations to their account
// after they log in (spec 3.3, session merge).
//
// Body: { guestSession }
//
// The ChatWidget calls this once, fire-and-forget, when it boots and detects
// an authenticated user alongside a persisted guest session in localStorage.
// Ownership model: the guest session id comes from THIS browser's storage and
// the caller proves identity with their session cookie, so merging is safe.
// Merge = set userId on the guest conversations and clear the guest key so
// the admin console relabels Guest rows as the registered user.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role === 'ADMIN') {
      return NextResponse.json({ ok: true, merged: 0 })
    }

    const body = await req.json().catch(() => ({} as any))
    if (!isValidGuestSession(body?.guestSession)) {
      return NextResponse.json({ ok: true, merged: 0 })
    }

    const rl = rateLimit({ scope: 'chat:merge', identifier: user.id, limit: 5, windowMs: 60 * 60 * 1000 })
    if (!rl.ok) return rateLimitResponse(rl)

    const result = await db.conversation.updateMany({
      where: { guestSessionId: body.guestSession, userId: null },
      data: { userId: user.id, guestSessionId: null },
    })

    return NextResponse.json({ ok: true, merged: result.count })
  } catch {
    return NextResponse.json({ ok: false, merged: 0 }, { status: 200 })
  }
}
