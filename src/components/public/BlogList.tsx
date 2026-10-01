'use client'

import { memo, useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { isImageUrlValue } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { MarkdownContent as Markdown } from '@/components/shared/MarkdownContent'
import { ArrowRight, Search, Calendar, Tag, ArrowLeft } from 'lucide-react'
import type { BlogPost, SiteContent } from '@/lib/types'
import { contentValue } from '@/lib/site-content'

// ----- Blog list -----

interface BlogListPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverImage: string | null
  tags: string | null
  createdAt: string
}

export function BlogList({ posts: initial, content, siteName = 'DigitalVault' }: { posts: BlogListPost[]; content?: SiteContent | null; siteName?: string }) {
  const copy = (key: string) => contentValue(content, key)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  // Collect all tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const p of initial) {
      if (p.tags) {
        for (const t of p.tags.split(',').map((x) => x.trim()).filter(Boolean)) {
          tagSet.add(t)
        }
      }
    }
    return Array.from(tagSet).sort()
  }, [initial])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return initial.filter((p) => {
      const matchSearch = !q ||
        p.title.toLowerCase().includes(q) ||
        (p.excerpt ?? '').toLowerCase().includes(q) ||
        (p.tags ?? '').toLowerCase().includes(q)
      const matchTag = !activeTag || (p.tags && p.tags.split(',').map((x) => x.trim()).includes(activeTag))
      return matchSearch && matchTag
    })
  }, [initial, search, activeTag])

  // The bento hero is whichever post leads the current (filtered) result set, so the
  // search/tag filters keep working exactly as before.
  const [hero, ...rest] = filtered

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 shrink-0" aria-label="Go home">
            <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            <span className="font-bold hidden sm:inline">{siteName}</span>
          </a>
          <div className="flex items-center gap-2">
            <TelegramButton />
            <Button asChild variant="outline" size="sm">
              <a href="/">← Marketplace</a>
            </Button>
          </div>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={content} activeHref="/blogs" />
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-16">
        {/* Header: title + search on the left, filter pills on the right */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-12">
          {/* shrink-0 keeps the heading readable when there are many filter pills */}
          <div className="lg:max-w-2xl lg:shrink-0">
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight mb-3">
              {copy('blog.title')}
            </h1>
            <p className="text-base text-slate-500 max-w-xl leading-relaxed">
              {copy('blog.subtitle')}
            </p>
            <div className="relative max-w-md mt-6">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                placeholder={copy('blog.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full bg-white border-slate-200"
                aria-label="Search blog posts"
              />
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <button
                onClick={() => setActiveTag(null)}
                className={filterPillClass(activeTag === null)}
              >
                All
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(t === activeTag ? null : t)}
                  className={filterPillClass(t === activeTag)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 py-20 text-center text-slate-500">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>{search ? `No posts match "${search}".` : copy('blog.emptyText')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[minmax(280px,auto)]">
            <BlogCard key={hero.id} post={hero} variant="hero" />
            {rest.map((p) => (
              <BlogCard key={p.id} post={p} variant="regular" />
            ))}
          </div>
        )}
      </main>

      <SiteFooter siteName={siteName} tagline={copy('footer.tagline')} />
    </div>
  )
}

/** Shared pill styling for the tag filter row (active = solid slate, inactive = white outline). */
function filterPillClass(active: boolean): string {
  return active
    ? 'text-xs font-semibold text-white bg-slate-900 px-4 py-2 rounded-full transition'
    : 'text-xs font-medium text-slate-600 bg-white border border-slate-200 px-4 py-2 rounded-full hover:bg-slate-50 transition'
}

/**
 * Category colours for the metadata row. The data has `tags` (comma-separated), not a
 * `category` column, so the primary tag stands in as the category.
 */
const CATEGORY_COLORS: Record<string, string> = {
  auctions: 'text-emerald-600',
  'special-deals': 'text-emerald-600',
  crypto: 'text-blue-600',
  usdt: 'text-blue-600',
  deposits: 'text-blue-600',
  streaming: 'text-amber-600',
  deals: 'text-amber-600',
  'weekly-picks': 'text-amber-600',
  safety: 'text-red-600',
  security: 'text-red-600',
  'buyer-guide': 'text-violet-600',
  guide: 'text-violet-600',
}

function categoryClass(tag: string): string {
  return CATEGORY_COLORS[tag.toLowerCase()] ?? 'text-slate-500'
}

// Memoised: typing in the search box re-renders BlogList on every keystroke;
// cards whose props haven't changed skip their own re-render entirely.
const BlogCard = memo(function BlogCard({ post, variant }: { post: BlogListPost; variant: 'hero' | 'regular' }) {
  const isHero = variant === 'hero'
  const isImageUrl = isImageUrlValue(post.coverImage)
  const tags = post.tags ? post.tags.split(',').map((x) => x.trim()).filter(Boolean) : []
  const primaryTag = tags[0] ?? ''
  // Existing route is /blogs/[slug] — /blog/... would 404.
  const postUrl = `/blogs/${post.slug}`

  return (
    <Link
      href={postUrl}
      className={`group bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col cursor-pointer hover:border-slate-300 hover:shadow-lg transition-all duration-300 ${
        isHero ? 'md:col-span-2 lg:col-span-2 lg:row-span-2' : ''
      }`}
    >
      {/* Image / icon area */}
      <div
        className={
          isHero
            ? 'flex-1 bg-slate-100 relative flex items-center justify-center overflow-hidden min-h-[300px]'
            : 'h-40 bg-slate-100 flex items-center justify-center overflow-hidden'
        }
      >
        {isImageUrl ? (
          // The bento hero is the first card and the likely LCP element, so it
          // gets priority; the smaller cards below the fold defer automatically.
          <Image
            src={post.coverImage!}
            alt={post.title}
            fill
            sizes={isHero ? '100vw' : '(max-width: 768px) 100vw, 50vw'}
            className="w-full h-full object-cover"
            priority={isHero}
            unoptimized={post.coverImage!.startsWith('http')}
          />
        ) : (
          <span
            className={
              isHero
                ? 'text-8xl text-slate-400 group-hover:scale-105 transition-transform duration-700'
                : 'text-5xl text-slate-400 group-hover:scale-110 transition-transform duration-500'
            }
            aria-hidden="true"
          >
            {post.coverImage || '📝'}
          </span>
        )}
        {isHero && (
          <span className="absolute top-5 left-5 bg-white/90 backdrop-blur-md text-xs font-bold text-slate-800 px-3 py-1.5 rounded-full uppercase tracking-wider">
            Featured
          </span>
        )}
      </div>

      {/* Content */}
      <div className={isHero ? 'p-8' : 'p-6 flex-1 flex flex-col'}>
        {/* Metadata: category • date */}
        <div
          className={
            isHero
              ? 'flex items-center gap-3 text-xs font-semibold text-slate-500 mb-3'
              : 'flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2'
          }
        >
          {primaryTag && (
            <>
              <span className={`${categoryClass(primaryTag)} uppercase tracking-wider font-bold`}>
                {primaryTag}
              </span>
              <span className="text-slate-300" aria-hidden="true">•</span>
            </>
          )}
          <span className="font-normal">
            {new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
          {/* Read time is intentionally omitted: BlogPost has no `readTime` field and the
              blog query doesn't select `content`, and this refactor must not change the
              data shape. Add one of those and the element can come back. */}
        </div>

        <h2
          className={
            isHero
              ? 'text-3xl font-bold text-slate-900 leading-tight mb-3 group-hover:text-emerald-600 transition-colors'
              : 'text-lg font-bold text-slate-900 leading-snug mb-2 group-hover:text-emerald-600 transition-colors'
          }
        >
          {post.title}
        </h2>

        <p
          className={
            isHero
              ? 'text-base text-slate-500 leading-relaxed max-w-2xl'
              : 'text-sm text-slate-500 line-clamp-2'
          }
        >
          {post.excerpt || 'Read more...'}
        </p>
      </div>
    </Link>
  )
})

// ----- Blog post view -----

export function BlogPostView({ post, content, siteName = 'DigitalVault' }: { post: BlogPost; content?: SiteContent | null; siteName?: string }) {
  const copy = (key: string) => contentValue(content, key)
  const isImageUrl = isImageUrlValue(post.coverImage)
  const tags = post.tags ? post.tags.split(',').map((x) => x.trim()).filter(Boolean) : []

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <Toaster richColors position="top-right" />

      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a href="/blogs" className="text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400 inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to blog
          </a>
          <div className="flex items-center gap-2">
            <TelegramButton />
            <a href="/" className="flex items-center gap-2 shrink-0" aria-label="Go home">
              <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            </a>
          </div>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={content} activeHref="/blogs" />
      </header>

      <article className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-6 py-8 sm:py-12">
        {/* Cover */}
        <div className="aspect-[2/1] bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 rounded-lg overflow-hidden flex items-center justify-center text-7xl mb-6">
          {isImageUrl ? (
            // Article cover is above the fold and the LCP candidate.
            <Image
              src={post.coverImage!}
              alt={post.title}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="w-full h-full object-cover"
              priority
              unoptimized={post.coverImage!.startsWith('http')}
            />
          ) : (
            post.coverImage || '📝'
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 mb-3 flex-wrap text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          {tags.length > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {tags.join(', ')}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4">
          {post.title}
        </h1>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 italic border-l-4 border-emerald-400 dark:border-emerald-600 pl-4">
            {post.excerpt}
          </p>
        )}

        {/* Content — rendered as markdown-ish */}
        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <Markdown content={post.content} />
        </div>

        {/* Footer CTA */}
        <div className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-2 justify-between items-center">
          <p className="text-sm text-zinc-500">Found this helpful?</p>
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <a href="/">Browse the marketplace <ArrowRight className="w-4 h-4 ml-1" /></a>
          </Button>
        </div>
      </article>

      <SiteFooter siteName={siteName} tagline={copy('footer.tagline')} content={content} />
    </div>
  )
}

