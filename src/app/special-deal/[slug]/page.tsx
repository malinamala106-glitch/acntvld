import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { SpecialDealDetailPage } from '@/components/public/SpecialDealsPage'
import { buildContent, CONTENT_SETTING_KEYS } from '@/lib/site-content'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const auction = await db.auction.findUnique({ where: { slug } })
  if (!auction || !auction.isActive) return { title: 'Special Deal not found' }
  return {
    title: auction.title,
    description: auction.description?.slice(0, 160) || auction.title,
    alternates: { canonical: `/special-deal/${auction.slug}` },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const auction = await db.auction.findUnique({
    where: { slug },
    include: {
      bids: {
        orderBy: { amount: 'desc' },
        take: 10,
        include: { user: { select: { email: true, name: true } } },
      },
      _count: { select: { bids: true } },
    },
  })
  if (!auction || !auction.isActive) notFound()

  // Site name + footer copy for the shared footer.
  const settingsRows = await db.setting.findMany({ where: { key: { in: [...CONTENT_SETTING_KEYS, 'siteName'] } } })
  const siteName = settingsRows.find((r) => r.key === 'siteName')?.value || 'DigitalVault'

  return (
    <SpecialDealDetailPage
      auction={auction as any}
      content={buildContent(settingsRows)}
      siteName={siteName}
    />
  )
}
