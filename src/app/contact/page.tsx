import { StaticPage } from '@/components/public/StaticPage'
import { buildContent, STATIC_PAGE_SETTING_KEYS } from '@/lib/site-content'
import { getCachedContentSettings } from '@/lib/cache'
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
  // Tag-cached (1h TTL), invalidated instantly when an admin saves; a missing
  // database degrades to the built-in defaults instead of failing the page.
  const rows = await getCachedContentSettings(STATIC_PAGE_SETTING_KEYS)
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
