// Presentation helpers for activity logs.
//
// This module is deliberately free of database/Node imports so it can be used
// by the server routes *and* by client components. That is what lets the admin
// "View as user" toggle render the exact same strings a buyer sees, without
// duplicating the privacy rules in two places.
//
// Privacy contract (enforced by buildUserActivityView + the user API route):
//   - never the admin's email (display name only)
//   - never internal database ids (cuid/uuid)
//   - never reference ids (ADM-…, TXN-…, LOG-…, CHAT-…)
//   - never the user's own IP address or raw user agent string
//   - never old/new balance side by side — only the amount that changed
//   - never a raw internal enum — always human-readable text

// The public name for whoever acted on the account from the inside. Admins are
// never identified to buyers (that is what the audit trail is for).
export const ADMIN_ACTOR_NAME = 'Support Team'

// Internal action keys written into ActivityLog.metadata.action.
export const ACTION_KEY_LABELS: Record<string, string> = {
  balance_adjust: 'Balance adjustment',
  deposit_created: 'Deposit submitted',
  deposit_approve: 'Deposit approved',
  deposit_reject: 'Deposit rejected',
  login: 'Signed in',
  logout: 'Signed out',
  purchase: 'Purchase',
  chat_message: 'Support message',
  bid_placed: 'Bid placed',
  coupon_applied: 'Coupon applied',
  user_created: 'Account created',
  password_change: 'Password changed',
}

// Human-readable names for the ActivityLog.actionType enum.
export const ACTION_TYPE_LABELS: Record<string, string> = {
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  LOGIN_FAILED: 'Failed sign-in',
  REGISTER: 'Account created',
  DEPOSIT: 'Deposit',
  BID_PLACED: 'Bid placed',
  BID_CANCEL_REQUESTED: 'Cancellation requested',
  BID_CANCEL_APPROVED: 'Cancellation approved',
  BID_CANCEL_REJECTED: 'Cancellation rejected',
  BID_WON: 'Auction won',
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  PROFILE_CHANGED: 'Account updated',
  ADMIN_ACTION: 'Account adjustment',
}

// "balance_adjust" → "Balance adjustment"; unknown keys fall back to a
// readable title-cased version so a raw enum can never leak through.
export function humanizeActionKey(key: string | null | undefined): string | null {
  if (!key) return null
  const known = ACTION_KEY_LABELS[key]
  if (known) return known
  const spaced = key.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return null
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// "Chrome on Windows" — a friendly device summary. The raw user-agent header is
// never shown to the user, but knowing which device signed in is genuinely
// useful. Returns null when nothing can be recognised.
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  const browser =
    /Edg[A-Z]?\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /CriOS\//.test(ua) ? 'Chrome' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' :
    null
  const os =
    /Windows NT/.test(ua) ? 'Windows' :
    /Android/.test(ua) ? 'Android' :
    /iPhone/.test(ua) ? 'iPhone' :
    /iPad/.test(ua) ? 'iPad' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /CrOS/.test(ua) ? 'ChromeOS' :
    /Linux/.test(ua) ? 'Linux' :
    null
  if (browser && os) return `${browser} on ${os}`
  return browser || os
}

// `+$40.00` / `-$6.99` — the sign *is* the colour cue in the UI.
export function formatSignedUsd(amount: number): string {
  const abs = Math.abs(amount).toFixed(2)
  return `${amount < 0 ? '-' : '+'}$${abs}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Last line of defence for descriptions written before this view existed (or by
// routes that interpolate emails / hashes into their text).
export function scrubPrivateText(text: string, selfEmail?: string | null): string {
  let out = text || ''
  if (selfEmail) out = out.replace(new RegExp(escapeRegExp(selfEmail), 'gi'), 'your account')
  // Any remaining address belongs to somebody we must not name.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'a customer account')
  // Blockchain hashes are tracing data — the audit trail keeps them.
  out = out.replace(/\s*\(TX:\s*[^)]*\)/gi, '')
  // Balance snapshots only make sense next to each other in the audit trail.
  out = out.replace(/\s*New balance:\s*[\d.,]+/gi, '')
  // Belt and braces: strip anything that looks like a reference id.
  out = out.replace(/\b(?:ADM|TXN|LOG|CHAT|ORD|BID)-[A-Z0-9]{4,}\b/gi, '')
  return out.replace(/\s{2,}/g, ' ').trim()
}

export interface UserActivitySource {
  actionType: string
  action?: string | null
  description?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  userAgent?: string | null
  userEmail?: string | null
  /** Set by the API for sign-ins from a device the account had not used before. */
  newDevice?: boolean
}

export interface UserActivityView {
  /** Human-readable action name — never an enum. */
  typeLabel: string
  /** One clean sentence describing what happened. */
  description: string
  /** Admin-supplied reason, when there is one. */
  reason: string | null
  /** Signed amount so the UI can colour it green (credit) or red (debit). */
  amount: number | null
  /** Who did it, when it was not the user (display name only). */
  actorName: string | null
  /** Friendly device summary for sign-ins. */
  device: string | null
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && isFinite(n) ? n : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function money(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`
}

// Build everything the buyer is allowed to see for a single log entry.
export function buildUserActivityView(log: UserActivitySource): UserActivityView {
  const md = (log.metadata && typeof log.metadata === 'object' ? log.metadata : {}) as Record<string, unknown>
  const actionKey = str(md.action)
  const amount = num(md.amount)
  const device = summarizeUserAgent(log.userAgent)
  const reason = str(md.reason) || str(md.adminNote)
  const fallbackDescription = () => scrubPrivateText(log.description || '', log.userEmail)

  const base: UserActivityView = {
    typeLabel:
      humanizeActionKey(actionKey) ||
      ACTION_TYPE_LABELS[log.actionType] ||
      humanizeActionKey(log.actionType) ||
      'Account activity',
    description: fallbackDescription(),
    reason: reason ? scrubPrivateText(reason, log.userEmail) : null,
    amount: null,
    actorName: null,
    device: null,
  }

  switch (log.actionType) {
    case 'LOGIN': {
      base.description = device
        ? `${log.newDevice ? 'New device · ' : ''}${device}`
        : 'You signed in'
      base.device = device
      base.reason = null
      return base
    }

    case 'LOGIN_FAILED': {
      base.description = md.reason === 'account_banned'
        ? 'Sign-in blocked — this account is suspended'
        : 'A sign-in attempt failed'
      base.reason = null
      return base
    }

    case 'LOGOUT': {
      base.description = 'You signed out'
      base.reason = null
      return base
    }

    case 'REGISTER': {
      base.description = md.provider === 'google'
        ? 'Your account was created with Google'
        : 'Your account was created'
      base.reason = null
      return base
    }

    case 'PROFILE_CHANGED': {
      base.description = /password/i.test(log.action || '')
        ? 'Your password was changed'
        : 'Your account details were updated'
      base.reason = null
      return base
    }

    case 'DEPOSIT': {
      const network = str(md.network)
      const via = network && network !== 'ADMIN' ? ` via ${network}` : ''
      if (amount !== null) {
        if (log.status === 'FAILED') {
          base.description = `Your ${money(amount)} deposit${via} was rejected`
        } else if (log.status === 'PENDING') {
          base.description = `You deposited ${money(amount)}${via}`
          base.amount = amount
        } else {
          base.description = `Your ${money(amount)} deposit${via} was approved`
          base.amount = amount
        }
      }
      base.actorName = str(md.approvedBy) || str(md.rejectedBy) ? ADMIN_ACTOR_NAME : null
      return base
    }

    case 'PURCHASE': {
      const productName = str(md.productName)
      const quantity = num(md.quantity) ?? 1
      const total = num(md.total)
      if (log.status !== 'FAILED' && productName) {
        base.description = `You purchased ${quantity > 1 ? `${quantity} × ` : ''}${productName}`
        base.amount = total !== null ? -Math.abs(total) : null
      }
      base.reason = null
      return base
    }

    case 'ADMIN_ACTION': {
      base.actorName = ADMIN_ACTOR_NAME
      base.reason = null
      if (actionKey === 'balance_adjust' && amount !== null) {
        base.typeLabel = 'Balance adjustment'
        base.description = `${ADMIN_ACTOR_NAME} ${amount < 0 ? 'deducted' : 'credited'} ${money(amount)} ${amount < 0 ? 'from' : 'to'} your account`
        base.amount = amount
        base.reason = reason ? scrubPrivateText(reason, log.userEmail) : null
        return base
      }
      if (actionKey === 'deposit_approve' || actionKey === 'deposit_reject') {
        base.description = `${ADMIN_ACTOR_NAME} ${actionKey === 'deposit_approve' ? 'approved' : 'rejected'} your deposit`
        base.reason = reason ? scrubPrivateText(reason, log.userEmail) : null
        return base
      }
      // Unknown internal action: keep it vague rather than risk a leak.
      base.description = `${ADMIN_ACTOR_NAME} made a change to your account`
      return base
    }

    default:
      return base
  }
}

// Parse the JSON `metadata` column. Returns null when empty/invalid.
export function parseLogMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
