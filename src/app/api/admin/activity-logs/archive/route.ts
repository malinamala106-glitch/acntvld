import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { archiveOldLogs } from '@/lib/activity-log'

// POST /api/admin/activity-logs/archive
// Manually trigger archiving of logs older than 90 days.
// Can also be called by a cron job (e.g. via external scheduler hitting this endpoint with admin API key).
export async function POST() {
  try {
    await requireAdmin()
    const count = await archiveOldLogs(90)
    return NextResponse.json({
      message: `Archived ${count} log${count !== 1 ? 's' : ''} older than 90 days.`,
      archivedCount: count,
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to archive logs' }, { status: 500 })
  }
}
