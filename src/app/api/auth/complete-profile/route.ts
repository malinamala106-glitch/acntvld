import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, hashPassword } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { completeProfileSchema, parseWith } from '@/lib/validation'

// POST /api/auth/complete-profile
//
// One-time step shown after a first Google signup (and any account still
// missing a username/password). Sets a unique username + password and flips
// profileCompleted to true so the gate stops appearing.
export async function POST(req: NextRequest) {
  try {
    const current = await requireUser()

    const body = await req.json().catch(() => null)
    const parsed = parseWith(completeProfileSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { username, password } = parsed.data
    const usernameNorm = username.trim().toLowerCase()

    // Username must be unique across the platform.
    const clash = await db.user.findUnique({ where: { username: usernameNorm }, select: { id: true } })
    if (clash && clash.id !== current.id) {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id: current.id },
      data: {
        username: usernameNorm,
        passwordHash: hashPassword(password),
        profileCompleted: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        balance: true,
        profileCompleted: true,
        createdAt: true,
      },
    })

    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'PROFILE_CHANGED',
      action: 'Profile setup completed',
      description: `User set a username and password: ${user.email}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { username: user.username },
    })

    return NextResponse.json({ user })
  } catch (e: any) {
    if (e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Please sign in again' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Failed to save your profile' }, { status: 500 })
  }
}
