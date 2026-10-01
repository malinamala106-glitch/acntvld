import crypto from 'crypto'

export const SESSION_COOKIE = 'da_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days
export const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

// Secrets that have ever shipped in this repository. If one of these is the
// live SESSION_SECRET in production, every session cookie on the site is
// forgeable by anyone who can read the source — so we refuse to boot.
const PLACEHOLDER_SECRETS = new Set([
  'dev-secret-change-me-in-production-please',
  'local-dev-only-secret-do-not-ship',
])

const MIN_SECRET_LENGTH = 32

let cachedSecret: string | null = null

/**
 * Resolve the HMAC key used to sign session cookies.
 *
 * In production a missing, placeholder, or short secret is a hard startup
 * failure. Failing loudly is the point: the alternative is a site that looks
 * healthy while handing out forgeable admin sessions. In development we fall
 * back to a known constant so `bun run dev` works with no setup.
 */
function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret

  const raw = process.env.SESSION_SECRET
  const isProd = process.env.NODE_ENV === 'production'
  const unusable = !raw || PLACEHOLDER_SECRETS.has(raw) || raw.length < MIN_SECRET_LENGTH

  if (unusable) {
    if (isProd) {
      throw new Error(
        'SESSION_SECRET is missing, a known placeholder, or shorter than 32 characters. ' +
          'Session cookies signed with it would be forgeable. Generate one with ' +
          '`openssl rand -base64 48` (or `bun -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`) ' +
          'and set it as an environment variable before deploying.'
      )
    }
    cachedSecret = raw || 'dev-secret-change-me-in-production-please'
    return cachedSecret
  }

  cachedSecret = raw
  return cachedSecret
}

// ---------------------------------------------------------------------------
// Passwords — scrypt (Node built-in, no native dependency)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  // A truncated or non-hex stored hash would make timingSafeEqual throw and
  // turn a wrong password into a 500. Treat malformed input as "no match".
  if (!/^[0-9a-f]+$/.test(hash) || hash.length % 2 !== 0) return false
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex')
  return safeEqual(hash, candidate)
}

// ---------------------------------------------------------------------------
// Session tokens — signed payload: base64url(JSON) . base64url(HMAC)
// ---------------------------------------------------------------------------

export interface SessionPayload {
  /** user id */
  sub: string
  /** user.sessionVersion at signing time — bump it to revoke every session */
  v: number
  /** absolute expiry, unix seconds */
  exp: number
}

/** Length-safe, timing-safe string comparison (cookie MACs, hashes). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url')
}

/**
 * Sign a session token.
 *
 * The payload carries its own expiry and the user's session version, so the
 * server can reject a token on its own merits — a cookie's `maxAge` is only a
 * hint to the browser and does nothing to stop a captured value being replayed.
 */
export function signToken(userId: string, sessionVersion: number, maxAgeSeconds: number): string {
  const payload: SessionPayload = {
    sub: userId,
    v: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

/**
 * Verify signature + shape + expiry. Returns the payload, or null for
 * anything untrusted. Session *version* is checked against the database in
 * getCurrentUser(), which is the only place that has the user row.
 */
export function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, mac] = parts
  if (!body || !mac) return null
  if (!safeEqual(mac, sign(body))) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (
      !parsed ||
      typeof parsed.sub !== 'string' ||
      typeof parsed.v !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    if (parsed.exp * 1000 <= Date.now()) return null
    return parsed as SessionPayload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Set-password (one-time) tokens — same wire format as session tokens, but
// tagged with `purpose: 'reset'` so a session cookie can never be replayed as
// a password-reset link (or vice versa).
//
// The token embeds the user's current sessionVersion. Consuming it bumps that
// version, which both signs the user out everywhere and makes the link
// single-use: a second attempt fails the version check.
// ---------------------------------------------------------------------------

interface ResetPayload extends SessionPayload {
  purpose: 'reset'
}

export function signResetToken(userId: string, sessionVersion: number, maxAgeSeconds: number): string {
  const payload: ResetPayload = {
    sub: userId,
    v: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    purpose: 'reset',
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyResetToken(token: string): ResetPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, mac] = parts
  if (!body || !mac) return null
  if (!safeEqual(mac, sign(body))) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (
      !parsed ||
      typeof parsed.sub !== 'string' ||
      typeof parsed.v !== 'number' ||
      typeof parsed.exp !== 'number' ||
      parsed.purpose !== 'reset'
    ) {
      return null
    }
    if (parsed.exp * 1000 <= Date.now()) return null
    return parsed as ResetPayload
  } catch {
    return null
  }
}
