'use client'

import { usePathname } from 'next/navigation'
import { useSiteContent } from '@/components/shared/use-site-content'
import { resolveNavBarLinks } from '@/lib/site-content'
import type { SiteContent } from '@/lib/types'

const ACTIVE_CLASSES = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
const IDLE_CLASSES = 'border-transparent text-zinc-600 dark:text-zinc-400 hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 hover:text-emerald-700 dark:hover:text-emerald-300'

interface SiteNavLinksProps {
  /** Admin-editable site content when the page already loaded it server-side. */
  content?: SiteContent | null
  /**
   * href of the link matching the current page — gets the active pill styling.
   * Defaults to the current pathname, which covers most pages.
   */
  activeHref?: string
  /** Inner max-width wrapper class (pages use narrower strips). */
  widthClass?: string
}

function NavPill({ label, href, external, active }: { label: string; href: string; external: boolean; active: boolean }) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-current={active ? 'page' : undefined}
      className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all border-2 ${
        active ? ACTIVE_CLASSES : IDLE_CLASSES
      }`}
    >
      {label}
    </a>
  )
}

/**
 * The secondary navigation strip (Marketplace / Special Deal / Blog / …) shared
 * by every public page header and the buyer app. The links are admin-editable
 * under Site content → Navigation links — rename them, re-point them, or clear
 * a URL to hide that link site-wide.
 *
 * Pages that already load the site content server-side pass it via `content`;
 * standalone pages (product detail, checkout, deposit, static pages) fetch
 * `/api/settings` on mount instead. Links always render with built-in defaults
 * first, then re-render once saved copy arrives — no empty state possible.
 */
export function SiteNavLinks({ content, activeHref, widthClass = 'max-w-7xl' }: SiteNavLinksProps) {
  const pathname = usePathname()
  const resolved = useSiteContent(content)
  const links = resolveNavBarLinks(resolved)
  const active = activeHref ?? pathname

  if (links.length === 0) return null

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60">
      <nav className={`${widthClass} mx-auto px-3 sm:px-6 py-2 flex items-center gap-2 overflow-x-auto`} aria-label="Sections">
        {links.map((link, i) => (
          <NavPill key={i} label={link.label} href={link.href} external={link.external} active={!!active && link.href === active} />
        ))}
      </nav>
    </div>
  )
}
