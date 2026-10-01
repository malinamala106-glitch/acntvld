import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { loginSchema, parseWith } from '@/lib/validation'

const WINDOW_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = parseWith(loginSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { email, password, rememberMe } = parsed.data
    // `email` may hold either an email address or a username — both are valid
    // login handles. Normalise for the case-insensitive columns.
    const emailNorm = email.toLowerCase().trim()

    // Two buckets on purpose. The per-IP limit blunts one host hammering many
    // accounts; the per-email limit blunts a botnet spreading attempts against
    // one account across many hosts, which a per-IP limit alone would miss.
    const ipLimit = rateLimit({
      scope: 'auth:login:ip',
      identifier: clientIp(req),
      limit: 30,
      windowMs: WINDOW_MS,
    })
    if (!ipLimit.ok) return rateLimitResponse(ipLimit)

    const emailLimit = rateLimit({
      scope: 'auth:login:email',
      identifier: emailNorm,
      limit: 10,
      windowMs: WINDOW_MS,
    })
    if (!emailLimit.ok) return rateLimitResponse(emailLimit)

    // The only place in the app that may see the hash — everything else relies
    // on the client-wide omit in lib/db.ts.
    const user = await db.user.findFirst({
      where: { OR: [{ email: emailNorm }, { username: emailNorm }] },
      omit: { passwordHash: false },
    })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      // Log failed login attempt (no user id if user doesn't exist — that's fine)
      await logActivity({
        userId: user?.id ?? null,
        userEmail: emailNorm,
        actionType: 'LOGIN_FAILED',
        action: 'Failed login attempt',
        description: `Failed login attempt for ${emailNorm}`,
        status: 'FAILED',
        referenceId: generateReferenceId('LOG'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { reason: user ? 'wrong_password' : 'unknown_email' },
      })
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // A banned account must not be able to mint a fresh session. (Existing
    // sessions are rejected in getCurrentUser.)
    if (user.status === 'BANNED') {
      await logActivity({
        userId: user.id,
        userEmail: user.email,
        actionType: 'LOGIN_FAILED',
        action: 'Blocked login',
        description: `Login blocked for banned account ${user.email}`,
        status: 'FAILED',
        referenceId: generateReferenceId('LOG'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { reason: 'account_banned' },
      })
      return NextResponse.json({ error: 'This account has been suspended.' }, { status: 403 })
    }

    await createSession(user.id, rememberMe === true)
    // Log successful login
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'LOGIN',
      action: 'Signed in',
      description: 'User signed in successfully',
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    })
    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, balance: user.balance },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
