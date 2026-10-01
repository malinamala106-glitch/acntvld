import { db } from './db'
import type { NextRequest } from 'next/server'
import { sanitizeForLog } from './log-sanitize'

// Action types — used for filtering + icon selection in the UI
export const ACTION_TYPES = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'REGISTER',
  'DEPOSIT',
  'BID_PLACED',
  'BID_CANCEL_REQUESTED',
  'BID_CANCEL_APPROVED',
  'BID_CANCEL_REJECTED',
  'BID_WON',
  'PURCHASE',
  'REFUND',
  'PROFILE_CHANGED',
  'ADMIN_ACTION',
] as const

export type ActionType = typeof ACTION_TYPES[number]

export const STATUS_TYPES = ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED', 'ARCHIVED'] as const
export type StatusType = typeof STATUS_TYPES[number]

interface LogOptions {
  userId?: string | null
  userEmail?: string | null
  actionType: ActionType
  action: string
  description?: string
  status?: StatusType
  referenceId?: string
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, any>
}

// Mask an IPv4 address: 103.45.67.89 → 103.45.xx.xx
// Mask an IPv6 address: 2001:0db8:85a3::8a2e:0370:7334 → 2001:0db8:xxxx::xxxx:xxxx:xxxx
export function maskIpAddress(ip: string | null | undefined): string {
  if (!ip) return '—'
  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xx.xx`
    }
    return '—'
  }
  // IPv6 — mask the last 4 groups
  if (ip.includes(':')) {
    const parts = ip.split(':')
    if (parts.length >= 4) {
      return [...parts.slice(0, 4), 'xxxx', 'xxxx', 'xxxx'].join(':')
    }
    return '—'
  }
  return '—'
}

// Extract IP address from a Next.js request — handles X-Forwarded-For, X-Real-IP, and remoteAddr
export function getRequestIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const ip = xff.split(',')[0].trim()
    if (ip) return ip
  }
  const xrip = req.headers.get('x-real-ip')
  if (xrip) return xrip.trim()
  // Fall back to the request's IP if available (NextRequest supports this via `req.ip`)
  // Note: in some environments req.ip may be undefined — we return null in that case
  return null
}

// Extract the User-Agent from a Next.js request
export function getRequestUserAgent(req: NextRequest): string | null {
  const ua = req.headers.get('user-agent')
  return ua || null
}

// Generate a short, human-readable reference ID for an event.
// Examples: TXN-9283746, BID-a4f2c1, ORD-7b3e90, LOG-1a2b3c
export function generateReferenceId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  const time = Date.now().toString(36).slice(-4).toUpperCase()
  return `${prefix}-${random}${time}`
}

// Log an activity event. NEVER logs passwords, card numbers, or private keys —
// only the fields passed in `options`. Safe to call from any server route.
//
// Example:
//   await logActivity({
//     userId: user.id,
//     userEmail: user.email,
//     actionType: 'LOGIN',
//     action: 'Signed in',
//     description: 'User signed in successfully',
//     status: 'SUCCESS',
//     referenceId: generateReferenceId('LOG'),
//     ipAddress: getRequestIp(req),
//     userAgent: getRequestUserAgent(req),
//   })
export async function logActivity(options: LogOptions): Promise<void> {
  try {
    // Defensive scrub at the persistence boundary — even if a caller
    // accidentally passes a `password` / `token` / `cardNumber` field
    // into metadata, we never write the raw value to the DB.
    const safeMetadata = options.metadata
      ? sanitizeForLog(options.metadata)
      : null

    await db.activityLog.create({
      data: {
        userId: options.userId ?? null,
        userEmail: options.userEmail ?? null,
        userLabel: options.userId ? (options.userEmail ?? 'User') : 'System',
        actionType: options.actionType,
        action: options.action,
        description: options.description ?? options.action,
        status: options.status ?? 'SUCCESS',
        referenceId: options.referenceId ?? null,
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
        metadata: safeMetadata ? JSON.stringify(safeMetadata) : null,
        isArchived: false,
      },
    })
  } catch (e) {
    // Logging should NEVER break the actual operation. Fail silently.
    // Use the sanitizer so error messages that quote user input can't
    // leak secrets into dev.log / server.log.
    // eslint-disable-next-line no-console
    console.error('Failed to log activity:', sanitizeForLog(e))
  }
}

// Auto-archive logs older than 90 days. Safe to call repeatedly — only updates
// logs that are not yet archived.
export async function archiveOldLogs(daysOld: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 86400000)
  try {
    const result = await db.activityLog.updateMany({
      where: {
        isArchived: false,
        createdAt: { lt: cutoff },
      },
      data: {
        isArchived: true,
        status: 'ARCHIVED',
      },
    })
    return result.count
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to archive old logs:', sanitizeForLog(e))
    return 0
  }
}
