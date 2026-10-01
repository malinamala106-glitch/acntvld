import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, hashPassword } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

// Basic email format check — keep permissive but catch obvious mistakes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

// GET /api/admin/users/[id] — full user profile data for the admin modal
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
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
    })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Fetch orders for this user
    const orders = await db.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        shortId: true,
        quantity: true,
        unitPrice: true,
        totalAmount: true,
        status: true,
        createdAt: true,
        product: { select: { id: true, name: true } },
        keys: { select: { id: true, key: true } },
      },
    })

    // Fetch deposits for this user
    const deposits = await db.deposit.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        network: true,
        amount: true,
        txHash: true,
        status: true,
        type: true,
        note: true,
        adminNote: true,
        createdAt: true,
      },
    })

    // Fetch activity logs for this user
    const activity = await db.activityLog.findMany({
      where: { userId: id, isArchived: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        actionType: true,
        action: true,
        description: true,
        status: true,
        referenceId: true,
        createdAt: true,
      },
    })

    // Fetch admin notes (stored in settings table with key like 'admin_note_<userId>')
    const noteRow = await db.setting.findUnique({ where: { key: `admin_note_${id}` } })
    const adminNote = noteRow?.value ?? ''

    // Calculate total spent
    const totalSpent = orders.reduce((s, o) => s + o.totalAmount, 0)

    return NextResponse.json({
      user: { ...user, totalSpent },
      orders,
      deposits,
      activity,
      adminNote,
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load user profile' }, { status: 500 })
  }
}

// PATCH /api/admin/users/[id] — update user role, status, admin notes,
// or core profile fields (name / email / password).
// All successful changes are written to the audit log. Password values are
// never logged — only the fact that the password was changed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { role, status, adminNote, name, email, newPassword, sendNotification } = body || {}

    // Security: prevent self-ban/self-demote
    if (id === admin.id) {
      if (status === 'BANNED' || status === 'MUTED') {
        return NextResponse.json({ error: "You can't ban or mute yourself" }, { status: 400 })
      }
      if (role && role.toUpperCase() !== 'ADMIN') {
        return NextResponse.json({ error: "You can't demote yourself" }, { status: 400 })
      }
    }

    // Security: prevent demoting the last admin
    if (role && ['BUYER', 'VENDOR'].includes(role.toUpperCase())) {
      const target = await db.user.findUnique({ where: { id }, select: { role: true } })
      if (target?.role === 'ADMIN') {
        const adminCount = await db.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) {
          return NextResponse.json({ error: "You can't demote the last admin." }, { status: 400 })
        }
      }
    }

    // Security: prevent banning/deleting the last admin
    if (status === 'BANNED') {
      const target = await db.user.findUnique({ where: { id }, select: { role: true } })
      if (target?.role === 'ADMIN') {
        const adminCount = await db.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) {
          return NextResponse.json({ error: "You can't ban the last admin." }, { status: 400 })
        }
      }
    }

    const data: any = {}
    const changes: string[] = []
    // Set when an edit must invalidate tokens already handed out to this user.
    let revokeSessions = false

    if (role && ['ADMIN', 'BUYER', 'VENDOR'].includes(role.toUpperCase())) {
      data.role = role.toUpperCase()
      changes.push(`role → ${role.toUpperCase()}`)
    }
    if (status && ['ACTIVE', 'MUTED', 'BANNED', 'PENDING'].includes(status.toUpperCase())) {
      data.status = status.toUpperCase()
      changes.push(`status → ${status.toUpperCase()}`)
      // A ban is worthless if the banned user keeps their existing cookie.
      if (status.toUpperCase() === 'BANNED') revokeSessions = true
    }

    // --- Profile edits (name / email / password) ---
    // name: optional nullable string, max 100 chars
    if (typeof name === 'string') {
      const trimmed = name.trim().slice(0, 100)
      if (trimmed.length === 0) {
        return NextResponse.json({ error: 'Display name is required' }, { status: 400 })
      }
      data.name = trimmed
      changes.push('name updated')
    }

    // email: required, must be valid + unique
    if (typeof email === 'string') {
      const cleaned = email.trim().toLowerCase()
      if (!EMAIL_RE.test(cleaned)) {
        return NextResponse.json({ error: 'Please enter a valid email' }, { status: 400 })
      }
      // uniqueness check (exclude the current user)
      const clash = await db.user.findUnique({
        where: { email: cleaned },
        select: { id: true },
      })
      if (clash && clash.id !== id) {
        return NextResponse.json({ error: 'Email is already in use by another account' }, { status: 400 })
      }
      data.email = cleaned
      changes.push('email updated')
    }

    // newPassword: optional. If provided, must meet min length.
    // We never log the value — only the fact that it changed.
    if (typeof newPassword === 'string' && newPassword.length > 0) {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
          { status: 400 },
        )
      }
      data.passwordHash = await hashPassword(newPassword)
      changes.push('password updated')
      // Changing a password is how you evict whoever stole the old one, which
      // only works if the sessions they already hold stop being accepted.
      revokeSessions = true
    }

    if (revokeSessions) {
      data.sessionVersion = { increment: 1 }
      changes.push('all sessions signed out')
    }

    let updatedUser: Awaited<ReturnType<typeof db.user.update>> | null = null
    if (Object.keys(data).length > 0) {
      updatedUser = await db.user.update({ where: { id }, data })
    }

    // Save admin notes
    if (typeof adminNote === 'string') {
      await db.setting.upsert({
        where: { key: `admin_note_${id}` },
        update: { value: adminNote.slice(0, 5000) },
        create: { key: `admin_note_${id}`, value: adminNote.slice(0, 5000) },
      })
      changes.push('admin notes updated')
    }

    // Log the change. metadata records *which* fields changed — never the values
    // of password fields.
    if (changes.length > 0) {
      const user = updatedUser || await db.user.findUnique({ where: { id }, select: { email: true } })
      const isProfileEdit =
        typeof name === 'string' || typeof email === 'string' || (typeof newPassword === 'string' && newPassword.length > 0)

      await logActivity({
        userId: admin.id,
        userEmail: admin.email,
        actionType: isProfileEdit ? 'PROFILE_CHANGED' : 'ADMIN_ACTION',
        action: `Updated user ${user?.email ?? id}`,
        description: `Admin updated user ${user?.email ?? id}: ${changes.join(', ')}`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ADM'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: {
          targetUserId: id,
          changes: data.passwordHash ? { ...data, passwordHash: '[redacted]' } : data,
          adminNoteUpdated: typeof adminNote === 'string',
          sendNotification: Boolean(sendNotification) && isProfileEdit,
        },
      })
    }

    return NextResponse.json({ ok: true, user: updatedUser })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}
