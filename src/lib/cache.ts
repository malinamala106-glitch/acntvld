import { unstable_cache, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'

/**
 * Tag-cached reads for hot, NON-user-specific data.
 *
 * Every page here is user-aware (the shell greets the logged-in buyer), so
 * pages must stay dynamic — but the underlying catalog/content reads are
 * identical for all visitors. unstable_cache caches those reads in the
 * server's data cache; the response HTML itself is never shared-cacheable.
 *
 * Tags:
 *   products      — active product listings (storefront, product pages, sitemap)
 *   product:<id>  — a single product row
 *   blogs         — blog list + articles
 *   content       — settings rows (site branding, static page copy, nav links)
 *
 * Write paths MUST call the invalidators below (see each function's doc).
 * Never cache: anything scoped to the current user (balances, orders,
 * deposits, bids, chat) — those read per-request by design.
 */

export const CACHE_TAGS = {
  products: 'products',
  product: (id: string) => `product:${id}`,
  blogs: 'blogs',
  content: 'content',
} as const

/** Active product list for the storefront. TTL 60s. Invalidate: products. */
export const getCachedActiveProducts = unstable_cache(
  async () => {
    const rows = await db.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        price: true,
        stock: true,
        image: true,
        isActive: true,
        createdAt: true,
      },
    })
    // Serialize dates to survive the cache boundary cleanly.
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  },
  ['active-products'],
  { tags: [CACHE_TAGS.products], revalidate: 60 }
)

/**
 * Single active product by id. TTL 60s. Tags: products + product:<id>.
 * unstable_cache keys the underlying cache entry by the args hash, so one
 * exported const with an id parameter is correct here.
 */
export const getProductCached = unstable_cache(
  async (id: string) => {
    const row = await db.product.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        renderHtml: true,
        category: true,
        deliveryFormat: true,
        price: true,
        stock: true,
        image: true,
        isActive: true,
        createdAt: true,
      },
    })
    return row ? { ...row, createdAt: row.createdAt.toISOString() } : null
  },
  ['product-by-id'],
  { tags: [CACHE_TAGS.products], revalidate: 60 },
)

/** Published blog posts (list view). TTL 300s. Invalidate: blogs. */
export const getCachedBlogPosts = unstable_cache(
  async () => {
    const rows = await db.blogPost.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  },
  ['blog-posts'],
  { tags: [CACHE_TAGS.blogs], revalidate: 300 }
)

/**
 * Settings rows for site content/branding. TTL 3600s. Invalidate: content.
 * Cheap already (indexed key lookup), but it runs on EVERY page render —
 * caching removes a DB round trip from the hottest path in the app.
 */
export const getCachedContentSettings = unstable_cache(
  async (keys: string[]) => {
    const rows = await db.setting.findMany({ where: { key: { in: keys } } })
    return rows.map((r) => ({ key: r.key, value: r.value }))
  },
  ['content-settings'],
  { tags: [CACHE_TAGS.content], revalidate: 3600 }
)

// ----- Invalidators (call after any successful write) ----------------------
// Next 16's revalidateTag takes an explicit cache-life profile; { expire: 0 }
// purges the tagged entries immediately.

export function revalidateProducts(productIds?: string[]) {
  revalidateTag(CACHE_TAGS.products, { expire: 0 })
  if (productIds) {
    for (const id of productIds) revalidateTag(CACHE_TAGS.product(id), { expire: 0 })
  }
}

export function revalidateBlogs() {
  revalidateTag(CACHE_TAGS.blogs, { expire: 0 })
}

export function revalidateContent() {
  revalidateTag(CACHE_TAGS.content, { expire: 0 })
}
