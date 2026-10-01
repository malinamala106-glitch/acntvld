import { NextRequest, NextResponse } from 'next/server'
import { destroySession, getCurrentUser } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  await destroySession()
  // Log logout (best-effort — user may not be logged in)
  if (user) {
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'LOGOUT',
      action: 'Signed out',
      description: 'User signed out',
      status: 'SUCCESS',
      referenceId: generateReferenceId('LOG'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    })
  }
  return NextResponse.json({ ok: true })
}
