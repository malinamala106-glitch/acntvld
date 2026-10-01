'use client'

import { useState } from 'react'
import { FileText, Download, X, ImageIcon, FileArchive } from 'lucide-react'

export interface AttachmentMeta {
  name: string
  size: number
  mime: string
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferMime(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'zip') return 'application/zip'
  return ''
}

function iconFor(mime: string) {
  if (mime === 'application/zip') return FileArchive
  if (mime.startsWith('image/')) return ImageIcon
  return FileText
}

/**
 * Renders one chat attachment. Images show as an inline thumbnail that opens a
 * full-size lightbox; other files show a file card with name, size and a
 * download button. Used by both the buyer widget and the admin console so the
 * two sides look and behave identically.
 */
export function ChatAttachment({
  url,
  meta,
  tone,
  fontPx = 14,
}: {
  url: string
  meta?: AttachmentMeta | null
  /** 'out' = the sender's own bubble (colored), 'in' = the other side. */
  tone: 'out' | 'in'
  fontPx?: number
}) {
  const [lightbox, setLightbox] = useState(false)
  const mime = meta?.mime || inferMime(url)
  const isImage = mime.startsWith('image/')
  const name = meta?.name || url.split('/').pop() || 'attachment'
  const sizeLabel = meta && meta.size > 0 ? formatBytes(meta.size) : ''
  const Icon = iconFor(mime)
  const small = Math.max(10, fontPx - 3)

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="mt-1 block overflow-hidden rounded-lg border border-black/10 dark:border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`Open image ${name}`}
          title={name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} className="h-32 w-auto max-w-full object-cover" loading="lazy" />
        </button>

        {lightbox && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Image preview: ${name}`}
            onClick={() => setLightbox(false)}
          >
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Close image preview"
            >
              <X className="h-5 w-5" />
            </button>
            {/* Stop propagation so clicking the image itself doesn't close it. */}
            <div onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={name} className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
              <div className="mt-2 text-center text-xs text-white/70">{name}{sizeLabel ? ` · ${sizeLabel}` : ''}</div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <a
      href={url}
      download={name}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-1 flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
        tone === 'out'
          ? 'border-white/25 bg-white/10 hover:bg-white/20'
          : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
      title={`Download ${name}`}
    >
      <Icon className="h-5 w-5 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: `${small}px` }}>{name}</span>
        {sizeLabel && <span className="block opacity-70" style={{ fontSize: `${Math.max(9, small - 1)}px` }}>{sizeLabel}</span>}
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-80" />
    </a>
  )
}
