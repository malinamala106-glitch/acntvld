'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  Upload, Link as LinkIcon, Smile, X, Loader2, ImageIcon,
} from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  label?: string
}

// Detect if a string is a URL (starts with / or http)
function isImageUrl(s: string): boolean {
  return !!s && (s.startsWith('/') || s.startsWith('http'))
}

// Detect if a string is a single emoji (1-8 chars, no URL-like content)
function isEmoji(s: string): boolean {
  return !!s && !s.startsWith('/') && !s.startsWith('http') && s.length <= 8
}

// Image uploader with three modes:
// 1. Upload image file (drag & drop + file picker) — supports JPG, PNG, SVG, WebP, max 2MB
// 2. Paste image URL — shows a live thumbnail preview
// 3. Type emoji — for products that use an emoji as their image
// Shows a live preview of the current value and a remove/replace button.
export function ImageUploader({ value, onChange, label = 'Product image' }: Props) {
  const [mode, setMode] = useState<'upload' | 'url' | 'emoji'>(isImageUrl(value) ? 'url' : isEmoji(value) ? 'emoji' : 'upload')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const uploadFile = useCallback(async (file: File) => {
    // Validate type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error(`File type "${file.type}" not allowed. Supported: JPG, PNG, SVG, WebP`)
      return
    }
    // Validate size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large (max 2MB)')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/products/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Upload failed')
        return
      }
      onChange(data.url)
      toast.success('Image uploaded')
      setMode('url')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [onChange])

  function handleFileSelected(file: File | null | undefined) {
    if (!file) return
    uploadFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelected(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
  }

  function removeImage() {
    onChange('')
  }

  const showUrl = isImageUrl(value)
  const showEmoji = isEmoji(value)

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Live preview */}
      {value && (
        <div className="relative inline-block">
          <div className="w-24 h-24 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
            {showUrl ? (
              <Image
                src={value}
                alt="Preview"
                width={96}
                height={96}
                className="w-full h-full object-cover"
                unoptimized={value.startsWith('http')}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <span className="text-4xl">{value}</span>
            )}
          </div>
          {/* Remove button */}
          <button
            type="button"
            onClick={removeImage}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
            aria-label="Remove image"
            title="Remove image"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Mode tabs */}
      {!value && (
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'upload' ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}
          >
            <Upload className="w-3 h-3" /> Upload
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'url' ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}
          >
            <LinkIcon className="w-3 h-3" /> URL
          </button>
          <button
            type="button"
            onClick={() => setMode('emoji')}
            className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'emoji' ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}
          >
            <Smile className="w-3 h-3" /> Emoji
          </button>
        </div>
      )}

      {/* Mode content */}
      {!value && mode === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
              : 'border-zinc-300 dark:border-zinc-700 hover:border-emerald-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/svg+xml,image/webp"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-xs text-zinc-500">Uploading…</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="w-6 h-6 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Drag & drop or click to upload</span>
              <span className="text-xs text-zinc-400">JPG, PNG, SVG, WebP — max 2MB</span>
            </div>
          )}
        </div>
      )}

      {!value && mode === 'url' && (
        <div className="relative">
          <ImageIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            type="url"
            placeholder="https://example.com/product.jpg"
            value=""
            onChange={(e) => { if (e.target.value) { onChange(e.target.value); } }}
            className="pl-9"
            onBlur={(e) => { if (e.target.value.trim()) onChange(e.target.value.trim()) }}
          />
          <p className="text-xs text-zinc-400 mt-1">Paste an image URL — a preview will appear above.</p>
        </div>
      )}

      {!value && mode === 'emoji' && (
        <div>
          <Input
            type="text"
            placeholder="📦"
            value=""
            onChange={(e) => { if (e.target.value) onChange(e.target.value.slice(0, 8)) }}
            className="text-center text-3xl"
            maxLength={8}
          />
          <p className="text-xs text-zinc-400 mt-1">Type an emoji to use as the product image.</p>
        </div>
      )}

      {/* Replace button when image is set */}
      {value && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { onChange(''); setMode('upload') }}>
            <Upload className="w-3.5 h-3.5 mr-1" /> Replace
          </Button>
          <span className="text-xs text-zinc-400">
            {showUrl ? 'Image URL' : 'Emoji'}: <span className="font-mono">{showUrl ? value.slice(0, 40) + (value.length > 40 ? '…' : '') : value}</span>
          </span>
        </div>
      )}
    </div>
  )
}
