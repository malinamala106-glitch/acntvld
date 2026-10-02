import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { AppShell } from '@/components/AppShell'
import type { Product, PublicSettings } from '@/lib/types'
import { buildContent, CONTENT_SETTING_KEYS } from '@/lib/site-content'
import { getCachedActiveProducts, getCachedContentSettings } from '@/lib/cache'
import { toUserProps } from '@/lib/props'
import type { Metadata } from 'next'

// Server component — renders the right shell based on auth cookie.
// Pre-fetches products + settings server-side so the storefront paints instantly for guests.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'DigitalVault — Buy License Keys, Software Keys & Digital Accounts',
  description:
    'Browse digital goods freely — software license keys, VPN subscriptions, streaming accounts and gift cards. Crypto deposits, instant delivery, no account needed to browse.',
  alternates: { canonical: '/' },
}

const SETTING_KEYS = ['minDepositAmount', 'siteName', 'supportEmail'] as const

function buildSettings(rows: { key: string; value: string }[]): PublicSettings {
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    minDepositAmount: parseFloat(map.minDepositAmount ?? '0') || 0,
    siteName: map.siteName ?? 'DigitalVault',
    supportEmail: map.supportEmail ?? '',
    content: buildContent(rows),
  }
}

export default async function Home() {
  // Hot reads (product list, content settings) go through the tag cache —
  // identical for all visitors. The session lookup stays per-request.
  const [user, productsResult, settingsRows] = await Promise.all([
    getCurrentUser(),
    getCachedActiveProducts(),
    getCachedContentSettings([...SETTING_KEYS, ...CONTENT_SETTING_KEYS]),
  ])
  return (
    <AppShell
      initialUser={user ? toUserProps(user) : null}
      initialProducts={productsResult as unknown as Product[]}
      initialSettings={buildSettings(settingsRows)}
    />
  )
}
