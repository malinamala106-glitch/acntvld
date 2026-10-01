import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { forgotPasswordSchema, parseWith } from '@/lib/validation'

// POST /api/auth/forgot-password
// Body: { email }
// Always returns success (don't leak whether email exists)
// In production: generate a reset token, store in DB, send email with link
export async function POST(req: NextRequest) {
  try {
    // Throttled before validation on purpose: this endpoint is an
    // unauthenticated way to probe which addresses are registered, so the
    // limiter must not be bypassable by sending a malformed body.
    const limit = rateLimit({
      scope: 'auth:forgot:ip',
      identifier: clientIp(req),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (!limit.ok) return rateLimitResponse(limit)

    const body = await req.json().catch(() => null)
    const parsed = parseWith(forgotPasswordSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const emailNorm = parsed.data.email.toLowerCase().trim()

    // Check if user exists (but always return success to prevent email enumeration)
    const user = await db.user.findUnique({ where: { email: emailNorm } })
    if (user) {
      // In production: generate a reset token, store it, send email
      // For now, we just acknowledge the request
      // TODO: implement email sending when SMTP is configured
    }

    return NextResponse.json({
      ok: true,
      message: 'If an account exists with that email, a reset link has been sent.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
