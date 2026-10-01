'use client'

import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { MarkdownContent } from '@/components/shared/MarkdownContent'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  children?: React.ReactNode
  /**
   * Admin-authored page body in the shared lightweight Markdown
   * (headings, lists, bold/italic, links) — rendered by MarkdownContent.
   */
  body?: string
}

// Shared layout for static content pages (About, Contact, Terms, Privacy).
// Title/subtitle/body arrive from the Site Content system (admin dashboard);
// `children` is still supported for one-off pages with hardcoded copy.
export function StaticPage({ title, subtitle, children, body }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 shrink-0" aria-label="Go home">
            <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            <span className="font-bold hidden sm:inline">DigitalVault</span>
          </a>
          <div className="flex items-center gap-2">
            <TelegramButton />
            <Button asChild variant="outline" size="sm">
              <a href="/">← Marketplace</a>
            </Button>
          </div>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks widthClass="max-w-3xl" />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <a href="/" className="text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400 inline-flex items-center gap-2 mb-3">
            <ArrowRight className="w-4 h-4 rotate-180" /> Back to marketplace
          </a>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-3 text-base sm:text-lg text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
        </div>

        {body !== undefined ? (
          <MarkdownContent content={body} />
        ) : (
          <div className="prose prose-zinc dark:prose-invert max-w-none
            [&>h2]:text-xl [&>h2]:font-bold [&>h2]:mt-6 [&>h2]:mb-2 [&>h2]:text-zinc-900 dark:[&>h2]:text-zinc-100
            [&>h3]:text-base [&>h3]:font-semibold [&>h3]:mt-4 [&>h3]:mb-1.5 [&>h3]:text-zinc-800 dark:[&>h3]:text-zinc-200
            [&>p]:text-sm [&>p]:leading-relaxed [&>p]:mb-3 [&>p]:text-zinc-600 dark:[&>p]:text-zinc-400
            [&>ul]:my-3 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1 [&>ul]:text-sm [&>ul]:text-zinc-600 dark:[&>ul]:text-zinc-400
            [&>ol]:my-3 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:space-y-1 [&>ol]:text-sm [&>ol]:text-zinc-600 dark:[&>ol]:text-zinc-400
            [&_a]:text-emerald-600 [&_a]:hover:underline
            [&_strong]:font-semibold [&_strong]:text-zinc-800 dark:[&_strong]:text-zinc-200">
            {children}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
