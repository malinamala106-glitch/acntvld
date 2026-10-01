import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, requireAdmin } from '@/lib/auth'
import { revalidateContent } from '@/lib/cache'
import {
  buildContent,
  ALL_CONTENT_SETTING_KEYS,
  isContentFieldKey,
  CONTENT_SETTING_PREFIX,
  CONTENT_SECTIONS,
  NAV_LINKS_FIELD,
  NAV_LINKS_MAX,
  parseNavLinks,
  serializeNavLinks,
  sanitizeNavHref,
  FOOTER_CONFIG_FIELD,
  sanitizeFooterConfig,
  serializeFooterConfig,
} from '@/lib/site-content'

const PUBLIC_KEYS = ['minDepositAmount', 'siteName', 'supportEmail', 'telegramSupportUrl']

// Setting keys that are readable/writable through this public settings endpoint:
// the site-wide options plus every editable section-copy field (`content.*`),
// including the four static-page bodies.
const READABLE_KEYS = [...PUBLIC_KEYS, ...ALL_CONTENT_SETTING_KEYS]

/** Max stored length per content field (mirrors the schema in lib/site-content). */
const FIELD_LIMITS: Record<string, number> = (() => {
  const map: Record<string, number> = {}
  for (const section of CONTENT_SECTIONS) {
    for (const field of section.fields) map[field.key] = field.maxLength ?? 500
  }
  return map
})()

// Public: returns the public subset of settings (minDepositAmount, siteName,
// supportEmail, telegramSupportUrl) plus the editable section copy (`content`).
export async function GET() {
  const rows = await db.setting.findMany({ where: { key: { in: READABLE_KEYS } } })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return NextResponse.json({
    minDepositAmount: parseFloat(map.minDepositAmount ?? '0') || 0,
    siteName: map.siteName ?? 'DigitalVault',
    supportEmail: map.supportEmail ?? '',
    telegramSupportUrl: map.telegramSupportUrl ?? '',
    content: buildContent(rows),
  })
}

// Admin: update settings.
// body: { minDepositAmount?, siteName?, supportEmail?, content?: Record<string,string> }
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const updates: { key: string; value: string }[] = []

    if (typeof body.minDepositAmount === 'number' && body.minDepositAmount >= 0) {
      updates.push({ key: 'minDepositAmount', value: String(body.minDepositAmount) })
    }
    if (typeof body.siteName === 'string' && body.siteName.trim()) {
      updates.push({ key: 'siteName', value: body.siteName.trim().slice(0, 64) })
    }
    if (typeof body.supportEmail === 'string') {
      updates.push({ key: 'supportEmail', value: body.supportEmail.trim().slice(0, 128) })
    }

    // Section copy — only keys declared in the content schema are accepted, and
    // each value is clamped to its field's max length so a paste can't bloat a
    // heading. Unknown keys are silently ignored.
    if (body.content && typeof body.content === 'object' && !Array.isArray(body.content)) {
      // The nav links list arrives either as structured rows (add/remove UIs)
      // or as the JSON string the editor keeps in its values map. Both are
      // parsed, clamped, and href-sanitized before storage so a `javascript:`
      // URL can never be persisted; unparseable values are ignored entirely.
      const navRaw = (body.content as Record<string, unknown>)[NAV_LINKS_FIELD]
      let navInputs: ReturnType<typeof parseNavLinks> = null
      if (Array.isArray(navRaw)) {
        navInputs = parseNavLinks(JSON.stringify(navRaw.slice(0, NAV_LINKS_MAX)))
      } else if (typeof navRaw === 'string' && navRaw.trim()) {
        navInputs = parseNavLinks(navRaw)
      }
      if (navInputs) {
        const safe = navInputs
          .map((l) => {
            const href = sanitizeNavHref(l.href)
            return href ? { ...l, href } : null
          })
          .filter((l): l is NonNullable<typeof l> => l !== null)
        updates.push({ key: CONTENT_SETTING_PREFIX + NAV_LINKS_FIELD, value: serializeNavLinks(safe) })
      }

      // The footer layout object arrives as a JSON string from the visual
      // editor. It is coerced/sanitized (hex colors, padding bounds, hrefs)
      // before storage; an empty value clears it back to the shipped default.
      const footerRaw = (body.content as Record<string, unknown>)[FOOTER_CONFIG_FIELD]
      if (footerRaw !== undefined) {
        if (typeof footerRaw === 'string' && !footerRaw.trim()) {
          updates.push({ key: CONTENT_SETTING_PREFIX + FOOTER_CONFIG_FIELD, value: '' })
        } else {
          let parsedFooter: unknown = footerRaw
          if (typeof footerRaw === 'string') {
            try {
              parsedFooter = JSON.parse(footerRaw)
            } catch {
              parsedFooter = null
            }
          }
          if (parsedFooter && typeof parsedFooter === 'object') {
            updates.push({
              key: CONTENT_SETTING_PREFIX + FOOTER_CONFIG_FIELD,
              value: serializeFooterConfig(sanitizeFooterConfig(parsedFooter)),
            })
          }
        }
      }

      for (const [key, rawValue] of Object.entries(body.content as Record<string, unknown>)) {
        if (key === NAV_LINKS_FIELD) continue // handled above
        if (key === FOOTER_CONFIG_FIELD) continue // handled above
        if (!isContentFieldKey(key)) continue
        if (typeof rawValue !== 'string') continue
        // Trim outer whitespace but keep interior line breaks.
        updates.push({ key: CONTENT_SETTING_PREFIX + key, value: rawValue.trim().slice(0, FIELD_LIMITS[key] ?? 500) })
      }
    }

    for (const u of updates) {
      await db.setting.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value },
      })
    }

    // Settings feed every page render through the content cache.
    revalidateContent()

    const rows = await db.setting.findMany({ where: { key: { in: READABLE_KEYS } } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    return NextResponse.json({
      minDepositAmount: parseFloat(map.minDepositAmount ?? '0') || 0,
      siteName: map.siteName ?? 'DigitalVault',
      supportEmail: map.supportEmail ?? '',
      telegramSupportUrl: map.telegramSupportUrl ?? '',
      content: buildContent(rows),
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
