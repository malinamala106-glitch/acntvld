// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://digitalvault.example'
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Crawl-budget + duplicate-content hygiene: the API and the
        // transactional flows (checkout / deposit) have nothing to index.
        // Nothing here blocks a page that carries `index: true` metadata.
        disallow: ['/api/', '/checkout', '/checkout-page', '/deposit'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
