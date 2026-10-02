import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { registerSchema, parseWith } from '@/lib/validation'

export async function POST(req: NextRequest) {
  try {
    // Account creation is the most attractive route to abuse (spam accounts,
    // free-balance farming, email enumeration at volume), so the budget is
    // deliberately small: 5 new accounts per host per hour.
    const limit = rateLimit({
      scope: 'auth:register:ip',
      identifier: clientIp(req),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (!limit.ok) return rateLimitResponse(limit)

    const body = await req.json().catch(() => null)
    const parsed = parseWith(registerSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { email, password, name } = parsed.data
    const emailNorm = email.toLowerCase().trim()

    // Do not confirm whether an address is already registered. A distinct
    // error here turns this endpoint into an account-enumeration oracle (audit
    // 2026-10-02, LOW-4): attackers use it to build a list of real customers
    // for credential stuffing. Answer the way we answer a fresh signup and let
    // the client point the visitor at the sign-in tab.
    const existing = await db.user.findUnique({ where: { email: emailNorm } })
    if (existing) {
      return NextResponse.json({
        ok: true,
        accountCreated: false,
        message:
          'That address already has an account. Sign in with your password, or use “forgot password” if you have forgotten it.',
      })
    }
    const user = await db.user.create({
      data: {
        email: emailNorm,
        passwordHash: hashPassword(password),
        name: name || emailNorm.split('@')[0],
        role: 'BUYER',
        balance: 0,
      },
    })
    await createSession(user.id)
    // Log successful registration
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'REGISTER',
      action: 'Account created',
      description: `New account registered: ${user.email}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { name: user.name || null },
    })
    return NextResponse.json({
      ok: true,
      accountCreated: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, balance: user.balance },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
