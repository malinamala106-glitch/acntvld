import { NextRequest, NextResponse } from 'next/server'
import { destroySession, getCurrentUser, revokeUserSessions } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  // Revoke server-side, don't just forget the cookie.
  //
  // Session cookies are stateless, so deleting the one in this browser left the
  // token itself valid: the 2026-10-02 audit replayed the pre-logout cookie and
  // /api/auth/me still returned the user, and with "remember me" that stayed
  // true for 30 days. Bumping sessionVersion invalidates every token already
  // issued to this user, on every device — that is the behaviour people expect
  // from "sign out". (A stolen cookie is killed by the same call the victim
  // makes from their own browser.)
  if (user) {
    await revokeUserSessions(user.id)
  }
  await destroySession()
  // Log logout (best-effort — user may not be logged in)
  if (user) {
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'LOGOUT',
      action: 'Signed out',
      description: 'User signed out',
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    })
  }
  return NextResponse.json({ ok: true })
}
