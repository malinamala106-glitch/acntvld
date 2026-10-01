import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { slugify, withSlugSuffix } from '@/lib/slug'
import { revalidateBlogs } from '@/lib/cache'

// GET /api/blogs — published posts (public), or every post with admin=1.
// The public response deliberately omits `content` so the index stays small.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const admin = searchParams.get('admin') === '1'

  if (admin) {
    try {
      await requireAdmin()
      const posts = await db.blogPost.findMany({ orderBy: { createdAt: 'desc' } })
      return NextResponse.json({ posts })
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const posts = await db.blogPost.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      coverImage: true,
      tags: true,
      createdAt: true,
    },
  })

  // Identical for every visitor (no auth in this branch), so a CDN or shared
  // proxy may serve it. Fresh for a minute, then revalidated in the background
  // so a hit never waits on the database.
  return NextResponse.json(
    { posts },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  )
}

/** Normalise a comma-separated tag string: trim, drop blanks, cap the count. */
function normaliseTags(tags: unknown): string | null {
  if (typeof tags !== 'string') return null
  const cleaned = tags
    .split(',')
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12)
  return cleaned.length > 0 ? cleaned.join(', ') : null
}

// POST /api/blogs — admin creates a post.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { title, slug: rawSlug, excerpt, content, coverImage, tags, isPublished } = body || {}

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Post content is required' }, { status: 400 })
    }

    const baseSlug = slugify(typeof rawSlug === 'string' && rawSlug.trim() ? rawSlug : title, 'post')
    let slug = baseSlug
    if (await db.blogPost.findUnique({ where: { slug } })) {
      slug = withSlugSuffix(baseSlug)
    }

    const post = await db.blogPost.create({
      data: {
        title: String(title).trim().slice(0, 200),
        slug,
        excerpt: excerpt ? String(excerpt).trim().slice(0, 300) : null,
        content: String(content).slice(0, 100000),
        coverImage: coverImage ? String(coverImage).trim().slice(0, 500) : null,
        tags: normaliseTags(tags),
        isPublished: typeof isPublished === 'boolean' ? isPublished : true,
      },
    })

    revalidateBlogs()
    return NextResponse.json({ post })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}
