/**
 * Editable site copy — section headers / footers.
 *
 * Every string an admin can change from the dashboard is declared here once.
 * Values live in the existing `Setting` key/value table under the `content.`
 * prefix, so no migration is needed: a key that was never saved simply falls
 * back to the `default` below (which is exactly the copy that used to be
 * hardcoded in the components).
 *
 * Consumers read through `contentValue(content, key)` so a missing/partial
 * `content` object can never render an empty heading.
 */

export interface ContentFieldDef {
  /** Setting key without the `content.` prefix, e.g. `marketplace.heroTitle`. */
  key: string
  label: string
  /** Short helper text shown under the input in the admin form. */
  hint?: string
  default: string
  /** Render as a textarea in the admin form (multi-line copy). */
  multiline?: boolean
  /** Textarea height when multiline (default 3). */
  rows?: number
  maxLength?: number
}

export interface ContentSectionDef {
  id: string
  label: string
  description?: string
  fields: ContentFieldDef[]
}

export const CONTENT_SECTIONS: ContentSectionDef[] = [
  {
    id: 'marketplace',
    label: 'Marketplace (home page)',
    description: 'The hero block at the top of the marketplace and the products section heading.',
    fields: [
      {
        key: 'marketplace.heroTitle',
        label: 'Hero heading',
        hint: 'Each line break becomes a line in the heading.',
        default: 'Browse digital goods,\npay only when ready.',
        multiline: true,
        maxLength: 160,
      },
      {
        key: 'marketplace.heroSubtitle',
        label: 'Hero subheading',
        default:
          'Software keys, licenses, and other digital assets — browse the marketplace freely. Sign in only when you want to buy.',
        multiline: true,
        maxLength: 300,
      },
      { key: 'marketplace.heroBadge1', label: 'Hero note 1', default: 'No account needed to browse', maxLength: 60 },
      { key: 'marketplace.heroBadge2', label: 'Hero note 2', default: 'Login at checkout', maxLength: 60 },
      { key: 'marketplace.sectionTitle', label: 'Products section heading', default: 'Marketplace', maxLength: 60 },
      {
        key: 'marketplace.sectionSubtitle',
        label: 'Products section subheading',
        default: 'Click a product to see details, or hit Buy to checkout.',
        maxLength: 160,
      },
      {
        key: 'marketplace.emptyText',
        label: 'Empty state message',
        hint: 'Shown when there are no products to browse.',
        default: 'No products available right now. Check back soon.',
        maxLength: 160,
      },
    ],
  },
  {
    id: 'specialDeal',
    label: 'Special Deal (auctions)',
    description: 'The hero block above the live auction grid.',
    fields: [
      { key: 'specialDeal.badge', label: 'Hero badge', default: 'Live auctions', maxLength: 40 },
      { key: 'specialDeal.heroTitle', label: 'Hero heading', default: 'Special deals on premium accounts', maxLength: 160 },
      {
        key: 'specialDeal.heroSubtitle',
        label: 'Hero subheading',
        default:
          "Bid on exclusive digital accounts. The highest bidder wins. Funds are locked from your wallet when you bid — refunded automatically if you're outbid, or released by admin on request.",
        multiline: true,
        maxLength: 400,
      },
      { key: 'specialDeal.heroBadge1', label: 'Hero note 1', default: 'Sign in required to bid', maxLength: 60 },
      { key: 'specialDeal.heroBadge2', label: 'Hero note 2', default: 'Highest bidder wins', maxLength: 60 },
      { key: 'specialDeal.heroBadge3', label: 'Hero note 3', default: 'Live countdown', maxLength: 60 },
      {
        key: 'specialDeal.emptyText',
        label: 'Empty state message',
        hint: 'Shown when no auctions are live.',
        default: 'No active special deals right now. Check back soon.',
        maxLength: 160,
      },
    ],
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'The heading block at the top of the blog index.',
    fields: [
      { key: 'blog.title', label: 'Page heading', default: 'Guides, deals & updates', maxLength: 120 },
      {
        key: 'blog.subtitle',
        label: 'Page subheading',
        default:
          'Tips for buying digital accounts safely, crypto deposit guides, weekly deal roundups, and platform updates.',
        multiline: true,
        maxLength: 300,
      },
      { key: 'blog.searchPlaceholder', label: 'Search box placeholder', default: 'Search posts...', maxLength: 60 },
      {
        key: 'blog.emptyText',
        label: 'Empty state message',
        hint: 'Shown when no posts are published.',
        default: 'No blog posts available right now.',
        maxLength: 160,
      },
    ],
  },
  {
    id: 'staticPages',
    label: 'Static pages (About / Contact / Terms / Privacy)',
    description:
      'Everything shown on the four static pages: title, subtitle and the page body. The body is formatted with simple Markdown — blank line between blocks, ## for section headings, - bullets, 1. numbered lists, **bold**, *italic* and [link text](https://example.com).',
    fields: [
      { key: 'about.title', label: 'About — title', default: 'About DigitalVault', maxLength: 120 },
      {
        key: 'about.subtitle',
        label: 'About — subtitle',
        default: 'A trusted marketplace for digital assets, license keys, and premium accounts.',
        maxLength: 200,
      },
      {
        key: 'about.body',
        label: 'About — body',
        default: [
          '## Our mission',
          '',
          "DigitalVault was built to make buying and selling digital assets simple, transparent, and secure. Whether you're looking for a software license key, a VPN subscription, or a premium streaming account, our marketplace connects buyers with verified sellers — with crypto deposits and instant delivery.",
          '',
          '## What we offer',
          '',
          '- **License keys & software** — Windows, Office, Adobe, antivirus, and more.',
          '- **Streaming accounts** — Netflix, Spotify, YouTube Premium, Disney+, and others.',
          '- **VPN & privacy tools** — NordVPN, ExpressVPN, and similar subscriptions.',
          '- **Gift cards & codes** — Steam, Amazon, Google Play, iTunes.',
          '- **Special deals** — bid on exclusive premium accounts through timed auctions.',
          '',
          '## How it works',
          '',
          '1. **Browse freely** — explore the marketplace without logging in.',
          '2. **Deposit via crypto** — fund your wallet with USDT across 4 networks.',
          '3. **Buy instantly** — keys are delivered to your account immediately after purchase.',
          '4. **Or bid on special deals** — place a bid on a premium account auction. Highest bidder wins.',
          '',
          '## Why choose DigitalVault?',
          '',
          'We prioritize security and transparency. Every deposit is manually verified by our team. Funds locked for auction bids are protected — if your bid is outbid or you request a cancellation, your funds are returned to your wallet. Our support team is reachable via Telegram, email, and the in-site chat widget.',
        ].join('\n'),
        multiline: true,
        rows: 14,
        maxLength: 20000,
      },
      { key: 'contact.title', label: 'Contact — title', default: 'Contact us', maxLength: 120 },
      {
        key: 'contact.subtitle',
        label: 'Contact — subtitle',
        default: "We're here to help — reach out any time.",
        maxLength: 200,
      },
      {
        key: 'contact.body',
        label: 'Contact — body',
        default: [
          '## Support channels',
          '',
          'You can reach our team through any of the following channels. We typically reply within a few hours during business hours.',
          '',
          '- **Live chat** — click the floating chat button (bottom-right of any page) to start a conversation. Works for both guests and logged-in users.',
          '- **Telegram** — message us directly via the Telegram button in the top navigation bar.',
          '- **Email** — send us an email at the address shown in the footer below.',
          '',
          '## Common questions',
          '',
          '### How long does deposit approval take?',
          '',
          'Deposits are manually verified by our team. Most are approved within a few minutes, but during peak hours it can take up to an hour. If your deposit has been pending for over 24 hours, please reach out.',
          '',
          "### I won an auction — when do I get my account?",
          '',
          "Once the auction ends and you're confirmed as the highest bidder, our team manually delivers the account credentials to your account. This usually happens within a few hours of the auction closing.",
          '',
          '### How do I cancel a bid?',
          '',
          'Go to the special deal page where you placed the bid, or open the "Your Bids" section in your dashboard. Click "Request cancel" — your request goes to our admin team for approval. Once approved, your locked funds are refunded to your wallet and you can place a new bid.',
          '',
          '### I have an issue with a purchased product',
          '',
          "If a license key or account you purchased doesn't work, contact us immediately via Telegram or live chat with your order ID. We'll investigate and either replace the item or refund your balance.",
          '',
          '## Response times',
          '',
          'Our support team operates around the clock. Most queries are resolved within a few hours. For urgent matters, Telegram is the fastest channel.',
        ].join('\n'),
        multiline: true,
        rows: 14,
        maxLength: 20000,
      },
      { key: 'terms.title', label: 'Terms — title', default: 'Terms & Conditions', maxLength: 120 },
      {
        key: 'terms.subtitle',
        label: 'Terms — subtitle',
        default: 'Please read these terms carefully before using DigitalVault.',
        maxLength: 200,
      },
      {
        key: 'terms.body',
        label: 'Terms — body',
        default: [
          '## 1. Acceptance of terms',
          '',
          'By accessing or using DigitalVault (the "Service"), you agree to be bound by these Terms & Conditions. If you do not agree, please do not use the Service.',
          '',
          '## 2. Eligibility',
          '',
          'You must be at least 18 years old to use this Service. By registering an account, you represent that you meet this requirement.',
          '',
          '## 3. Account registration',
          '',
          'You must provide accurate and complete information when registering. You are responsible for safeguarding your password and for any activity under your account.',
          '',
          '## 4. Deposits & payments',
          '',
          'All deposits are made via cryptocurrency (USDT) across supported networks (BEP20, ERC20, TRX20, Polygon20). Deposits are manually verified by our team before your balance is credited. We are not responsible for funds sent to incorrect addresses or via unsupported networks.',
          '',
          '## 5. Purchases & delivery',
          '',
          'When you purchase a product, the purchase price is deducted from your wallet balance. License keys or account credentials are delivered to your account instantly upon successful purchase. If a delivered item is defective, contact support within 48 hours for a replacement or refund.',
          '',
          '## 6. Special deals (auctions)',
          '',
          'Special deals are time-limited auctions. By placing a bid, the bid amount is locked from your wallet until the auction ends or the bid is cancelled (with admin approval). The highest bidder at the end of the auction wins. Locked funds from non-winning bids are refunded automatically when outbid, or on admin-approved cancellation.',
          '',
          '## 7. Bid cancellation',
          '',
          'Each user may place only one bid per auction. To place a new bid, you must request cancellation of your existing bid first. Cancellation requests are reviewed by our admin team. Once approved, your locked funds are refunded and you may place a new bid.',
          '',
          '## 8. Prohibited conduct',
          '',
          'You agree not to:',
          '',
          '- Use the Service for any illegal purpose.',
          '- Attempt to manipulate auction prices or bid maliciously.',
          '- Resell purchased accounts in violation of their original terms of service.',
          "- Reverse-charge or dispute crypto deposits after they've been credited.",
          '',
          '## 9. Limitation of liability',
          '',
          'DigitalVault is provided "as is" without warranties of any kind. We are not liable for indirect, incidental, or consequential damages arising from the use of the Service.',
          '',
          '## 10. Changes to terms',
          '',
          'We may update these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.',
          '',
          '## 11. Contact',
          '',
          'Questions about these terms? Reach us via the contact channels listed on the [contact page](/contact).',
        ].join('\n'),
        multiline: true,
        rows: 14,
        maxLength: 20000,
      },
      { key: 'privacy.title', label: 'Privacy — title', default: 'Privacy Policy', maxLength: 120 },
      {
        key: 'privacy.subtitle',
        label: 'Privacy — subtitle',
        default: 'How we collect, use, and protect your information.',
        maxLength: 200,
      },
      {
        key: 'privacy.body',
        label: 'Privacy — body',
        default: [
          '## 1. Information we collect',
          '',
          'When you register an account we collect your email address and a display name. Passwords are stored only as salted hashes — never in plain text. When you make a deposit we record the transaction hash, network, and amount so we can verify and credit your wallet.',
          '',
          '## 2. How we use your information',
          '',
          '- To operate your account and deliver purchases to it.',
          '- To verify crypto deposits and process refunds of locked bid funds.',
          '- To provide support via email, Telegram, or the in-site chat widget.',
          '- To detect and prevent fraud, abuse, and bidding manipulation.',
          '',
          '## 3. What we do not do',
          '',
          'We do not sell your personal information, and we do not share it with third parties except where required to operate the service (for example, fraud prevention) or when compelled by law.',
          '',
          '## 4. Cookies & session data',
          '',
          "We use a single HTTP-only session cookie to keep you signed in. It contains no personal data — just a signed token. Analytics or advertising scripts, if enabled, are governed by their own providers' privacy policies.",
          '',
          '## 5. Data retention',
          '',
          'Account and order records are retained for as long as your account is active. Activity logs are archived after 90 days and may be kept longer for security auditing. You can request deletion of your account at any time via the contact channels below; we will remove personal data except where retention is required for legal or fraud-prevention purposes.',
          '',
          '## 6. Security',
          '',
          'All traffic is served over HTTPS. Passwords are hashed, session tokens are signed, and deposits are manually verified before your balance is credited. No payment card data is ever collected — deposits are cryptocurrency only.',
          '',
          '## 7. Your choices',
          '',
          'You can update your display name from your account settings at any time. To access, correct, or delete your personal data, reach us via the channels on the [contact page](/contact).',
          '',
          '## 8. Changes to this policy',
          '',
          'We may update this policy as the service evolves. Material changes will be announced on the site. Continued use after an update constitutes acceptance.',
        ].join('\n'),
        multiline: true,
        rows: 14,
        maxLength: 20000,
      },
    ],
  },
  {
    id: 'navigation',
    label: 'Navigation links',
    description:
      'The page links in the secondary nav bar (Marketplace / Special Deal / Blog / …) and the site footer. Rename a link, point it at any internal path or full https:// URL, drag (or use the arrows) to reorder, add as many as you need. Untick "Nav bar" to keep a link footer-only; clear the URL to hide it everywhere. Social icons are managed separately under Social links.',
    fields: [
      {
        key: 'nav.links',
        label: 'Links',
        hint: 'Edited with the drag-and-drop list below — the raw JSON is stored here.',
        default: '',
        maxLength: 20000,
      },
    ],
  },
  {
    id: 'footer',
    label: 'Site footer',
    description:
      'The centered footer shown at the bottom of every public page — brand, links, social buttons and layout. The navigation links are the same ones edited under Navigation links above, and the social buttons come from Social Links, so there is a single source of truth for each. Everything here is saved with the same Save content button.',
    fields: [
      {
        key: 'footer.config',
        label: 'Footer layout',
        hint: 'Edited with the visual footer editor below — the raw JSON is stored here.',
        default: '',
        maxLength: 20000,
      },
      {
        key: 'footer.tagline',
        label: 'Footer tagline',
        hint: 'Optional muted line shown under the footer links. Leave empty to hide.',
        default: '',
        maxLength: 200,
      },
    ],
  },
]

/** All setting keys owned by the content system, e.g. `content.blog.title`. */
export const CONTENT_SETTING_PREFIX = 'content.'

/**
 * Setting keys for the lightweight copy (headings, hero text, nav links) that
 * most pages load — everything except the big static-page bodies.
 */
export const CONTENT_SETTING_KEYS: string[] = CONTENT_SECTIONS.flatMap((section) =>
  section.fields.map((field) => CONTENT_SETTING_PREFIX + field.key)
).filter((key) => !key.startsWith(CONTENT_SETTING_PREFIX + 'staticPages.'))

/**
 * Setting keys for the four static pages (About / Contact / Terms / Privacy).
 * Only the pages themselves and the admin editor load these — the bodies are
 * multi-KB, so they are kept out of the homepage/blog payloads.
 */
export const STATIC_PAGE_SETTING_KEYS: string[] = CONTENT_SECTIONS.flatMap((section) =>
  section.fields
    .filter((field) => section.id === 'staticPages')
    .map((field) => CONTENT_SETTING_PREFIX + field.key)
)

/** Every content key — static pages included. Used by the settings API. */
export const ALL_CONTENT_SETTING_KEYS: string[] = CONTENT_SECTIONS.flatMap((section) =>
  section.fields.map((field) => CONTENT_SETTING_PREFIX + field.key)
)

/** `{ 'blog.title': 'Guides, deals & updates', ... }` — every field at its default. */
const DEFAULTS: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const section of CONTENT_SECTIONS) {
    for (const field of section.fields) map[field.key] = field.default
  }
  return map
})()

/** Look up a field definition by its (prefixed) key. */
const FIELDS_BY_KEY: Record<string, ContentFieldDef> = (() => {
  const map: Record<string, ContentFieldDef> = {}
  for (const section of CONTENT_SECTIONS) {
    for (const field of section.fields) map[field.key] = field
  }
  return map
})()

/** True when `key` (unprefixed) is a field the admin is allowed to edit. */
export function isContentFieldKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELDS_BY_KEY, key)
}

/**
 * The editable copy as a flat `{ fieldKey: value }` map. Keys that were never
 * saved fall back to the built-in default, so `contentValue()` on the result
 * always returns something renderable.
 */
export type SiteContent = Record<string, string>

export function defaultContent(): SiteContent {
  return { ...DEFAULTS }
}

/**
 * Merge `Setting` rows (with the `content.` prefix) over the defaults.
 *
 * An explicitly saved empty string is kept: that is how an admin hides an
 * optional badge or leaves the footer tagline off.
 */
export function buildContent(rows: { key: string; value: string }[]): SiteContent {
  const content = defaultContent()
  for (const row of rows) {
    if (!row.key.startsWith(CONTENT_SETTING_PREFIX)) continue
    const fieldKey = row.key.slice(CONTENT_SETTING_PREFIX.length)
    if (!isContentFieldKey(fieldKey)) {
      // Legacy nav.<n>.label/href rows predate the nav.links JSON list. They
      // are no longer editable, but keep them flowing into the map so sites
      // that never re-saved their nav still render the right links.
      if (/^nav\.\d+\.(label|href)$/.test(fieldKey)) content[fieldKey] = row.value
      continue
    }
    content[fieldKey] = row.value
  }
  return content
}

/**
 * Read one field, falling back to the built-in default only when the content
 * object does not carry the key at all (a partial/legacy payload). A saved
 * empty string is honoured so admins can blank a field out.
 */
export function contentValue(content: SiteContent | null | undefined, key: string): string {
  const value = content?.[key]
  if (typeof value === 'string') return value
  return DEFAULTS[key] ?? ''
}

// ----- Navigation links -----
//
// The nav/footer page links live in ONE content field: `nav.links`, a JSON
// array of { label, href, nav } objects. Array order is display order (the
// admin drags to reorder), and `nav: false` marks a footer-only link.
// Consumers never touch the raw JSON — they call resolveNavLinks(), which
// parses, sanitizes and applies fallbacks.
//
// Legacy support: the original build stored seven fixed slots as
// nav.<1-7>.label / nav.<1-7>.href fields (footer-only = slot 7). Those rows
// are still read (buildContent copies them into the map, see below) and are
// converted by legacyNavLinks() when no nav.links JSON has been saved yet.
// The one-time migration script writes the JSON, after which the old rows are
// inert.

/** The content field key (unprefixed) holding the JSON list. */
export const NAV_LINKS_FIELD = 'nav.links'

/** Hard cap on stored links — plenty for a nav, small enough to stay cheap. */
export const NAV_LINKS_MAX = 50

/** Shape stored in the JSON field (and edited by the admin drag list). */
export interface NavLinkInput {
  label: string
  href: string
  /** Show in the secondary nav bar (false = footer-only). */
  nav: boolean
}

/** A single admin-editable navigation/footer link, ready to render. */
export interface NavLink {
  label: string
  href: string
  /** True when href points off-site (rendered with target="_blank"). */
  external: boolean
}

/** The shipped link list — also the fallback when nothing is saved. */
export function defaultNavLinks(): NavLinkInput[] {
  return [
    { label: 'Marketplace', href: '/', nav: true },
    { label: 'Special Deal', href: '/special-deal', nav: true },
    { label: 'Blog', href: '/blogs', nav: true },
    { label: 'About', href: '/about', nav: true },
    { label: 'Contact', href: '/contact', nav: true },
    { label: 'Terms', href: '/terms', nav: true },
    { label: 'Privacy', href: '/privacy', nav: false },
  ]
}

/**
 * Parse the admin-authored JSON list. Returns null when the value is absent
 * or unparseable (callers then fall back to defaults / legacy slots), and
 * silently drops malformed entries. Sanitization of hrefs happens later, in
 * resolveNavLinks — this only validates shape.
 */
export function parseNavLinks(json: string | null | undefined): NavLinkInput[] | null {
  if (typeof json !== 'string' || !json.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const links: NavLinkInput[] = []
  for (const raw of parsed.slice(0, NAV_LINKS_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    if (typeof obj.href !== 'string') continue
    links.push({
      label: typeof obj.label === 'string' ? obj.label.slice(0, 60) : '',
      href: obj.href.slice(0, 300),
      nav: obj.nav !== false,
    })
  }
  return links
}

/** Serialize the admin list for storage in the `nav.links` field. */
export function serializeNavLinks(links: NavLinkInput[]): string {
  return JSON.stringify(links.slice(0, NAV_LINKS_MAX))
}

/** Convert saved legacy nav.<n>.label/href fields to the list shape. */
function legacyNavLinks(content: SiteContent): NavLinkInput[] | null {
  const slots: NavLinkInput[] = []
  for (let i = 1; i <= NAV_LINKS_MAX; i++) {
    const href = content[`nav.${i}.href`]
    if (typeof href !== 'string') break // slots were always sequential
    slots.push({
      label: (content[`nav.${i}.label`] ?? '').trim(),
      href,
      // Slot 7 (Privacy) was the footer-only slot in the old model.
      nav: i <= 6,
    })
  }
  return slots.length > 0 ? slots : null
}

/** Protocols an admin-entered link URL may use. Anything else is rejected. */
const NAV_HREF_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Turn an admin-entered URL into a safe href, or null when the link should be
 * hidden (empty input) or the input is unsafe (e.g. a `javascript:` URL).
 *
 * - paths starting with `/` or `#` pass through untouched
 * - http(s)/mailto/tel URLs pass through
 * - scheme-relative (`//host`) and unknown schemes are rejected
 * - bare text (`special-deal`) becomes a relative path (`/special-deal`)
 */
export function sanitizeNavHref(raw: string): string | null {
  const href = raw.trim()
  if (!href) return null
  // Internal paths and in-page anchors pass through (but reject scheme-relative
  // `//host` URLs — admins should use the explicit https:// form off-site).
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (/^[a-z][a-z0-9+.\-]*:/i.test(href)) {
    try {
      const url = new URL(href)
      return NAV_HREF_PROTOCOLS.includes(url.protocol) ? href : null
    } catch {
      return null
    }
  }
  return `/${href}`
}

/**
 * The admin-editable link list for the editor: the saved JSON list, else the
 * saved legacy slot rows converted, else the shipped defaults. (Raw inputs —
 * labels may be empty, hrefs unsanitized; sanitization happens on render/save.)
 */
export function navLinksForEditing(content: SiteContent | null | undefined): NavLinkInput[] {
  if (content) {
    const parsed = parseNavLinks(content[NAV_LINKS_FIELD])
    if (parsed) return parsed
    const legacy = legacyNavLinks(content)
    if (legacy) return legacy
  }
  return defaultNavLinks()
}

/**
 * All saved page links (nav bar + footer) in display order, ready to render.
 *
 * A link is skipped when its URL is empty/unsafe, so clearing a URL hides the
 * link everywhere; an empty label falls back to the URL (last path segment,
 * prettified) so a link never renders without text.
 */
export function resolveNavLinks(content: SiteContent | null | undefined): NavLink[] {
  return renderables(navLinksForEditing(content))
}

/** Drop unsafe/empty hrefs, resolve labels, and compute `external`. */
function renderables(inputs: NavLinkInput[]): NavLink[] {
  const out: NavLink[] = []
  for (const input of inputs) {
    const href = sanitizeNavHref(input.href)
    if (!href) continue
    const rawLabel = input.label.trim()
    out.push({
      label: (rawLabel || prettyLabelFromHref(href)).slice(0, 60),
      href,
      external: /^https?:/i.test(href),
    })
  }
  return out
}

/** 'Blog' from '/blogs', 'Special Deal' from '/special-deal', host for URLs. */
function prettyLabelFromHref(href: string): string {
  if (/^https?:/i.test(href)) {
    try {
      return new URL(href).hostname.replace(/^www\./, '')
    } catch {
      return href
    }
  }
  const segment = href.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() ?? ''
  if (!segment) return href === '/' ? 'Home' : href
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The links for the secondary nav bar: saved links with `nav: true` (legacy
 * slots 1–6, defaults 1–6) in display order.
 */
export function resolveNavBarLinks(content: SiteContent | null | undefined): NavLink[] {
  return renderables(navLinksForEditing(content).filter((l) => l.nav))
}

// ----- Footer configuration -----
//
// The public footer's presentation — brand block, layout colors/spacing, zone
// visibility and the optional bottom bar — lives in ONE content field:
// `footer.config`, a JSON object, edited by the visual footer editor in the
// admin. The link + social lists themselves are intentionally NOT duplicated
// here: the footer reuses the existing nav.links field and the Social Links
// store so a site has one source of truth for each.

export const FOOTER_CONFIG_FIELD = 'footer.config'

/** Hard caps on stored values — plenty for a footer, cheap to render. */
export const FOOTER_LEGAL_MAX = 8
export const FOOTER_LOGO_TEXT_MAX = 60
export const FOOTER_COPYRIGHT_MAX = 200

/** One link in the optional bottom bar (label + URL + visibility). */
export interface FooterLinkItem {
  label: string
  url: string
  visible: boolean
}

export interface FooterLayout {
  bg_color: string
  text_color: string
  muted_color: string
  padding_top: number
  padding_bottom: number
  align: 'center' | 'left'
}

export interface FooterConfig {
  brand: {
    logo_text: string
    logo_url: string
    logo_image: string | null
  }
  nav_visible: boolean
  social_visible: boolean
  layout: FooterLayout
  bottom_bar_visible: boolean
  copyright: string
  legal: FooterLinkItem[]
}

/** The shipped look — matches the clean, centered reference design. */
export const FOOTER_DEFAULT_COLORS = {
  bg_color: '#0A0A0A',
  text_color: '#FFFFFF',
  muted_color: '#9CA3AF',
} as const

export function defaultFooterConfig(): FooterConfig {
  return {
    brand: { logo_text: '', logo_url: '/', logo_image: null },
    nav_visible: true,
    social_visible: true,
    layout: {
      bg_color: FOOTER_DEFAULT_COLORS.bg_color,
      text_color: FOOTER_DEFAULT_COLORS.text_color,
      muted_color: FOOTER_DEFAULT_COLORS.muted_color,
      padding_top: 80,
      padding_bottom: 80,
      align: 'center',
    },
    bottom_bar_visible: false,
    copyright: '',
    legal: [],
  }
}

/** `#RGB` or `#RRGGBB` only — anything else falls back to the default. */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function cleanHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim()) ? value.trim() : fallback
}

function cleanInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanFooterLinks(raw: unknown): FooterLinkItem[] {
  if (!Array.isArray(raw)) return []
  const out: FooterLinkItem[] = []
  for (const item of raw.slice(0, FOOTER_LEGAL_MAX)) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const href = sanitizeNavHref(typeof obj.url === 'string' ? obj.url : '')
    if (!href) continue // empty/unsafe URL — drop the row entirely
    out.push({ label: cleanText(obj.label, 60), url: href, visible: obj.visible !== false })
  }
  return out
}

/**
 * Coerce arbitrary input (parsed JSON from the editor, or a request body) into
 * a valid FooterConfig. Bad hex colors, padding values and URLs fall back to
 * defaults instead of throwing, so a typo can never break the footer.
 */
export function sanitizeFooterConfig(raw: unknown): FooterConfig {
  const defaults = defaultFooterConfig()
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {}
  const brandRaw = obj.brand && typeof obj.brand === 'object' && !Array.isArray(obj.brand) ? obj.brand : {}
  const layoutRaw = obj.layout && typeof obj.layout === 'object' && !Array.isArray(obj.layout) ? obj.layout : {}

  const logoImage =
    typeof brandRaw.logo_image === 'string' && brandRaw.logo_image.trim()
      ? brandRaw.logo_image.trim().slice(0, 500)
      : null
  const logoUrl =
    sanitizeNavHref(typeof brandRaw.logo_url === 'string' ? brandRaw.logo_url : '') ?? defaults.brand.logo_url

  return {
    brand: {
      logo_text: cleanText(brandRaw.logo_text, FOOTER_LOGO_TEXT_MAX),
      logo_url: logoUrl,
      logo_image: logoImage,
    },
    nav_visible: cleanBool(obj.nav_visible, defaults.nav_visible),
    social_visible: cleanBool(obj.social_visible, defaults.social_visible),
    layout: {
      bg_color: cleanHex(layoutRaw.bg_color, defaults.layout.bg_color),
      text_color: cleanHex(layoutRaw.text_color, defaults.layout.text_color),
      muted_color: cleanHex(layoutRaw.muted_color, defaults.layout.muted_color),
      padding_top: cleanInt(layoutRaw.padding_top, defaults.layout.padding_top, 0, 200),
      padding_bottom: cleanInt(layoutRaw.padding_bottom, defaults.layout.padding_bottom, 0, 200),
      align: layoutRaw.align === 'left' ? 'left' : 'center',
    },
    bottom_bar_visible: cleanBool(obj.bottom_bar_visible, defaults.bottom_bar_visible),
    copyright: cleanText(obj.copyright, FOOTER_COPYRIGHT_MAX),
    legal: cleanFooterLinks(obj.legal),
  }
}

/** Parse the stored JSON. Returns null when absent/unparseable. */
export function parseFooterConfig(json: string | null | undefined): FooterConfig | null {
  if (typeof json !== 'string' || !json.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  return sanitizeFooterConfig(parsed)
}

/** Serialize for storage in the `footer.config` field. */
export function serializeFooterConfig(config: FooterConfig): string {
  return JSON.stringify(sanitizeFooterConfig(config))
}

/** The config a consumer should render — saved value else the shipped default. */
export function resolveFooterConfig(content: SiteContent | null | undefined): FooterConfig {
  return parseFooterConfig(content?.[FOOTER_CONFIG_FIELD]) ?? defaultFooterConfig()
}

/** The visible bottom-bar legal links, sanitized and ready to render. */
export function resolveFooterLegalLinks(config: FooterConfig): NavLink[] {
  return renderables(config.legal.filter((l) => l.visible).map((l) => ({ label: l.label, href: l.url, nav: false })))
}

/**
 * The links shown in the footer's navigation zone. When `nav_visible` is off
 * the zone is hidden; otherwise the saved nav links render (clearing a URL
 * hides that link — see resolveNavLinks).
 */
export function resolveFooterNavLinks(
  content: SiteContent | null | undefined,
  config: FooterConfig,
): NavLink[] {
  return config.nav_visible ? resolveNavLinks(content) : []
}
