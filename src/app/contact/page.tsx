import { db } from '@/lib/db'
import { StaticPage } from '@/components/public/StaticPage'
import { buildContent, STATIC_PAGE_SETTING_KEYS } from '@/lib/site-content'
import type { Metadata } from 'next'

// ISR: settings-driven copy cached 1h; admin saves invalidate the 'content' tag instantly.
export const revalidate = 3600

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact',
  description: 'Get in touch with the DigitalVault team — Telegram, email, or live chat.',
}

export default async function Page() {
  // Title/subtitle/body are admin-editable under Site content → Static pages.
  const rows = await db.setting.findMany({ where: { key: { in: STATIC_PAGE_SETTING_KEYS } } })
  const content = buildContent(rows)
  const page = (field: string) => content[`contact.${field}`] ?? ''

  return (
    <StaticPage
      title={page('title') || 'Contact us'}
      subtitle={page('subtitle')}
      body={page('body')}
    />
  )
}
