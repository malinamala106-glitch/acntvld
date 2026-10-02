import { NextResponse } from 'next/server'

/**
 * Fixed-window rate limiter.
 *
 * Scope of this implementation, honestly: counters live in the process's
 * memory. That is exactly right for a single long-running Node server, which
 * is what this app runs as today. It is NOT sufficient once you scale to more
 * than one instance or move to serverless — each instance would keep its own
 * counters, so the effective limit multiplies by the instance count.
 *
 * When that day comes, swap the two functions below for an Upstash Redis
 * (`@upstash/ratelimit`) or Vercel KV backed implementation. The call sites
 * only depend on `rateLimit()` returning a result, so nothing else changes.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

// Bound memory: sweep expired buckets periodically, and hard-reset if a
// caller floods us with unique keys (e.g. spoofed IPs) faster than they expire.
const SWEEP_INTERVAL_MS = 60_000
const MAX_TRACKED_KEYS = 20_000
let lastSweep = 0

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size > MAX_TRACKED_KEYS) buckets.clear()
}

export interface RateLimitOptions {
  /** Bucket namespace, e.g. 'auth:login'. Keeps limits independent per route. */
  scope: string
  /** Stable identity for the caller — an IP, a user id, or an email. */
  identifier: string
  /** Maximum requests permitted inside the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Count one request against a bucket and report whether it is allowed.
 *
 * Fails *open* by design: if this ever throws, the caller should still serve
 * the request rather than lock everyone out of the site.
 */
export function rateLimit({ scope, identifier, limit, windowMs }: RateLimitOptions): RateLimitResult {
  try {
    const now = Date.now()
    sweep(now)

    const key = `${scope}:${identifier}`
    const existing = buckets.get(key)

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 }
    }

    existing.count += 1
    if (existing.count > limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      }
    }
    return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 }
  } catch {
    return { ok: true, remaining: 1, retryAfterSeconds: 0 }
  }
}

/**
 * Identify the caller for rate-limit buckets.
 *
 * `X-Forwarded-For` is client-*appendable*: anyone can send
 * `X-Forwarded-For: 1.2.3.4`, and until this fix every "per-IP" bucket on the
 * site keyed off that value — so the signup, login, password-reset and upload
 * limits could be walked straight past by rotating the header. Verified in the
 * 2026-10-02 audit: five signups returned 429, then two more with a fresh XFF
 * returned 200, and 12 login attempts with distinct XFFs never tripped the
 * per-IP limiter.
 *
 * What is trusted now, in order:
 *   1. Headers a reverse proxy / platform *overwrites* (rather than appends):
 *      Cloudflare `cf-connecting-ip`, Fly.io `fly-client-ip`, Vercel/most proxies
 *      `x-real-ip`. Plain `x-forwarded-for` is deliberately ignored.
 *   2. The socket's own remote address, where the runtime exposes it.
 *   3. `unknown` — one shared bucket. That errs strict, never loose.
 *
 * Deployment note: whatever fronts this app must overwrite the headers above.
 * With no proxy, every visitor shares the `unknown` bucket and legit traffic
 * gets throttled — so put a proxy/CDN in front, and keep the per-identity limits
 * (per email on login, per user id elsewhere) as the primary control.
 */
export function clientIp(req: Request, fallback = 'unknown'): string {
  const trusted =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('fly-client-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-vercel-forwarded-for')
  if (trusted) {
    const first = trusted.split(',')[0]?.trim()
    if (first) return first
  }
  const socket = (req as unknown as { socket?: { remoteAddress?: string } }).socket
  if (socket?.remoteAddress) return socket.remoteAddress
  return fallback
}

/** Standard 429 response with a Retry-After header. */
export function rateLimitResponse(result: RateLimitResult, message = 'Too many requests. Please slow down and try again shortly.') {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSeconds) },
    }
  )
}
