import { NextResponse, type NextRequest } from 'next/server'

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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (siteUrl) {
      let canonicalOrigin: string | null = null
      try {
        canonicalOrigin = new URL(siteUrl).origin
      } catch {
        // Invalid env value — don't break the site over a config typo.
        canonicalOrigin = null
      }
      if (canonicalOrigin && req.nextUrl.origin !== canonicalOrigin) {
        return applySecurityHeaders(
          NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, canonicalOrigin), 308),
          isDev
        )
      }
    }
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
