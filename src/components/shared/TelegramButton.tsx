'use client'

import { useState, useEffect } from 'react'
import { TelegramIcon, FacebookIcon, InstagramIcon, RedditIcon, TwitterIcon, DiscordIcon, YoutubeIcon, WhatsappIcon, EmailIcon, LinkIcon, getSocialLabel } from '@/lib/social-icons'

interface SocialLink {
  id: string
  platform: string
  url: string
  label: string | null
  order: number
  isActive: boolean
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

// Top-nav contact buttons — fetches admin-configured social links from /api/social-links.
// Renders the first active link (usually Telegram) as the top-nav button.
// Renders nothing if no social links are configured.
export function TelegramButton({ className = '' }: { className?: string }) {
  const [link, setLink] = useState<SocialLink | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/social-links')
        if (res.ok) {
          const data = await res.json()
          if (mounted && data.links && data.links.length > 0) {
            setLink(data.links[0])
          }
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  if (!link) return null
  const label = link.label || getSocialLabel(link.platform)
  const isEmail = link.url.startsWith('mailto:') || link.platform.toLowerCase().includes('email')

  return (
    <a
      href={link.url}
      target={isEmail ? undefined : '_blank'}
      rel={isEmail ? undefined : 'noopener noreferrer'}
      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60 transition-colors shrink-0 ${className}`}
      aria-label={`Contact us on ${label}`}
      title={`Contact us on ${label}`}
    >
      <SocialIcon platform={link.platform} className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </a>
  )
}
