import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { BlogPostView } from '@/components/public/BlogList'
import { buildContent, CONTENT_SETTING_KEYS } from '@/lib/site-content'
import { getCachedContentSettings } from '@/lib/cache'
import type { Metadata } from 'next'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://digitalvault.example'

// ISR: article pages cached 5 min; admin edits invalidate the 'blogs' tag.
export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await db.blogPost.findUnique({ where: { slug } })
  if (!post || !post.isPublished) return { title: 'Post not found' }
  return {
    title: post.title,
    description: post.excerpt || post.title,
    alternates: { canonical: `/blogs/${post.slug}` },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await db.blogPost.findUnique({ where: { slug } })
  if (!post || !post.isPublished) notFound()

  // Site name + footer copy for the shared footer (tag-cached).
  const settingsRows = await getCachedContentSettings([...CONTENT_SETTING_KEYS, 'siteName'])
  const siteName = settingsRows.find((r) => r.key === 'siteName')?.value || 'DigitalVault'

  // Article structured data — helps Google attribute the post correctly.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || post.title,
    url: `${baseUrl}/blogs/${post.slug}`,
    mainEntityOfPage: `${baseUrl}/blogs/${post.slug}`,
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    author: { '@type': 'Organization', name: siteName },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      logo: { '@type': 'ImageObject', url: `${baseUrl}/icon.svg` },
    },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogPostView
        post={post as any}
        content={buildContent(settingsRows)}
        siteName={siteName}
      />
    </>
  )
}
