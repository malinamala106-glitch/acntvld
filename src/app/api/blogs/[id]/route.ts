import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { slugify, withSlugSuffix } from '@/lib/slug'
import { revalidateBlogs } from '@/lib/cache'

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

// Admin: update a blog post (partial — only the supplied fields change).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const data: any = {}

    if (typeof body.title === 'string' && body.title.trim()) {
      data.title = body.title.trim().slice(0, 200)
    }
    if (typeof body.excerpt === 'string') {
      data.excerpt = body.excerpt.trim().slice(0, 300) || null
    }
    if (typeof body.content === 'string' && body.content.trim()) {
      data.content = body.content.slice(0, 100000)
    }
    if (typeof body.coverImage === 'string') {
      data.coverImage = body.coverImage.trim().slice(0, 500) || null
    }
    if (body.tags !== undefined) {
      data.tags = normaliseTags(body.tags)
    }
    if (typeof body.isPublished === 'boolean') {
      data.isPublished = body.isPublished
    }

    // Slug is only rewritten when the admin actually edits it, and it stays unique.
    if (typeof body.slug === 'string' && body.slug.trim()) {
      const baseSlug = slugify(body.slug, 'post')
      const clash = await db.blogPost.findUnique({ where: { slug: baseSlug } })
      data.slug = clash && clash.id !== id ? withSlugSuffix(baseSlug) : baseSlug
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const post = await db.blogPost.update({ where: { id }, data })
    revalidateBlogs()
    return NextResponse.json({ post })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 })
  }
}

// Admin: delete a blog post.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    await db.blogPost.delete({ where: { id } })
    revalidateBlogs()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 })
  }
}
