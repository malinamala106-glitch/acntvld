import { NextResponse, type NextRequest } from 'next/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { configuredSiteUrl } from '@/lib/site-url'

// ---------------------------------------------------------------------------
// Request guards that have to run before a route handler (audit 2026-10-02)
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Body cap for JSON APIs, in bytes.
 *
 * Every JSON endpoint in this app takes kilobytes: a license-key paste, a chat
 * message (capped at 2000 chars), a blog post. Before this cap an anonymous
 * caller could make the server buffer and JSON.parse a ~9MB body per request
 * (measured), which the runtime only stopped at ~10MB — too high to be a
 * product decision. Multipart upload routes are exempt because they legitimately
 * carry up to 5MB (chat) / 2MB (product image) and validate their own size.
 */
const JSON_BODY_LIMIT_BYTES = 256 * 1024
const UPLOAD_ROUTES = new Set(['/api/chat/upload', '/api/admin/products/upload'])

/**
 * Requests per minute per caller across the whole API.
 *
 * The audit found 1000/1000 requests to /api/products served with no limit at
 * all. This is a blunt backstop; the per-route limiters in lib/rate-limit.ts
 * remain the fine-grained control. Off in development so local testing and
 * test suites aren't throttled — set API_RATE_LIMIT_PER_MIN to change or enable
 * it. A high ceiling is deliberate: the point is to stop floods, not to get in
 * the way of the chat widget's 1s polling.
 */
function apiRateLimit(req: NextRequest): NextResponse | null {
  const configured = Number(process.env.API_RATE_LIMIT_PER_MIN ?? '')
  const limit = Number.isFinite(configured) && configured > 0
    ? configured
    : process.env.NODE_ENV === 'production'
      ? 300
      : 0
  if (limit === 0) return null

  const result = rateLimit({
    scope: 'api:global',
    identifier: clientIp(req),
    limit,
    windowMs: 60 * 1000,
  })
  if (result.ok) return null
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  )
}

/**
 * CSRF guard for state-changing API calls.
 *
 * The session cookie is `SameSite=Lax`, which already stops a cross-site
 * *form post* from carrying credentials — that is the real protection and it
 * stays. This is the second line: if a browser does send an `Origin` (or a
 * cross-site `Sec-Fetch-Site`) for a mutating request, refuse it instead of
 * trusting the cookie's attributes alone.
 *
 * Deliberately self-configuring: it compares against the *request's own*
 * origin, not an env var, so it cannot break a deployment whose host name
 * differs from NEXT_PUBLIC_SITE_URL. Requests with no `Origin` (server-to-server
 * clients, curl, native apps) are allowed — they are not browser-driven and
 * therefore not subject to CSRF.
 */
function csrfGuard(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method)) return null

  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }

  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') return null
  let originUrl: URL | null = null
  try {
    originUrl = new URL(origin)
  } catch {
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }
  if (originUrl.origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }
  return null
}

/** Oversized JSON body guard. */
function bodyGuard(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method)) return null
  const { pathname } = req.nextUrl
  if (!pathname.startsWith('/api/') || UPLOAD_ROUTES.has(pathname)) return null

  const length = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > JSON_BODY_LIMIT_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
  }
  return null
}


/**
 * Security headers + HTTPS enforcement + host canonicalisation.
 *
 * Replaces the former src/middleware.ts (Next 16's proxy convention; the old
 * filename still works but proxy.ts is the supported path going forward).
 *
 * Gating:
 *   - HTTPS/canonical redirect: production only (local dev serves plain HTTP).
 *   - CSP: relaxed in dev (Next HMR needs 'unsafe-eval' + ws:); enforced in
 *     production. style-src keeps 'unsafe-inline' because Tailwind's runtime
 *     utilities and Next's inline styles require it.
 *   - Every other header: always on.
 *
 * Set NEXT_PUBLIC_SITE_URL to the production origin (e.g. https://example.com)
 * and every request on another host — http://, the apex when www is canonical,
 * or vice versa — gets a 308 redirect to the same path on the canonical origin.
 * This consolidates all duplicate-host variants onto one URL, which is what
 * search engines treat as the real site.
 *
 * NOTE on CSP and tracking scripts: the site has an admin-configurable
 * tracking system (GTM/GA4/Meta…). Those vendors are covered by the
 * script-src/connect-src/img-src allowances below. If you add a vendor that
 * loads from a new origin, extend those directives — an over-tight CSP here
 * would silently break admin-configured analytics.
 */
function applySecurityHeaders(res: NextResponse, isDev: boolean): NextResponse {
  const csp = [
    "default-src 'self'",
    // Next 16 dev needs eval for HMR; production doesn't.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://www.googletagmanager.com https://www.google-analytics.com https://*.clarity.ms https://static.cloudflareinsights.com`,
    // Inline styles are required by Tailwind runtime + Next inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com https://*.clarity.ms https://www.clarity.ms",
    "font-src 'self' data:",
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://*.clarity.ms https://www.clarity.ms https://*.ingest.sentry.io",
    "frame-src 'self' https://www.googletagmanager.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    // No manifest needed; harmless to leave unset.
    "upgrade-insecure-requests",
  ].join('; ')

  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.headers.set('X-DNS-Prefetch-Control', 'on')
  if (!isDev) {
    // Only meaningful over HTTPS; harmless locally but skipped to keep dev
    // responses identical to a plain-HTTP origin.
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    )
  }
  return res
}

export function proxy(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production'

  // --- Canonical host + HTTPS ---------------------------------------------
  if (!isDev) {
    // configuredSiteUrl() returns null when nothing is configured. That matters
    // here: falling back to http://localhost:3000 would make this branch 308
    // every real visitor off the deployed domain onto their own machine.
    const configured = configuredSiteUrl()
    if (configured) {
      const canonicalOrigin = configured
      if (req.nextUrl.origin !== canonicalOrigin) {
        return applySecurityHeaders(
          NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, canonicalOrigin), 308),
          isDev
        )
      }
    }
  }

  // --- Pre-handler guards (API routes only) --------------------------------
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const blocked = bodyGuard(req) ?? csrfGuard(req) ?? apiRateLimit(req)
    if (blocked) return applySecurityHeaders(blocked, isDev)
  }

  return applySecurityHeaders(NextResponse.next(), isDev)
}

// Next 16 supports both names; exporting as middleware too keeps tooling that
// still looks for it happy. Only one of them runs — Next dedupes by filename.
export const middleware = proxy

export const config = {
  // Skip Next internals and static files — headers for those are set in
  // next.config.ts (Cache-Control) and this keeps the proxy off hot paths.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads/).*)'],
}
