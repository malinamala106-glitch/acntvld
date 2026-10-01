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

    const existing = await db.user.findUnique({ where: { email: emailNorm } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
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
      user: { id: user.id, email: user.email, name: user.name, role: user.role, balance: user.balance },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
