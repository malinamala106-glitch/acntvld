import { BlogList } from '@/components/public/BlogList'
import { buildContent, CONTENT_SETTING_KEYS } from '@/lib/site-content'
import { getCachedBlogPosts, getCachedContentSettings } from '@/lib/cache'
import { jsonLdHtml } from '@/lib/json-ld'
import { serverSiteUrl } from '@/lib/site-url'
import type { Metadata } from 'next'

// ISR: post list cached 5 min; admin writes invalidate the 'blogs' tag instantly.
export const revalidate = 300

const baseUrl = serverSiteUrl()

export const metadata: Metadata = {
  title: 'Blog — Buying Guides, Crypto Help & Weekly Deals',
  description:
    'Guides for buying digital accounts safely, crypto deposit tutorials, weekly deal roundups, and platform updates from the DigitalVault team.',
  alternates: { canonical: '/blogs' },
}

export default async function Page() {
  const [posts, settingsRows] = await Promise.all([
    // Post list comes from the tag cache (5 min TTL, invalidated on write).
    getCachedBlogPosts(),
    // Section copy (headings, search placeholder, empty state) + the site name.
    getCachedContentSettings([...CONTENT_SETTING_KEYS, 'siteName']),
  ])

  const siteName = settingsRows.find((r) => r.key === 'siteName')?.value || 'DigitalVault'

  // ItemList structured data for the blog index.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${siteName} Blog`,
    url: `${baseUrl}/blogs`,
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${baseUrl}/blogs/${p.slug}`,
      datePublished: p.createdAt,
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <BlogList
        posts={posts as any}
        content={buildContent(settingsRows)}
        siteName={siteName}
      />
    </>
  )
}
