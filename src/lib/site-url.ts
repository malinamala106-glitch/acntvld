/**
 * Canonical origin of this deployment.
 *
 * Why this module exists: the app used to inline `process.env.NEXT_PUBLIC_SITE_URL
 * || 'http://localhost:3000'` at each call site. If the variable was missing from
 * the Vercel project the app silently produced localhost URLs — which is how a
 * deployed site ended up redirecting people to http://localhost:3000 (Google
 * OAuth redirect_uri, canonical tags, sitemap.xml, robots.txt).
 *
 * Resolution order (server):
 *   1. SITE_URL               — explicit override, never baked into the client bundle
 *   2. NEXT_PUBLIC_SITE_URL   — inlined into the browser bundle at build time
 *   3. VERCEL_URL             — set automatically by Vercel on every deployment,
 *                               so a forgotten env var degrades to the real
 *                               deployment host instead of localhost
 *   4. the caller's fallback
 *
 * Only NEXT_PUBLIC_* survives into the client bundle, so browser code must use
 * `publicSiteUrl()`; `process.env.SITE_URL` reads as undefined there.
 */

/** Used only when nothing at all is configured, i.e. a developer laptop. */
const DEV_ORIGIN = 'http://localhost:3000'

let warned = false

/** Parse an origin, dropping any trailing slash or path. Returns null if unusable. */
function toOrigin(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

/**
 * The configured site origin, or null when the app has no idea where it lives.
 *
 * Callers that *redirect* traffic must use this rather than `serverSiteUrl()`:
 * a canonical-host redirect built from a localhost fallback would 308 every real
 * visitor off the deployed domain and onto their own machine.
 */
export function configuredSiteUrl(): string | null {
  return (
    toOrigin(process.env.SITE_URL) ??
    toOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    (process.env.VERCEL_URL ? toOrigin(`https://${process.env.VERCEL_URL}`) : null)
  )
}

/**
 * Server-side origin. Falls back to `http://localhost:3000` only outside
 * production, or when a caller supplies a request-derived fallback.
 */
export function serverSiteUrl(fallback?: string): string {
  const configured = configuredSiteUrl()
  if (configured) return configured

  if (process.env.NODE_ENV === 'production' && !fallback && !warned) {
    warned = true
    console.warn(
      '[site-url] SITE_URL / NEXT_PUBLIC_SITE_URL are not set. Falling back to ' +
        `${DEV_ORIGIN}. Set NEXT_PUBLIC_SITE_URL in your host's environment — ` +
        'emails, OAuth callbacks, sitemap.xml and canonical tags will point at the wrong host.'
    )
  }

  return toOrigin(fallback) ?? DEV_ORIGIN
}

/**
 * Client-safe origin. `process.env` in the browser only contains NEXT_PUBLIC_*
 * values, so this must not reference any other variable.
 */
export function publicSiteUrl(): string {
  return toOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEV_ORIGIN
}

/** Join the site origin with a path, without producing a double slash. */
export function siteUrl(path = '/'): string {
  return new URL(path, serverSiteUrl() + '/').toString()
}
