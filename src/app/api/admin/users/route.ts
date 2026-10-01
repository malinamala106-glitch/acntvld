import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, hashPassword } from '@/lib/auth'
import { signResetToken } from '@/lib/password'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { adminCreateUserSchema, parseWith } from '@/lib/validation'

// Basic email format check — permissive but catches obvious mistakes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Set-password links are valid for 7 days.
const SETUP_LINK_TTL_SECONDS = 60 * 60 * 24 * 7

// GET /api/admin/users?search=&role=&status=&sort=&page=&pageSize=
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const role = searchParams.get('role')
    const status = searchParams.get('status')
    const sort = searchParams.get('sort') || 'newest'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50')))

    const where: any = {}
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ]
    }
    if (role && role !== 'all') where.role = role.toUpperCase()
    if (status && status !== 'all') where.status = status.toUpperCase()

    let orderBy: any = { createdAt: 'desc' }
    if (sort === 'balance') orderBy = { balance: 'desc' }
    else if (sort === 'orders') orderBy = { orders: { _count: 'desc' } }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          balance: true,
          lockedBalance: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { orders: true, deposits: true } },
        },
      }),
      db.user.count({ where }),
    ])

    return NextResponse.json({ users, total, page, pageSize })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  }
}

// POST /api/admin/users — manually create a user account.
//
// Used when Google signup isn't an option (e.g. onboarding someone by hand).
// The password is hashed before storage and never emailed in plaintext: when
// "send welcome email" is requested we mint a one-time set-password link
// instead, and return it so the admin can hand it over.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => null)
    const parsed = parseWith(adminCreateUserSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { name, password, role, status, sendWelcomeEmail } = parsed.data
    const email = parsed.data.email.toLowerCase().trim()

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 400 })
    }

    const user = await db.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        name: name.trim().slice(0, 100),
        role,
        status,
        // Admin-created accounts are usable immediately — no setup gate.
        profileCompleted: true,
        balance: 0,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        balance: true,
        createdAt: true,
        sessionVersion: true,
      },
    })

    // Optional: mint a one-time set-password link for the new user. No SMTP is
    // configured, so we return the link for the admin to share; it is never
    // logged (only the fact that a link was generated is).
    let setupUrl: string | null = null
    if (sendWelcomeEmail) {
      const token = signResetToken(user.id, user.sessionVersion, SETUP_LINK_TTL_SECONDS)
      const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
      setupUrl = `${origin}/set-password?token=${encodeURIComponent(token)}`
    }

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: `Created user ${user.email}`,
      description: `Admin manually created user ${user.email} (role: ${role}, status: ${status})`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ADM'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: {
        targetUserId: user.id,
        createdEmail: user.email,
        role,
        status,
        setupLinkGenerated: Boolean(setupUrl),
      },
    })

    const { sessionVersion: _v, ...publicUser } = user
    return NextResponse.json({ user: publicUser, setupUrl })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

// PATCH /api/admin/users/[id] — update user status
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json()
    const { userId, status, name, role } = body || {}

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const data: any = {}
    if (status && ['ACTIVE', 'MUTED', 'BANNED', 'PENDING'].includes(status)) data.status = status
    if (typeof name === 'string') data.name = name.trim().slice(0, 100) || null
    if (role && ['ADMIN', 'BUYER', 'VENDOR'].includes(role.toUpperCase())) data.role = role.toUpperCase()

    const user = await db.user.update({ where: { id: userId }, data })

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: `Updated user ${user.email}`,
      description: `Admin updated user ${user.email}: ${Object.keys(data).join(', ')}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ADM'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { targetUserId: userId, changes: data },
    })

    return NextResponse.json({ user })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE /api/admin/users/[id]
export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (userId === admin.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Security: prevent deleting the last admin
    if (user.role === 'ADMIN') {
      const adminCount = await db.user.count({ where: { role: 'ADMIN' } })
      if (adminCount <= 1) {
        return NextResponse.json({ error: "You can't delete the last admin." }, { status: 400 })
      }
    }

    await db.user.delete({ where: { id: userId } })

    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: `Deleted user ${user.email}`,
      description: `Admin deleted user ${user.email}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ADM'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { targetUserId: userId, action: 'delete_user' },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
