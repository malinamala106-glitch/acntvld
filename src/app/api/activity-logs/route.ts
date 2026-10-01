import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { archiveOldLogs, ACTION_TYPES, STATUS_TYPES } from '@/lib/activity-log'
import { buildUserActivityView, parseLogMetadata } from '@/lib/activity-display'

// GET /api/activity-logs
//
// Returns the current user's own activity log, already sanitized for display:
// only the fields a buyer is allowed to see leave the server (action name,
// description, reason, amount, actor display name, device summary, status and
// timestamp). Reference IDs, IP addresses, user agents, internal ids and raw
// metadata never reach the browser — see src/lib/activity-display.ts.
// Query params:
//   search — search by action, description, or referenceId
//   actionType — filter by action type (LOGIN, DEPOSIT, BID_PLACED, etc.)
//   status — filter by status (SUCCESS, PENDING, FAILED, CANCELLED)
//   dateFrom — ISO date string, logs from this date onwards
//   dateTo — ISO date string, logs up to this date
//   page — page number (1-indexed), default 1
//   pageSize — rows per page (20–50), default 20
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Auto-archive old logs on each request (best-effort, runs in background)
    archiveOldLogs(90).catch(() => {})

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const actionType = searchParams.get('actionType')
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(50, Math.max(20, parseInt(searchParams.get('pageSize') || '20')))

    // Build the where clause
    const where: any = {
      userId: user.id,
      isArchived: false, // Users don't see archived logs by default
    }
    if (actionType && ACTION_TYPES.includes(actionType as any)) {
      where.actionType = actionType
    }
    if (status && STATUS_TYPES.includes(status as any)) {
      where.status = status
    }
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(new Date(dateTo).getTime() + 86400000) // inclusive end of day
    }
    if (search) {
      where.OR = [
        { action: { contains: search } },
        { description: { contains: search } },
        { referenceId: { contains: search } },
      ]
    }

    const [logs, total] = await Promise.all([
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.activityLog.count({ where }),
    ])

    // Which sign-ins came from a device this account had not used before? We
    // need the first row per user agent to answer that honestly (the audit
    // trail keeps the raw user agents — the user view only gets "New device").
    const firstLoginByAgent = new Map<string, string>()
    const loginRows = await db.activityLog.findMany({
      where: { userId: user.id, actionType: 'LOGIN', userAgent: { not: null } },
      select: { id: true, userAgent: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    for (const row of loginRows) {
      if (row.userAgent && !firstLoginByAgent.has(row.userAgent)) {
        firstLoginByAgent.set(row.userAgent, row.id)
      }
    }

    // Project each row down to the user-safe view — no spread of the raw row,
    // so a new column can never leak by accident.
    const safeLogs = logs.map((log) => {
      const metadata = parseLogMetadata(log.metadata)
      const view = buildUserActivityView({
        actionType: log.actionType,
        action: log.action,
        description: log.description,
        status: log.status,
        metadata,
        userAgent: log.userAgent,
        userEmail: log.userEmail,
        newDevice: log.userAgent ? firstLoginByAgent.get(log.userAgent) === log.id : false,
      })
      return {
        id: log.id,
        actionType: log.actionType,
        status: log.status,
        createdAt: log.createdAt,
        ...view,
      }
    })

    return NextResponse.json({
      logs: safeLogs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load activity logs' }, { status: 500 })
  }
}
