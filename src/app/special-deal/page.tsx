import { db } from '@/lib/db'
import { SpecialDealsPage } from '@/components/public/SpecialDealsPage'
import { buildContent, CONTENT_SETTING_KEYS } from '@/lib/site-content'
import { getCachedContentSettings } from '@/lib/cache'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Special Deals — Bid on Premium Accounts & Digital Assets',
  description:
    'Live auctions on premium digital accounts. Bid with locked crypto funds — refunded automatically if you are outbid. Highest bidder wins.',
  alternates: { canonical: '/special-deal' },
}
export default async function Page() {
  // Fetch all active auctions server-side for instant first paint
  const [auctions, settingsRows] = await Promise.all([
    // An unreachable database degrades to "no live auctions yet" — the hero,
    // empty state and footer still render instead of the page 500ing.
    db.auction
      .findMany({
        where: { isActive: true },
        orderBy: { endsAt: 'asc' },
        include: {
          _count: { select: { bids: true } },
        },
      })
      .catch((error) => {
        console.error('[special-deal] auction list read failed — serving an empty list', error)
        return []
      }),
    // Section copy (headings, hero text, empty state) + the site name.
    getCachedContentSettings([...CONTENT_SETTING_KEYS, 'siteName']),
  ])

  const siteName = settingsRows.find((r) => r.key === 'siteName')?.value || 'DigitalVault'

  return (
    <SpecialDealsPage
      auctions={auctions as any}
      content={buildContent(settingsRows)}
      siteName={siteName}
    />
  )
}
