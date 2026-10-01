import { db } from './db'
import { cookies } from 'next/headers'
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  REMEMBER_ME_MAX_AGE,
} from './password'

export { hashPassword, verifyPassword }

// Cookie holding the OAuth CSRF state between the Google redirect and the
// callback. Shared by both routes so they can't drift apart.
export const GOOGLE_STATE_COOKIE = 'g_oauth_state'

export async function createSession(userId: string, rememberMe: boolean = false) {
  // Read the current version so the token can be invalidated later by bumping it.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  })
  const maxAge = rememberMe ? REMEMBER_ME_MAX_AGE : SESSION_MAX_AGE
  const token = signToken(userId, user?.sessionVersion ?? 0, maxAge)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // `lax` (not `strict`) on purpose: the Google OAuth callback returns here
    // via a cross-site top-level redirect, and a `strict` cookie would not be
    // sent on that request. `lax` already blocks cross-site POSTs, which is
    // what CSRF needs, and `httpOnly` is what actually stops XSS token theft.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
    path: '/',
  })
}

export async function destroySession() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

/**
 * Invalidate every session token issued for this user, on every device.
 *
 * Stateless session cookies cannot be "deleted" server-side, so we instead
 * change the version they were signed with. Call this on password change,
 * account ban, or a "sign out everywhere" request.
 */
export async function revokeUserSessions(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  })
}

export async function getCurrentUser() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null

    const payload = verifyToken(token)
    if (!payload) return null

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        balance: true,
        status: true,
        profileCompleted: true,
        sessionVersion: true,
        createdAt: true,
      },
    })
    if (!user) return null

    // Signature and expiry were fine, but the token may have been revoked
    // since it was issued (password change, ban, sign-out-everywhere).
    if (user.sessionVersion !== payload.v) return null

    // A banned account must not keep working just because it holds a cookie
    // minted before the ban.
    if (user.status === 'BANNED') return null

    const { sessionVersion: _v, ...publicUser } = user
    return publicUser
  } catch {
    return null
  }
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN')
  return user
}
