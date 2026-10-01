import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'

/**
 * THREAT MODEL — why tracking scripts are stored and rendered raw.
 *
 * The tracking head/body fields are INTENTIONAL raw-HTML/JS injection: their
 * entire purpose is to run third-party analytics JavaScript (GA4, GTM, Meta
 * Pixel…) that the site owner pastes from a vendor dashboard. Unlike every
 * other admin-authored field, these cannot be sanitized with DOMPurify or
 * rendered as text — stripping scripts would strip the feature.
 *
 * What that means, honestly:
 *   - Anyone with `PATCH /api/admin/tracking` access can run arbitrary JS on
 *     every public page (steal cookies, keylog, redirect). This is true of
 *     every paste-your-analytics-snippet feature on the internet.
 *   - Therefore the security boundary is the ADMIN ACCOUNT, not the field
 *     content. Protecting the field means protecting admin credentials
 *     (hashed passwords, signed sessions, session revocation, rate-limited
 *     login — see src/lib/password.ts and src/lib/auth.ts).
 *
 * Defense-in-depth applied at the WRITE path (PATCH /api/admin/tracking),
 * because nothing at the read path can distinguish "GA4 snippet" from
 * "malicious snippet":
 *   1. requireAdmin() — only admins can write (403 otherwise).
 *   2. Rate limited — slows a stolen-cookie or XSS-driven attempt to spam
 *      payloads into the field.
 *   3. Optional inline-script allowlist — `tracking_allow_inline` must be
 *      enabled by a separate admin action before snippets WITHOUT a
 *      whitelisted `src` (pure inline JS) are accepted. Analytics vendors
 *      that ship a <script src=…> tag work with the toggle off; turning it
 *      on is a conscious, audited decision.
 *   4. Domain whitelist on every external src — script tags may only load
 *      from the vetted analytics CDNs in ALLOWED_DOMAINS (route file).
 *   5. Iframe/fetch/XSS pattern refusal — obvious exfiltration vectors
 *      (cross-origin iframes, document.cookie exfiltration, fetch() to
 *      non-vetted origins, event-handler attributes) are rejected at save
 *      time with a clear error, rather than silently rewritten.
 *   6. Size caps and script-count cap — bounding blast radius and DB size.
 *   7. Audit trail — every change is logged (who/when/what lengths/IP/UA)
 *      via logActivity.
 *
 * Read path mitigations (TrackingScripts.tsx): scripts never render for
 * admin users or admin paths, honor an off toggle and a production-only
 * toggle. They cannot be escaped for guests — that is the feature.
 *
 * If this compromise is ever unacceptable, the alternative is dropping raw
 * snippets entirely and integrating analytics through a build-time config
 * (e.g. @next/third-parties) — code-reviewed per change, no runtime paste.
 */
export interface TrackingSettings {
  enabled: boolean
  prodOnly: boolean
  headScripts: string
  bodyScripts: string
}

// Cached fetcher — revalidated every 60 seconds or on tag 'tracking' invalidation.
// Called from the TrackingScripts server component (no admin required — public read).
export const getTrackingSettings = unstable_cache(
  async (): Promise<TrackingSettings> => {
    const rows = await db.setting.findMany({
      where: {
        key: {
          in: [
            'tracking_enabled',
            'tracking_prod_only',
            'tracking_head_scripts',
            'tracking_body_scripts',
            'tracking_allow_inline',
          ],
        },
      },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    return {
      enabled: map.tracking_enabled === 'true',
      prodOnly: map.tracking_prod_only === 'true',
      headScripts: map.tracking_head_scripts ?? '',
      bodyScripts: map.tracking_body_scripts ?? '',
    }
  },
  ['tracking-settings'],
  { tags: ['tracking'], revalidate: 60 }
)

/** Whether pure-inline (no whitelisted src) snippets may be stored. Read per-request by the admin route. */
export async function getTrackingAllowInline(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: 'tracking_allow_inline' } })
  return row?.value === 'true'
}
