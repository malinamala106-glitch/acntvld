import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { createSession, hashPassword, GOOGLE_STATE_COOKIE } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { serverSiteUrl } from '@/lib/site-url'

// GET /api/auth/google/callback
//
// Google redirects here after the consent screen. We verify the CSRF state,
// exchange the authorization code for tokens, read the user's profile, then
// find-or-create the account and start a session.
//
// New accounts are created with profileCompleted = false, so the app shows the
// one-time "finish setting up your account" screen where the user picks a
// username + password. Existing accounts go straight through.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const fail = (code: string) => NextResponse.redirect(new URL(`/?signin=1&auth_error=${code}`, origin))

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail('google_not_configured')

  const params = req.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')

  // CSRF: the state in the URL must match the cookie we set before redirecting.
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(GOOGLE_STATE_COOKIE)?.value
  cookieStore.delete(GOOGLE_STATE_COOKIE)
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('google_state')
  }

  // `origin` (the host the callback actually arrived on) is the safest fallback
  // — it is always the deployment the user is really using.
  const redirectUri = `${serverSiteUrl(origin)}/api/auth/google/callback`

  try {
    // 1) Exchange the code for an access token.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return fail('google_token')
    const tokens = (await tokenRes.json()) as { access_token?: string }
    if (!tokens.access_token) return fail('google_token')

    // 2) Read the profile (email + name).
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!userRes.ok) return fail('google_profile')
    const profile = (await userRes.json()) as {
      email?: string
      email_verified?: boolean
      name?: string
    }

    const email = profile.email?.toLowerCase().trim()
    if (!email || profile.email_verified === false) return fail('google_email')

    // 3) Find-or-create the account.
    let user = await db.user.findUnique({ where: { email } })
    if (!user) {
      user = await db.user.create({
        data: {
          email,
          // Google users have no password until they complete the one-time
          // setup step. Store an unguessable random hash so password login is
          // impossible in the meantime.
          passwordHash: hashPassword(crypto.randomBytes(32).toString('hex')),
          name: profile.name?.trim().slice(0, 100) || email.split('@')[0],
          role: 'BUYER',
          status: 'ACTIVE',
          profileCompleted: false,
          balance: 0,
        },
      })
      await logActivity({
        userId: user.id,
        userEmail: user.email,
        actionType: 'REGISTER',
        action: 'Account created',
        description: `New account registered via Google: ${user.email}`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('LOG'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { provider: 'google' },
      })
    }

    if (user.status === 'BANNED') return fail('account_suspended')

    // 4) Start the session and send them home. AppShell shows the profile
    // setup screen when profileCompleted is still false.
    await createSession(user.id)

    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'LOGIN',
      action: 'Signed in',
      description: 'User signed in via Google',
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { provider: 'google' },
    })

    return NextResponse.redirect(new URL('/', origin))
  } catch {
    return fail('google_failed')
  }
}
