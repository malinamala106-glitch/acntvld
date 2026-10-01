import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { rateLimit, clientIp, rateLimitResponse } from '@/lib/rate-limit'
import { revalidateTag } from 'next/cache'

// Tracking settings keys stored in the Setting table
const TRACKING_KEYS = [
  'tracking_enabled',
  'tracking_prod_only',
  'tracking_head_scripts',
  'tracking_body_scripts',
  'tracking_allow_inline',
] as const

// Hard limits — bound blast radius and keep the payload cheap to render.
const MAX_SCRIPTS_LENGTH = 20_000 // per field (head / body)
const MAX_SCRIPT_TAGS = 20 // per field

// Whitelisted script domains — reject anything else for security
const ALLOWED_DOMAINS = [
  'googletagmanager.com',
  'google-analytics.com',
  'connect.facebook.net',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'google.com',
  'www.google.com',
  'googletag.services.com',
  'cdn.facebook.net',
  'static.ads-facebook.com',
  'analytics.facebook.com',
  'bat.bing.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'script.hotjar.com',
  'static.hotjar.com',
  't.clarity.ms',
  'www.clarity.ms',
  'plausible.io',
  'cdn.matomo.cloud',
  'tag.simpli.fi',
  'cdn.tagmanager.google.com',
]

// Patterns that indicate an exfiltration / injection vector rather than a
// legitimate analytics snippet. Matched case-insensitively on the raw HTML.
const SUSPICIOUS_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /\bon[a-z]+\s*=/i, reason: 'inline event handlers (on*=) are not allowed' },
  { regex: /document\.cookie/i, reason: 'document.cookie access is not allowed' },
  { regex: /localStorage|sessionStorage/i, reason: 'localStorage/sessionStorage access is not allowed' },
  { regex: /\bfetch\s*\(|XMLHttpRequest/i, reason: 'fetch()/XMLHttpRequest is not allowed — load vendor code via <script src>' },
  { regex: /document\.write/i, reason: 'document.write is not allowed' },
  { regex: /eval\s*\(|new\s+Function\s*\(/i, reason: 'eval()/new Function() is not allowed' },
  { regex: /\bwindow\.location\s*=/i, reason: 'window.location assignment (forced redirect) is not allowed' },
]

// Strip <html>, <head>, <body> wrapper tags if admin pastes them by mistake
function stripWrapperTags(html: string): string {
  return html
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .trim()
}

function isAllowedSrc(src: string): boolean {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:') return false // vendor CDNs are https-only
    const domain = url.hostname
    return ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))
  } catch {
    return false
  }
}

// Validate that script src attributes only point to whitelisted domains
function validateScriptDomains(html: string): string[] {
  const errors: string[] = []
  const srcRegex = /<script[^>]+src=["']([^"']+)["']/gi
  let match
  while ((match = srcRegex.exec(html)) !== null) {
    if (!isAllowedSrc(match[1])) {
      let domain = match[1]
      try {
        domain = new URL(match[1]).hostname
      } catch {}
      errors.push(`Script domain "${domain}" is not in the analytics whitelist.`)
    }
  }
  return errors
}

function validateScripts(html: string, opts: { allowInline: boolean }): string[] {
  const errors: string[] = []

  // Size + count caps
  if (html.length > MAX_SCRIPTS_LENGTH) {
    errors.push(`Snippet is ${html.length} characters — the limit is ${MAX_SCRIPTS_LENGTH}.`)
  }
  const scriptCount = (html.match(/<script\b/gi) ?? []).length
  if (scriptCount > MAX_SCRIPT_TAGS) {
    errors.push(`Snippet contains ${scriptCount} <script> tags — the limit is ${MAX_SCRIPT_TAGS}.`)
  }

  // Every <script> must be a plain script tag; deny closing-only fragments
  if (/<\/script/i.test(html) && !/<script\b/i.test(html)) {
    errors.push('Found </script> without an opening <script>.')
  }

  // Obvious exfiltration / injection patterns
  for (const { regex, reason } of SUSPICIOUS_PATTERNS) {
    if (regex.test(html)) {
      errors.push(`${reason}.`)
      break // one clear reason is enough
    }
  }

  // Domain whitelist for external script srcs…
  errors.push(...validateScriptDomains(html))

  // …and for iframe srcs (the GTM <noscript><iframe> paste is legitimate —
  // but only pointing at a vetted analytics domain, over https).
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)+["']/gi
  let iframeMatch
  while ((iframeMatch = iframeRegex.exec(html)) !== null) {
    if (!isAllowedSrc(iframeMatch[1])) {
      let domain = iframeMatch[1]
      try {
        domain = new URL(iframeMatch[1]).hostname
      } catch {}
      errors.push(`iframe domain "${domain}" is not in the analytics whitelist.`)
      break
    }
  }

  // …and the inline-script allowlist for snippets with NO whitelisted src.
  if (!opts.allowInline) {
    const hasSrc = /<script[^>]+src=["']([^"']+)["']/i.test(html)
    const hasPlainScript = /<script(?![^>]*\bsrc=)[^>]*>/i.test(html)
    if (hasPlainScript && !hasSrc) {
      errors.push(
        'Inline scripts (without a whitelisted src) are disabled. Paste the vendor snippet exactly as given — it normally loads from a whitelisted analytics domain — or explicitly enable "allow inline scripts" in the tracking settings.'
      )
    }
  }

  return errors
}

// GET /api/admin/tracking — admin-only, returns full tracking settings
export async function GET() {
  try {
    await requireAdmin()
    const rows = await db.setting.findMany({
      where: { key: { in: [...TRACKING_KEYS] } },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    return NextResponse.json({
      enabled: map.tracking_enabled === 'true',
      prodOnly: map.tracking_prod_only === 'true',
      allowInline: map.tracking_allow_inline === 'true',
      headScripts: map.tracking_head_scripts ?? '',
      bodyScripts: map.tracking_body_scripts ?? '',
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load tracking settings' }, { status: 500 })
  }
}

// PATCH /api/admin/tracking — admin-only, updates tracking settings
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()

    // Slow down a stolen-cookie or XSS-driven attempt to spam payloads here.
    const limit = rateLimit({
      scope: 'admin:tracking',
      identifier: clientIp(req),
      limit: 10,
      windowMs: 10 * 60 * 1000,
    })
    if (!limit.ok) {
      return rateLimitResponse(limit)
    }

    const body = await req.json()
    const { enabled, prodOnly, allowInline, headScripts, bodyScripts } = body || {}

    // The inline allowlist is a separate, audited switch — it only flips when
    // explicitly sent, so editing snippets alone can never widen the policy.
    let inlinePolicyChanged = false
    const updates: { key: string; value: string }[] = []
    if (typeof allowInline === 'boolean') {
      updates.push({ key: 'tracking_allow_inline', value: String(allowInline) })
      inlinePolicyChanged = true
    }

    // Read the *effective* inline policy: the new value if changing, else the stored one.
    const storedAllowInline = await db.setting
      .findUnique({ where: { key: 'tracking_allow_inline' } })
      .then((r) => r?.value === 'true')
    const effectiveAllowInline = typeof allowInline === 'boolean' ? allowInline : storedAllowInline

    // Validate + normalize head/body scripts
    let cleanHead = ''
    let cleanBody = ''
    if (typeof headScripts === 'string') {
      cleanHead = stripWrapperTags(headScripts)
      const errors = validateScripts(cleanHead, { allowInline: effectiveAllowInline })
      if (errors.length > 0) {
        return NextResponse.json({ error: `Script validation failed:\n${errors.join('\n')}` }, { status: 400 })
      }
    }
    if (typeof bodyScripts === 'string') {
      cleanBody = stripWrapperTags(bodyScripts)
      const errors = validateScripts(cleanBody, { allowInline: effectiveAllowInline })
      if (errors.length > 0) {
        return NextResponse.json({ error: `Script validation failed:\n${errors.join('\n')}` }, { status: 400 })
      }
    }

    // Fetch old values for audit log
    const oldRows = await db.setting.findMany({ where: { key: { in: [...TRACKING_KEYS] } } })
    const oldMap: Record<string, string> = {}
    for (const r of oldRows) oldMap[r.key] = r.value

    if (typeof enabled === 'boolean') updates.push({ key: 'tracking_enabled', value: String(enabled) })
    if (typeof prodOnly === 'boolean') updates.push({ key: 'tracking_prod_only', value: String(prodOnly) })
    if (typeof headScripts === 'string') updates.push({ key: 'tracking_head_scripts', value: cleanHead })
    if (typeof bodyScripts === 'string') updates.push({ key: 'tracking_body_scripts', value: cleanBody })

    for (const u of updates) {
      await db.setting.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value },
      })
    }

    // Revalidate cache so changes apply immediately (Next 16 requires an
    // explicit cache-life profile; expire:0 purges the entry right away).
    revalidateTag('tracking', { expire: 0 })

    // Log the change in the audit trail
    await logActivity({
      userId: admin.id,
      userEmail: admin.email,
      actionType: 'ADMIN_ACTION',
      action: 'Updated tracking settings',
      description: `Admin updated tracking settings: enabled=${enabled ?? oldMap.tracking_enabled ?? 'false'}, prodOnly=${prodOnly ?? oldMap.tracking_prod_only ?? 'false'}${inlinePolicyChanged ? `, allowInline=${String(allowInline)}` : ''}, headScripts=${cleanHead ? `${cleanHead.length} chars` : 'empty'}, bodyScripts=${cleanBody ? `${cleanBody.length} chars` : 'empty'}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ADM'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: {
        action: 'tracking_settings_update',
        oldEnabled: oldMap.tracking_enabled ?? 'false',
        newEnabled: String(enabled ?? oldMap.tracking_enabled === 'true'),
        oldHeadLength: (oldMap.tracking_head_scripts ?? '').length,
        newHeadLength: cleanHead.length,
        oldBodyLength: (oldMap.tracking_body_scripts ?? '').length,
        newBodyLength: cleanBody.length,
        ...(inlinePolicyChanged ? { inlinePolicyChanged: String(allowInline) } : {}),
      },
    })

    return NextResponse.json({
      enabled: typeof enabled === 'boolean' ? enabled : oldMap.tracking_enabled === 'true',
      prodOnly: typeof prodOnly === 'boolean' ? prodOnly : oldMap.tracking_prod_only === 'true',
      allowInline: effectiveAllowInline,
      headScripts: cleanHead || (typeof headScripts === 'string' ? '' : (oldMap.tracking_head_scripts ?? '')),
      bodyScripts: cleanBody || (typeof bodyScripts === 'string' ? '' : (oldMap.tracking_body_scripts ?? '')),
      message: 'Tracking settings saved. Changes apply immediately.',
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update tracking settings' }, { status: 500 })
  }
}
