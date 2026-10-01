'use client'

import { useState, useEffect } from 'react'
import { useSiteContent } from '@/components/shared/use-site-content'
import { resolveFooterConfig, resolveFooterNavLinks, resolveFooterLegalLinks } from '@/lib/site-content'
import type { SiteContent } from '@/lib/types'
import {
  TelegramIcon, FacebookIcon, InstagramIcon, RedditIcon, TwitterIcon, DiscordIcon,
  YoutubeIcon, WhatsappIcon, EmailIcon, LinkIcon, getSocialLabel,
} from '@/lib/social-icons'

interface SocialLink {
  id: string
  platform: string
  url: string
  label: string | null
  order: number
  isActive: boolean
}

interface Props {
  siteName?: string
  userEmail?: string | null
  /** Optional admin-authored line shown under the links (empty = hidden). */
  tagline?: string
  /** Admin-editable site content when the page already loaded it server-side. */
  content?: SiteContent | null
}

// Renders the social icon SVG inline (avoids creating components during render)
function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  const p = platform.toLowerCase()
  if (p.includes('telegram')) return <TelegramIcon className={className} />
  if (p.includes('facebook') || p === 'fb') return <FacebookIcon className={className} />
  if (p.includes('instagram') || p === 'ig') return <InstagramIcon className={className} />
  if (p.includes('reddit')) return <RedditIcon className={className} />
  if (p.includes('twitter') || p.includes('x.com')) return <TwitterIcon className={className} />
  if (p.includes('discord')) return <DiscordIcon className={className} />
  if (p.includes('youtube') || p.includes('yt')) return <YoutubeIcon className={className} />
  if (p.includes('whatsapp')) return <WhatsappIcon className={className} />
  if (p.includes('email') || p.includes('mail') || p.includes('@')) return <EmailIcon className={className} />
  return <LinkIcon className={className} />
}

// Clean, centered footer: brand (logo + name), one row of page links, one row
// of social buttons. Everything is admin-editable under Site content → Site
// footer; the page links reuse the Navigation links list and the social
// buttons reuse the Social Links manager. The optional bottom bar (copyright +
// legal links) is off by default, matching the minimal reference design.
export function SiteFooter({ siteName = 'DigitalVault', userEmail, tagline, content }: Props) {
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([])
  const resolved = useSiteContent(content)
  const config = resolveFooterConfig(resolved)
  const navLinks = resolveFooterNavLinks(resolved, config)
  const legalLinks = resolveFooterLegalLinks(config)

  useEffect(() => {
    if (!config.social_visible) return
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/social-links')
        if (res.ok) {
          const data = await res.json()
          if (mounted && data.links) setSocialLinks(data.links)
        }
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [config.social_visible])

  const { layout, brand } = config
  const brandText = brand.logo_text || siteName
  const logoHref = brand.logo_url || '/'
  const centered = layout.align !== 'left'
  const socials = config.social_visible ? socialLinks.filter((l) => l.isActive !== false) : []
  const year = new Date().getFullYear()

  const alignClasses = centered ? 'items-center text-center' : 'items-start text-left'
  const rowAlignClasses = centered ? 'justify-center' : 'justify-start'
  const gapClasses = config.bottom_bar_visible ? 'gap-8' : 'gap-12'

  return (
    <footer className="mt-auto w-full" style={{ backgroundColor: layout.bg_color, color: layout.text_color }}>
      <div
        className={`mx-auto flex w-full max-w-[1200px] flex-col px-4 sm:px-6 ${alignClasses} ${gapClasses} pt-[var(--ft-pt)] pb-[var(--ft-pb)] max-md:gap-8 max-md:pt-12 max-md:pb-12`}
        style={
          {
            '--ft-pt': `${layout.padding_top}px`,
            '--ft-pb': `${layout.padding_bottom}px`,
          } as React.CSSProperties
        }
      >
        {/* Zone 1 — logo + brand name */}
        <a href={logoHref} className="inline-flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border text-sm font-bold"
            style={{ backgroundColor: '#1A1A1A', borderColor: 'rgba(255,255,255,0.15)', color: layout.text_color }}
          >
            {brand.logo_image ? (
              // Admin-supplied logo may be an uploaded path or an external URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_image} alt={brandText} className="h-full w-full object-cover" />
            ) : (
              brandText.charAt(0).toUpperCase()
            )}
          </span>
          <span className="text-xl font-semibold" style={{ color: layout.text_color }}>
            {brandText}
          </span>
        </a>

        {/* Zone 2 — navigation links (single row, wraps on mobile) */}
        {navLinks.length > 0 && (
          <nav className={`flex flex-wrap items-center ${rowAlignClasses} gap-x-8 gap-y-3 max-md:gap-x-6`} aria-label="Footer">
            {navLinks.map((link) => (
              <a
                key={`${link.href}-${link.label}`}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className="text-sm opacity-80 underline-offset-4 transition-opacity duration-200 hover:opacity-100 hover:underline"
                style={{ color: layout.text_color }}
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        {/* Zone 3 — social icon buttons (single row) */}
        {socials.length > 0 && (
          <div className={`flex flex-wrap items-center ${rowAlignClasses} gap-3`}>
            {socials.map((link) => {
              const label = link.label || getSocialLabel(link.platform)
              const isEmail = link.url.startsWith('mailto:') || link.platform.toLowerCase().includes('email')
              return (
                <a
                  key={link.id}
                  href={link.url}
                  target={isEmail ? undefined : '_blank'}
                  rel={isEmail ? undefined : 'noopener noreferrer'}
                  aria-label={label}
                  title={label}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors duration-200 hover:bg-zinc-700"
                  style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <SocialIcon platform={link.platform} className="h-4 w-4" />
                </a>
              )
            })}
          </div>
        )}

        {/* Optional muted tagline */}
        {tagline ? (
          <p className="max-w-2xl text-xs sm:text-sm" style={{ color: layout.muted_color }}>
            {tagline}
          </p>
        ) : null}

        {/* Optional bottom bar — copyright + legal links */}
        {config.bottom_bar_visible && (
          <div
            className="flex w-full flex-col items-center justify-between gap-3 border-t pt-6 text-xs sm:flex-row"
            style={{ borderColor: 'rgba(255,255,255,0.12)', color: layout.muted_color }}
          >
            <span>{config.copyright || `© ${year} ${brandText}`}</span>
            {legalLinks.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {legalLinks.map((link) => (
                  <a
                    key={`${link.href}-${link.label}`}
                    href={link.href}
                    target={link.external ? '_blank' : undefined}
                    rel={link.external ? 'noopener noreferrer' : undefined}
                    className="underline-offset-4 transition-colors hover:text-white hover:underline"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {userEmail ? (
          <span className="text-xs" style={{ color: layout.muted_color }}>
            Logged in as {userEmail}
          </span>
        ) : null}
      </div>
    </footer>
  )
}
