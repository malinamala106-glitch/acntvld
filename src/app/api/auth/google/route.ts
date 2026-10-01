import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { GOOGLE_STATE_COOKIE } from '@/lib/auth'

// GET /api/auth/google
// Redirects to Google OAuth consent screen.
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.
// If not configured, returns an error.
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    // Not configured — bounce back to the sign-in modal with a friendly error
    // rather than showing raw JSON on the only signup path.
    return NextResponse.redirect(new URL('/?signin=1&auth_error=google_not_configured', req.nextUrl.origin))
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/auth/google/callback`
  const scope = 'openid email profile'
  // CSRF guard: a random value echoed back by Google and compared against a
  // short-lived cookie in the callback, so a forged callback can't sign a
  // victim into an attacker's account.
  const state = crypto.randomUUID()

  const cookieStore = await cookies()
  cookieStore.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_account')

  return NextResponse.redirect(url)
}
