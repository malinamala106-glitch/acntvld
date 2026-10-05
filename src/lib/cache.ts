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

/**
 * Run a cached read, returning `fallback` instead of throwing when the
 * database is unreachable.
 *
 * Why this exists: a deploy that has no DATABASE_URL yet (an operator adding
 * it later, step by step), a paused free-tier Supabase project, or a transient
 * network failure all used to make every storefront read throw — turning the
 * entire public site into a 500. Degrading to "no products / default copy"
 * keeps the site browsable and, crucially, recovers on its own the moment the
 * database answers again.
 *
 * The catch is deliberately OUTSIDE unstable_cache: a failure must never be
 * stored in the data cache, or the empty result would keep being served for
 * the rest of the TTL (up to an hour for content settings) after the database
 * came back.
 */
async function cached<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read()
  } catch (error) {
    console.error(
      `[cache] ${label} read failed — serving fallback content. ` +
        'Check DATABASE_URL and that the database is reachable.',
      error,
    )
    return fallback
  }
}

/** Active product list for the storefront. TTL 60s. Invalidate: products. */
const cachedActiveProducts = unstable_cache(
  async () => {
    const rows = await db.product.findMany({
      where: { isActive: true },
      // Pinned first, then the admin's manual order, then newest-first as a
      // tiebreaker for rows that still share a sortOrder (e.g. two products
      // created in the same migration before anyone reorders). Must stay
      // identical to the orderBy in app/api/products/route.ts — the storefront
      // renders from this cache and then refetches from that endpoint.
      orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        price: true,
        stock: true,
        image: true,
        isActive: true,
        pinned: true,
        sortOrder: true,
        createdAt: true,
      },
    })
    // Serialize dates to survive the cache boundary cleanly.
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  },
  ['active-products'],
  { tags: [CACHE_TAGS.products], revalidate: 60 }
)

export function getCachedActiveProducts() {
  return cached('active products', () => cachedActiveProducts(), [])
}

/**
 * Single active product by id. TTL 60s. Tags: products + product:<id>.
 * unstable_cache keys the underlying cache entry by the args hash, so one
 * cached function with an id parameter is correct here.
 */
const cachedProduct = unstable_cache(
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

export function getProductCached(id: string) {
  return cached('product ' + id, () => cachedProduct(id), null)
}

/** Published blog posts (list view). TTL 300s. Invalidate: blogs. */
const cachedBlogPosts = unstable_cache(
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

export function getCachedBlogPosts() {
  return cached('blog posts', () => cachedBlogPosts(), [])
}

/**
 * Settings rows for site content/branding. TTL 3600s. Invalidate: content.
 * Cheap already (indexed key lookup), but it runs on EVERY page render —
 * caching removes a DB round trip from the hottest path in the app.
 */
const cachedContentSettings = unstable_cache(
  async (keys: string[]) => {
    const rows = await db.setting.findMany({ where: { key: { in: keys } } })
    return rows.map((r) => ({ key: r.key, value: r.value }))
  },
  ['content-settings'],
  { tags: [CACHE_TAGS.content], revalidate: 3600 }
)

export function getCachedContentSettings(keys: string[]) {
  return cached('content settings', () => cachedContentSettings(keys), [])
}

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
