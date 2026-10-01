import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHAT_TOPICS = ['order', 'purchase', 'deposit', 'product', 'other'] as const
export type ChatTopic = (typeof CHAT_TOPICS)[number]

export const TOPIC_LABELS: Record<ChatTopic, string> = {
  order: 'Order-related issue',
  purchase: 'Purchase-related issue',
  deposit: 'Deposit-related issue',
  product: 'Product-related issue',
  other: 'Other issue',
}

// Max 5 pinned conversations per admin, enforced on every pin mutation.
export const PIN_LIMIT = 5

export const MESSAGE_MAX_LENGTH = 2000
export const NOTE_MAX_LENGTH = 2000
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5MB
// JPG / PNG / WebP / PDF / ZIP. SVG is rejected outright — it can carry
// scripts and browsers render it inline.
export const ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/zip',
] as const

/** MIME types the UI renders as an inline thumbnail rather than a file card. */
export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && /^image\/(jpeg|png|webp)$/i.test(mime)
}

/** Attachment metadata stored as JSON alongside the uploaded file. */
export interface AttachmentMeta {
  name: string
  size: number
  mime: string
}

/** Strip path separators / control chars so a filename can never break a UI. */
export function sanitizeAttachmentName(raw: unknown): string {
  if (typeof raw !== 'string') return 'attachment'
  const base = raw.split(/[\\/]/).pop() ?? 'attachment'
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 120) || 'attachment'
}

/** Parse stored attachment metadata. Returns null when absent/malformed. */
export function parseAttachmentMeta(raw: string | null | undefined): AttachmentMeta | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    if (typeof obj.name !== 'string' || typeof obj.mime !== 'string') return null
    const size = typeof obj.size === 'number' && Number.isFinite(obj.size) ? Math.max(0, Math.round(obj.size)) : 0
    return { name: sanitizeAttachmentName(obj.name), size, mime: obj.mime.slice(0, 100) }
  } catch {
    return null
  }
}

/** Serialize metadata for storage (clamped to sane limits). */
export function serializeAttachmentMeta(meta: AttachmentMeta): string {
  return JSON.stringify({
    name: sanitizeAttachmentName(meta.name),
    size: Math.max(0, Math.round(meta.size)),
    mime: meta.mime.slice(0, 100),
  })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidTopic(t: unknown): t is ChatTopic {
  return typeof t === 'string' && (CHAT_TOPICS as readonly string[]).includes(t)
}

export function isValidStatus(s: unknown): s is 'processing' | 'complete' | 'revoke' {
  return s === 'processing' || s === 'complete' || s === 'revoke'
}

export function isValidSenderType(s: unknown): s is 'user' | 'admin' | 'system' | 'guest' {
  return s === 'user' || s === 'admin' || s === 'system' || s === 'guest'
}

/**
 * Strip all HTML tags from user input. Chat bodies are rendered as plain
 * text everywhere (React escapes them), so tags are never meaningful —
 * removing them defuses stored-XSS payloads before they're even stored.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim()
}

/** Max 5 pins per admin. pinnedBy is a JSON array of admin user ids. */
export function parsePinnedBy(raw: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function serializePinnedBy(ids: string[]): string {
  return JSON.stringify(Array.from(new Set(ids)).slice(0, PIN_LIMIT))
}

/**
 * Guest session ids are generated client-side and echoed back to the server,
 * so they must be validated strictly: short, alphanumeric, no separators.
 */
export function isValidGuestSession(s: unknown): s is string {
  return typeof s === 'string' && /^[a-zA-Z0-9]{8,32}$/.test(s)
}

/**
 * Readable guest handle, e.g. "Guest #4471" (last 4 chars of the session id).
 * Replaces the old truncated-hash label that made every guest look identical.
 */
export function guestLabel(sessionId: string | null | undefined): string {
  if (!sessionId) return 'Guest'
  const tail = sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()
  return `Guest #${tail || '????'}`
}

/** Mask the host part of an IP for admin display: 103.45.67.89 → 103.45.x.x. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const clean = ip.split(',')[0].trim()
  if (clean.includes('.')) {
    const parts = clean.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`
  }
  if (clean.includes(':')) {
    const groups = clean.split(':').filter(Boolean)
    if (groups.length >= 2) return `${groups[0]}:${groups[1]}::x`
  }
  return null
}

/** Create a conversation (used by the topic-pick endpoint). */
export async function createConversation(opts: {
  userId?: string | null
  guestSessionId?: string | null
  topic: ChatTopic
  ip?: string | null
  userAgent?: string | null
  /** Optional page context captured when the buyer opened the chat. */
  contextOrderId?: string | null
  contextProductId?: string | null
}) {
  return db.conversation.create({
    data: {
      userId: opts.userId ?? null,
      guestSessionId: opts.userId ? null : opts.guestSessionId,
      topic: opts.topic,
      status: 'processing',
      guestIp: opts.ip ?? null,
      guestUserAgent: opts.userAgent ?? null,
      contextOrderId: opts.contextOrderId ?? null,
      contextProductId: opts.contextProductId ?? null,
    },
  })
}

/** Length-safe id guard for the optional page-context ids. */
export function safeContextId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw : null
}

/** Insert a system message + bump the conversation's lastMessageAt. */
export async function addSystemMessage(conversationId: string, body: string) {
  const msg = await db.supportMessage.create({
    data: { conversationId, senderType: 'system', senderId: null, body },
  })
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: msg.createdAt },
  })
  return msg
}

/** Audit-log a support-chat admin action. Fire-and-forget; never throws. */
export async function logChatEvent(opts: {
  req: Request
  admin: { id: string; email: string } | null
  action: string
  conversationId?: string
  description: string
  metadata?: Record<string, unknown>
}) {
  try {
    await logActivity({
      userId: opts.admin?.id ?? null,
      userEmail: opts.admin?.email ?? null,
      actionType: 'ADMIN_ACTION',
      action: opts.action,
      description: opts.description,
      status: 'SUCCESS',
      referenceId: opts.conversationId ? generateReferenceId('CHAT') : undefined,
      ipAddress: getRequestIp(opts.req as any),
      userAgent: getRequestUserAgent(opts.req as any),
      metadata: opts.metadata,
    })
  } catch {
    // audit logging must never block chat
  }
}

/**
 * Identity resolution shared by buyer-side endpoints:
 *   1. authenticated buyer → { userId }
 *   2. valid guest session → { guestSessionId }
 *   3. otherwise null
 * Admins get null here — they use /api/admin/chat/*.
 */
export async function resolveBuyerIdentity(guestSession: unknown): Promise<
  { userId: string; guestSessionId: null } | { userId: null; guestSessionId: string } | null
> {
  const user = await getCurrentUser()
  if (user) {
    if (user.role === 'ADMIN') return null
    return { userId: user.id, guestSessionId: null }
  }
  if (isValidGuestSession(guestSession)) {
    return { userId: null, guestSessionId: guestSession as string }
  }
  return null
}
