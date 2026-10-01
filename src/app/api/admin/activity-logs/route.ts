import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { archiveOldLogs, ACTION_TYPES, STATUS_TYPES } from '@/lib/activity-log'

// GET /api/admin/activity-logs
// Returns ALL activity logs (admin audit trail) with FULL IP addresses.
// Query params:
//   search — search by action, description, referenceId, userLabel, or userEmail
//   actionType — filter by action type
//   status — filter by status
//   userId — filter by specific user
//   ipAddress — filter by IP address (substring match)
//   dateFrom — ISO date string
//   dateTo — ISO date string
//   page — page number (1-indexed)
//   pageSize — rows per page (20–100)
//   includeArchived — 'true' to include archived logs (default: false)
//   format — 'csv' to export as CSV
export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    // Auto-archive old logs on each admin request (best-effort, background)
    archiveOldLogs(90).catch(() => {})

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const actionType = searchParams.get('actionType')
    const status = searchParams.get('status')
    const userId = searchParams.get('userId')
    const ipAddress = searchParams.get('ipAddress')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const includeArchived = searchParams.get('includeArchived') === 'true'
    const format = searchParams.get('format')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = format === 'csv' ? 10000 : Math.min(100, Math.max(20, parseInt(searchParams.get('pageSize') || '20')))

    // Build the where clause
    const where: any = {}
    if (!includeArchived) where.isArchived = false
    if (actionType && ACTION_TYPES.includes(actionType as any)) where.actionType = actionType
    if (status && STATUS_TYPES.includes(status as any)) where.status = status
    if (userId) where.userId = userId
    if (ipAddress) where.ipAddress = { contains: ipAddress }
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(new Date(dateTo).getTime() + 86400000)
    }
    if (search) {
      where.OR = [
        { action: { contains: search } },
        { description: { contains: search } },
        { referenceId: { contains: search } },
        { userLabel: { contains: search } },
        { userEmail: { contains: search } },
      ]
    }

    const [logs, total] = await Promise.all([
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: format === 'csv' ? 0 : (page - 1) * pageSize,
        take: pageSize,
      }),
      db.activityLog.count({ where }),
    ])

    // Parse metadata JSON for each log
    const parsedLogs = logs.map((log) => ({
      ...log,
      metadata: log.metadata ? (() => { try { return JSON.parse(log.metadata) } catch { return null } })() : null,
    }))

    // CSV export
    if (format === 'csv') {
      const headers = ['Timestamp', 'User', 'Email', 'Action Type', 'Action', 'Description', 'Status', 'Reference ID', 'IP Address', 'User Agent', 'Archived']
      const rows = parsedLogs.map((l) => [
        new Date(l.createdAt).toISOString(),
        l.userLabel || 'System',
        l.userEmail || '',
        l.actionType,
        l.action,
        l.description,
        l.status,
        l.referenceId || '',
        l.ipAddress || '',
        (l.userAgent || '').replace(/"/g, '""'),
        l.isArchived ? 'Yes' : 'No',
      ])
      const csv = [
        headers.join(','),
        ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activity-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    return NextResponse.json({
      logs: parsedLogs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load activity logs' }, { status: 500 })
  }
}
