import React from 'react'

/**
 * Minimal Markdown renderer for admin-authored copy (blog posts, static page
 * bodies). Supported, per line:
 *
 *   `# H1` / `## H2` / `### H3`   — headings
 *   `- item` / `* item`           — bullet lists
 *   `1. item` / `2. item` …       — numbered lists
 *   blank line                    — separates blocks
 *
 * Inline: `**bold**`, `*italic*`, `[text](url)` — URLs must be http(s),
 * mailto, tel, or site-relative; anything else renders as plain text, so
 * `javascript:` links can never be injected through the admin editor.
 *
 * Everything renders as React children (no dangerouslySetInnerHTML), so the
 * output is XSS-safe by construction.
 */

function safeHref(url: string): string | null {
  const href = url.trim()
  if (!href) return null
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (/^[a-z][a-z0-9+.\-]*:/i.test(href)) {
    try {
      const protocol = new URL(href).protocol
      return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) ? href : null
    } catch {
      return null
    }
  }
  return null
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  // **bold**, *italic*, [text](url) — bold first so ** wins over single *.
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g
  let lastIndex = 0
  let match
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={key++} className="font-bold text-zinc-900 dark:text-zinc-100">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4] && match[5]) {
      const href = safeHref(match[5])
      if (href) {
        const external = /^https?:/i.test(href)
        parts.push(
          <a
            key={key++}
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="text-emerald-600 hover:underline"
          >
            {match[4]}
          </a>
        )
      } else {
        parts.push(match[4])
      }
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length === 0 ? text : parts
}

export function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let listBuffer: string[] = []
  let orderedList = false
  let paragraphBuffer: string[] = []

  function flushParagraph(key: number) {
    if (paragraphBuffer.length === 0) return
    elements.push(
      <p key={`p-${key}`} className="text-zinc-700 dark:text-zinc-300 leading-relaxed mb-4 whitespace-pre-wrap">
        {renderInline(paragraphBuffer.join(' '))}
      </p>
    )
    paragraphBuffer = []
  }

  function flushList(key: number) {
    if (listBuffer.length === 0) return
    const items = listBuffer.map((item, i) => <li key={i}>{renderInline(item)}</li>)
    elements.push(
      orderedList ? (
        <ol key={`ol-${key}`} className="list-decimal pl-6 mb-4 space-y-1 text-zinc-700 dark:text-zinc-300">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${key}`} className="list-disc pl-6 mb-4 space-y-1 text-zinc-700 dark:text-zinc-300">
          {items}
        </ul>
      )
    )
    listBuffer = []
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed)
    if (trimmed.startsWith('### ')) {
      flushParagraph(i)
      flushList(i)
      elements.push(<h3 key={`h3-${i}`} className="text-lg font-bold mt-6 mb-2 text-zinc-900 dark:text-zinc-100">{renderInline(trimmed.slice(4))}</h3>)
    } else if (trimmed.startsWith('## ')) {
      flushParagraph(i)
      flushList(i)
      elements.push(<h2 key={`h2-${i}`} className="text-xl font-bold mt-6 mb-2 text-zinc-900 dark:text-zinc-100">{renderInline(trimmed.slice(3))}</h2>)
    } else if (trimmed.startsWith('# ')) {
      flushParagraph(i)
      flushList(i)
      elements.push(<h1 key={`h1-${i}`} className="text-2xl font-bold mt-6 mb-3 text-zinc-900 dark:text-zinc-100">{renderInline(trimmed.slice(2))}</h1>)
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph(i)
      if (orderedList) flushList(i)
      orderedList = false
      listBuffer.push(trimmed.slice(2))
    } else if (orderedMatch) {
      flushParagraph(i)
      if (!orderedList) flushList(i)
      orderedList = true
      listBuffer.push(orderedMatch[2])
    } else if (trimmed === '') {
      flushParagraph(i)
      flushList(i)
    } else {
      flushList(i)
      orderedList = false
      paragraphBuffer.push(trimmed)
    }
  })

  flushParagraph(9999)
  flushList(9999)

  return <>{elements}</>
}
