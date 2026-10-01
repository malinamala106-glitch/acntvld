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

/** Convenience: read a client IP from proxy headers, with a safe fallback. */
export function clientIp(req: Request, fallback = 'unknown'): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0].trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || fallback
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
