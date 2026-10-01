'use client'

import { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered,
  Link as LinkIcon, Code, Eye, Code2,
} from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

// A lightweight WYSIWYG editor that uses contentEditable + document.execCommand.
// Stores the output as HTML in the database. Has a toggle between Visual and HTML mode.
// No external dependencies — uses the browser's built-in rich text editing API.
export function RichTextEditor({ value, onChange, placeholder = 'Describe your product...', rows = 5 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'visual' | 'html'>('visual')
  const [htmlValue, setHtmlValue] = useState(value)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')

  // Sync initial value into the editor when it mounts or value changes externally
  useEffect(() => {
    if (editorRef.current && mode === 'visual') {
      // Only set if the content differs (avoid cursor jump)
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value || ''
      }
    }
  }, [value, mode])

  // When switching to HTML mode, sync the editor content to the textarea
  function switchToHtml() {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML
      setHtmlValue(html)
      onChange(html)
    }
    setMode('html')
  }

  // When switching to Visual mode, load the textarea HTML back into the editor
  function switchToVisual() {
    if (editorRef.current) {
      editorRef.current.innerHTML = htmlValue || ''
      onChange(htmlValue)
    }
    setMode('visual')
  }

  // Exec a formatting command
  function exec(command: string, val?: string) {
    // Ensure focus is in the editor
    editorRef.current?.focus()
    try {
      document.execCommand(command, false, val)
    } catch {}
    // Sync the HTML to the parent state
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  function handleInput() {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  function insertLink() {
    if (!linkUrl.trim()) {
      setLinkOpen(false)
      return
    }
    editorRef.current?.focus()
    // Restore selection if the user selected text before clicking the link button
    const selection = window.getSelection()
    const text = linkText.trim() || linkUrl.trim()
    // If there's a selection, wrap it; otherwise insert new text
    const linkHtml = `<a href="${linkUrl.trim()}" target="_blank" rel="noopener noreferrer">${text}</a>`
    document.execCommand('insertHTML', false, linkHtml)
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
    setLinkOpen(false)
    setLinkUrl('')
    setLinkText('')
  }

  const toolbarBtn = (icon: React.ReactNode, command: string, val: string | undefined, title: string) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); exec(command, val) }}
      className="w-8 h-8 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  )

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-1 py-1 flex-wrap">
        {toolbarBtn(<Bold className="w-4 h-4" />, 'bold', undefined, 'Bold')}
        {toolbarBtn(<Italic className="w-4 h-4" />, 'italic', undefined, 'Italic')}
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        {toolbarBtn(<Heading1 className="w-4 h-4" />, 'formatBlock', '<h1>', 'Heading 1')}
        {toolbarBtn(<Heading2 className="w-4 h-4" />, 'formatBlock', '<h2>', 'Heading 2')}
        {toolbarBtn(<Heading3 className="w-4 h-4" />, 'formatBlock', '<h3>', 'Heading 3')}
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        {toolbarBtn(<List className="w-4 h-4" />, 'insertUnorderedList', undefined, 'Bullet list')}
        {toolbarBtn(<ListOrdered className="w-4 h-4" />, 'insertOrderedList', undefined, 'Numbered list')}
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        <button
          type="button"
          onClick={() => setLinkOpen(!linkOpen)}
          className="w-8 h-8 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          title="Insert link"
          aria-label="Insert link"
        >
          <LinkIcon className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
          <button
            type="button"
            onClick={() => mode === 'html' && switchToVisual()}
            className={`px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1 ${mode === 'visual' ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}
          >
            <Eye className="w-3 h-3" /> Visual
          </button>
          <button
            type="button"
            onClick={() => mode === 'visual' && switchToHtml()}
            className={`px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1 ${mode === 'html' ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}
          >
            <Code2 className="w-3 h-3" /> HTML
          </button>
        </div>
      </div>

      {/* Link insertion row */}
      {linkOpen && (
        <div className="flex items-center gap-2 p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <Input
            type="url"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            className="flex-1 h-8 text-xs"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink() } }}
          />
          <Input
            type="text"
            placeholder="Link text (optional)"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            className="w-40 h-8 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink() } }}
          />
          <Button type="button" size="sm" onClick={insertLink} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
            Insert
          </Button>
        </div>
      )}

      {/* Editor / HTML textarea */}
      {mode === 'visual' ? (
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onBlur={handleInput}
          className="prose prose-sm dark:prose-invert max-w-none min-h-[120px] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-emerald-600 [&_a]:underline [&_p]:my-1 [&_p]:leading-relaxed"
          style={{ minHeight: `${rows * 24 + 24}px` }}
          data-placeholder={placeholder}
          suppressContentEditableWarning
        />
      ) : (
        <textarea
          value={htmlValue}
          onChange={(e) => { setHtmlValue(e.target.value); onChange(e.target.value) }}
          onBlur={() => { if (editorRef.current) { editorRef.current.innerHTML = htmlValue } }}
          rows={rows}
          className="w-full p-3 text-xs font-mono text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y"
          placeholder="<p>Enter HTML here...</p>"
          style={{ minHeight: `${rows * 24 + 24}px` }}
        />
      )}
    </div>
  )
}
