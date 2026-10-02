// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { serverSiteUrl } from '@/lib/site-url'

export const dynamic = 'force-dynamic'
// Rebuild at most once an hour — keeps product/auction/post freshness without
// hammering the DB on every crawler hit.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = serverSiteUrl()
  const lastModified = new Date()

  // Static, indexable pages. Transactional pages (checkout, deposit) and the
  // bare /products and /special-deal/[slug] index pages are intentionally
  // excluded — see robots.ts for the matching crawl rules.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/special-deal`, lastModified, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/blogs`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/about`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/contact`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // Dynamic entities — each wrapped so a DB hiccup degrades to a static-only
  // sitemap rather than a 500 for the crawler.
  const [products, auctions, posts] = await Promise.all([
    db.product
      .findMany({
        where: { isActive: true },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      })
      .catch(() => []),
    db.auction
      .findMany({
        where: { isActive: true, status: 'ACTIVE' },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 1000,
      })
      .catch(() => []),
    db.blogPost
      .findMany({
        where: { isPublished: true },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 1000,
      })
      .catch(() => []),
  ])

  return [
    ...staticEntries,
    ...products.map((p) => ({
      url: `${baseUrl}/products/${p.id}`,
      lastModified: p.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...auctions.map((a) => ({
      url: `${baseUrl}/special-deal/${a.slug}`,
      lastModified: a.updatedAt,
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
    ...posts.map((p) => ({
      url: `${baseUrl}/blogs/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
