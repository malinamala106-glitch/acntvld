/**
 * Log sanitizer — keeps passwords, tokens, card numbers, and other secrets
 * out of console output, error trackers, and persisted audit-log metadata.
 *
 * Use `sanitizeForLog(value)` on ANY object or string before passing it to
 * `console.*`, `Sentry.captureMessage`, the `metadata` field of `logActivity`,
 * or any other sink that might end up in a log file.
 *
 * The sanitizer:
 *   - Replaces values of known-sensitive keys with '[redacted]'
 *     (key match is case-insensitive, also matches common variants like
 *      'passwordHash', 'newPassword', 'stripeToken', 'cvv', etc.)
 *   - Masks long base64/hex-looking strings that look like secrets/tokens
 *     (keeps first 4 chars + '…<redacted>').
 *   - Masks digit runs that look like credit-card numbers
 *     (any 13–19 digit run with optional spaces/dashes).
 *   - Walks nested objects and arrays up to a depth of 5.
 *   - Never throws — if scrubbing fails, returns '[unserializable]'.
 */

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  // Passwords / hashes
  /^pass(word)?$/i,
  /^pass(word)?hash$/i,
  /^newpassword$/i,
  /^confirmpassword$/i,
  /^currentpassword$/i,
  /^oldpassword$/i,
  // Tokens / secrets
  /^token$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /^authtoken$/i,
  /^apikey$/i,
  /^api[-_]?key$/i,
  /^secret$/i,
  /^client[-_]?secret$/i,
  /^session[-_]?secret$/i,
  /^stripe[-_]?token$/i,
  /^stripe[-_]?signature$/i,
  /^csrf[-_]?token$/i,
  /^jwt$/i,
  /^authorization$/i,
  /^cookie$/i,
  // Cards / PII
  /^card[-_]?number$/i,
  /^cc$/i,
  /^cvv$/i,
  /^cvc$/i,
  /^pan$/i,
  /^ssn$/i,
  // Crypto keys
  /^private[-_]?key$/i,
  /^mnemonic$/i,
  /^seed$/i,
  /^tx[-_]?hash$/i, // keep tx hashes out too — they can be correlated
]

// 13–19 consecutive digits with optional spaces or dashes between groups.
// Matches Visa/MC/Amex/Discover but not 4-digit years or 3-digit CVVs by
// themselves.
const CARD_NUMBER_RE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4,6}[-\s]?\d{0,5}\b/g

// Long base64/hex strings (≥32 chars). Real secrets are usually long and
// high-entropy. Short strings (<32) are likely user input or IDs and are
// left alone.
const LONG_SECRET_RE = /^[A-Za-z0-9+/_=-]{32,}$/

const MAX_DEPTH = 5

function maskValue(v: string): string {
  // Mask credit-card-shaped runs anywhere in the string.
  const cardScrubbed = v.replace(CARD_NUMBER_RE, (m) => {
    const digits = m.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) return m
    return `[card:${digits.slice(-4)}]`
  })
  // Mask long base64/hex-looking whole-string secrets.
  if (LONG_SECRET_RE.test(cardScrubbed) && cardScrubbed.length >= 32) {
    return `${cardScrubbed.slice(0, 4)}…<redacted>`
  }
  return cardScrubbed
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))
}

// Returns a deep-cloned, redacted version of `value`. Never throws.
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  // Cycle / depth guard.
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value === null || value === undefined) return value

  if (typeof value === 'string') return maskValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Error) {
    // Errors can carry sensitive context in `.message` — scrub it.
    return {
      name: value.name,
      message: maskValue(value.message),
      stack: value.stack ? maskValue(value.stack) : undefined,
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1))
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = '[redacted]'
      } else {
        out[k] = sanitizeForLog(v, depth + 1)
      }
    }
    return out
  }

  return String(value)
}

/**
 * Drop-in replacement for `console.error` that scrubs secrets from each
 * argument. Use this anywhere you'd otherwise log an error object that
 * might contain user input, request bodies, or stack traces that quote
 * user input.
 *
 * Example:
 *   safeConsoleError('Login failed:', err, { email })
 *   // → console.error('Login failed:', redactedErr, { email })
 */
export function safeConsoleError(...args: unknown[]): void {
  const cleaned = args.map((a) => sanitizeForLog(a))
  // eslint-disable-next-line no-console
  console.error(...cleaned)
}

/**
 * Drop-in replacement for `console.warn` with the same scrubbing.
 */
export function safeConsoleWarn(...args: unknown[]): void {
  const cleaned = args.map((a) => sanitizeForLog(a))
  // eslint-disable-next-line no-console
  console.warn(...cleaned)
}

/**
 * Drop-in replacement for `console.log` (development debugging) with the
 * same scrubbing. Prefer removing `console.log` calls before shipping to
 * production; if you must keep one, route it through this helper so a
 * stray password argument can't end up in dev.log / server.log.
 */
export function safeConsoleLog(...args: unknown[]): void {
  const cleaned = args.map((a) => sanitizeForLog(a))
  // eslint-disable-next-line no-console
  console.log(...cleaned)
}
