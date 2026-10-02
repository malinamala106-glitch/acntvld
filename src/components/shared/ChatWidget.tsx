'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { MessageCircle, X, Send, Loader2, Plus, Minus, Type, Paperclip, Star, AlertCircle, Check, CheckCheck } from 'lucide-react'
import { ChatAttachment, formatBytes, type AttachmentMeta } from '@/components/shared/ChatAttachment'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMsg {
  id: string
  senderType: 'user' | 'admin' | 'system' | 'guest'
  body: string
  attachmentUrl?: string | null
  attachmentMeta?: string | null
  createdAt: string
  deliveredAt?: string | null
  readAt?: string | null
  pending?: boolean // optimistic only — not yet confirmed by the server
  failed?: boolean
}

interface Convo {
  id: string
  topic: string
  status: string
  createdAt: string
  lastMessageAt: string
  rated?: boolean
  rating?: number | null
  context?: { orderId: string; shortId: number | null; productName: string | null } | null
}

/** In-flight upload state for the composer's attachment chip. */
interface PendingUpload {
  file: File
  name: string
  size: number
  mime: string
  progress: number
  url: string | null
  error: string | null
}

const TOPICS = [
  { value: 'order', label: 'Order-related issue' },
  { value: 'purchase', label: 'Purchase-related issue' },
  { value: 'deposit', label: 'Deposit-related issue' },
  { value: 'product', label: 'Product-related issue' },
  { value: 'other', label: 'Other issue' },
] as const

// Generate or get a guest session id — only used when the visitor is NOT
// authenticated. Persisted in localStorage so a guest keeps their thread
// across tabs and visits. 8-32 alphanumeric chars — the exact server format.
//
// The id is a bearer credential: whoever holds it can read that guest's support
// thread and claim it via /api/chat/merge. It is therefore generated with the
// Web Crypto CSPRNG (16 bytes = 128 bits) rather than Math.random, which is a
// non-cryptographic PRNG and whose output can be reconstructed from a few
// observed values.
function getGuestSession(): string {
  if (typeof window === 'undefined') return ''
  let s = localStorage.getItem('support_guest_session')
  if (!s || !/^[a-zA-Z0-9]{8,32}$/.test(s)) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('support_guest_session', s)
  }
  return s
}

const FONT_SIZES = [12, 13, 14, 16, 18, 20, 22] // px
const DEFAULT_FONT_IDX = 2 // 14px
const FONT_KEY = 'chat_font_idx'

const MESSAGE_PAGE = 50
const TYPING_WINDOW_MS = 4000
const POLL_MS = 1000 // incremental poll (Bug 6)

function parseMeta(raw: string | null | undefined): AttachmentMeta | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? { name: String(o.name ?? 'attachment'), size: Number(o.size) || 0, mime: String(o.mime ?? '') } : null
  } catch {
    return null
  }
}

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [conversation, setConversation] = useState<Convo | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fontIdx, setFontIdx] = useState<number>(DEFAULT_FONT_IDX)
  const [unread, setUnread] = useState(0)
  const [authedUserId, setAuthedUserId] = useState<string | null>(null)
  const [authedRole, setAuthedRole] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [starting, setStarting] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [adminTyping, setAdminTyping] = useState(false)
  const [ratingStars, setRatingStars] = useState(0)
  const [ratedLocally, setRatedLocally] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [upload, setUpload] = useState<PendingUpload | null>(null)
  const [context, setContext] = useState<{ label: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingSentRef = useRef(0)
  const adminTypingRef = useRef(false)
  const newestServerAtRef = useRef<string | null>(null)

  const guestSession = typeof window !== 'undefined' ? getGuestSession() : ''

  // Restore preferred font size from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem(FONT_KEY)
    const idx = raw ? parseInt(raw, 10) : NaN
    if (!Number.isNaN(idx) && idx >= 0 && idx < FONT_SIZES.length) setFontIdx(idx)
  }, [])

  function bumpFont(delta: 1 | -1) {
    setFontIdx((cur) => {
      const next = Math.max(0, Math.min(FONT_SIZES.length - 1, cur + delta))
      if (typeof window !== 'undefined') localStorage.setItem(FONT_KEY, String(next))
      return next
    })
  }

  function resetFont() {
    setFontIdx(DEFAULT_FONT_IDX)
    if (typeof window !== 'undefined') localStorage.setItem(FONT_KEY, String(DEFAULT_FONT_IDX))
  }

  // Listen for the "open-chat-widget" custom event (fired by other parts of
  // the app — e.g. the Deposit pending page's "Direct Chat" button).
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onOpen() { setOpen(true) }
    window.addEventListener('open-chat-widget', onOpen)
    return () => window.removeEventListener('open-chat-widget', onOpen)
  }, [])

  // Bootstrap: fetch the current user so we know whether to pass guestSession.
  // When a logged-in buyer still has a guest session in localStorage, merge
  // their guest conversations into the account and clear the key.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled && data?.user?.id) {
            setAuthedUserId(data.user.id)
            setAuthedRole(data.user.role ?? null)
            if (data.user.role !== 'ADMIN') {
              const gs = localStorage.getItem('support_guest_session')
              if (gs) {
                fetch('/api/chat/merge', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ guestSession: gs }),
                })
                  .then((r) => (r.ok ? localStorage.removeItem('support_guest_session') : null))
                  .catch(() => {})
              }
            }
          }
        }
      } catch {}
      if (!cancelled) setBootstrapped(true)
    })()
    return () => { cancelled = true }
  }, [])

  const identityParams = useCallback(() => {
    const params = new URLSearchParams()
    if (!authedUserId) params.set('guestSession', guestSession)
    return params
  }, [authedUserId, guestSession])

  // Capture page context when the widget opens on a product/order page, so the
  // admin sees "Context: Order #1001 (Product)" (Bug 4).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('order') || params.get('orderId')
    const productId = params.get('product') || params.get('id')
    if (orderId) setContext({ label: `Order ${orderId}` })
    else if (productId) setContext({ label: `Product ${productId}` })
  }, [])

  // Fetch conversation + messages. Merge-based: new messages are appended by
  // stable id; when `after` is given only the new tail is fetched (Bug 6).
  const loadMessages = useCallback(async (opts?: { before?: string; after?: string; silent?: boolean }) => {
    if (!bootstrapped) return
    const params = identityParams()
    if (opts?.before) params.set('before', opts.before)
    if (opts?.after) params.set('after', opts.after)
    try {
      const res = await fetch(`/api/chat/messages?${params.toString()}`)
      const data = await res.json()
      const incoming: ChatMsg[] = data.messages ?? []

      if (opts?.before) {
        setMessages((cur) => {
          const seen = new Set(cur.map((m) => m.id))
          return [...incoming.filter((m) => !seen.has(m.id)), ...cur]
        })
        setHasMore(!!data.hasMore)
        return
      }

      setConversation(data.conversation ?? null)
      setHasMore(!!data.hasMore)
      // Track newest confirmed server timestamp for incremental polling.
      for (const m of incoming) {
        if (!newestServerAtRef.current || m.createdAt > newestServerAtRef.current) newestServerAtRef.current = m.createdAt
      }
      setMessages((cur) => {
        const byId = new Map<string, ChatMsg>()
        for (const m of cur) if (!m.pending) byId.set(m.id, m)
        for (const m of incoming) byId.set(m.id, m)
        // Keep optimistic sends that the server hasn't confirmed yet.
        const confirmedBodies = new Set(incoming.map((m) => `${m.senderType}:${m.body}`))
        const keptPending = cur.filter((m) => m.pending && !confirmedBodies.has(`${m.senderType}:${m.body}`))
        const merged = [...byId.values(), ...keptPending]
        merged.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        return merged
      })
      if (!opts?.silent) {
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
      }
    } catch {}
  }, [bootstrapped, identityParams])

  // Fetch unread count (drives the badge on the floating button).
  const loadUnread = useCallback(async () => {
    if (!bootstrapped) return
    try {
      const res = await fetch(`/api/chat/read?${identityParams().toString()}`)
      const data = await res.json()
      setUnread(data?.unread ?? 0)
    } catch {}
  }, [bootstrapped, identityParams])

  // Poll unread every 10s while closed (cheap count query).
  useEffect(() => {
    if (!bootstrapped) return
    loadUnread()
    const t = setInterval(loadUnread, 10000)
    return () => clearInterval(t)
  }, [bootstrapped, loadUnread])

  // When open: initial load (full), then a 1s INCREMENTAL poll of just the new
  // tail + a typing poll.
  useEffect(() => {
    if (!open || !bootstrapped) return
    setLoading(true)
    Promise.all([
      loadMessages(),
      fetch('/api/chat/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authedUserId ? {} : { guestSession }),
      })
        .then(() => setUnread(0))
        .catch(() => {}),
    ]).finally(() => setLoading(false))

    const t = setInterval(() => {
      const after = newestServerAtRef.current
      loadMessages(after ? { after, silent: true } : { silent: true })
    }, POLL_MS)
    return () => clearInterval(t)
  }, [open, bootstrapped, loadMessages, authedUserId, guestSession])

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [open])

  // Typing indicator poll (buyer side sees admin typing).
  useEffect(() => {
    if (!open || !conversation || conversation.status === 'revoke') return
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/messages?${identityParams().toString()}&typing=1`)
        if (!res.ok) return
        const data = await res.json()
        const at = data?.conversation?.adminTypingAt ? new Date(data.conversation.adminTypingAt).getTime() : 0
        const isTyping = at > Date.now() - TYPING_WINDOW_MS
        if (isTyping !== adminTypingRef.current) {
          adminTypingRef.current = isTyping
          setAdminTyping(isTyping)
        }
      } catch {}
    }, 2500)
    return () => clearInterval(t)
  }, [open, conversation, identityParams])

  function notifyTyping() {
    if (!conversation) return
    const now = Date.now()
    if (now - lastTypingSentRef.current < 2000) return
    lastTypingSentRef.current = now
    fetch('/api/chat/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authedUserId ? { side: 'user' } : { side: 'user', guestSession }),
    }).catch(() => {})
  }

  // Topic selection creates (or, after completion, force-creates) a convo.
  async function startWithTopic(topic: string) {
    if (starting) return
    setStarting(true)
    try {
      const res = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          forceNew: true,
          ...(authedUserId ? {} : { guestSession }),
          ...(context ? { contextOrderId: context.label.startsWith('Order ') ? context.label.slice(6) : undefined } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Could not start the conversation')
        return
      }
      setPickerOpen(false)
      newestServerAtRef.current = null
      setMessages([])
      await loadMessages()
      setTimeout(() => inputRef.current?.focus(), 150)
    } catch {
      toast.error('Could not start the conversation')
    } finally {
      setStarting(false)
    }
  }

  // Reopen a completed conversation explicitly.
  async function reopenConversation() {
    if (!conversation) return
    try {
      const res = await fetch('/api/chat/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, ...(authedUserId ? {} : { guestSession }) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.error || 'Could not reopen the conversation')
        return
      }
      setRatedLocally(false)
      await loadMessages()
      setTimeout(() => inputRef.current?.focus(), 150)
    } catch {
      toast.error('Could not reopen the conversation')
    }
  }

  // Lazy-load older messages when scrolled to the top.
  function onScroll() {
    const el = scrollRef.current
    if (!el || loadingOlder || !hasMore) return
    if (el.scrollTop < 60 && messages.length > 0) {
      setLoadingOlder(true)
      const oldest = messages.find((m) => !m.pending)
      loadMessages({ before: oldest?.createdAt }).finally(() => setLoadingOlder(false))
    }
  }

  // Upload with progress via XHR (fetch can't report upload progress).
  function uploadFile(file: File) {
    setUpload({ file, name: file.name, size: file.size, mime: file.type, progress: 0, url: null, error: null })
    const form = new FormData()
    form.append('file', file)
    if (!authedUserId) form.append('guestSession', guestSession)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/chat/upload')
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      const pct = Math.round((e.loaded / e.total) * 100)
      setUpload((u) => (u && u.file === file ? { ...u, progress: pct } : u))
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}')
        if (xhr.status >= 200 && xhr.status < 300 && data.url) {
          setUpload((u) =>
            u && u.file === file
              ? { ...u, url: data.url, name: data.name ?? file.name, size: data.size ?? file.size, mime: data.mime ?? file.type, progress: 100, error: null }
              : u
          )
        } else {
          setUpload((u) => (u && u.file === file ? { ...u, error: data?.error || 'Upload failed' } : u))
        }
      } catch {
        setUpload((u) => (u && u.file === file ? { ...u, error: 'Upload failed' } : u))
      }
    }
    xhr.onerror = () => setUpload((u) => (u && u.file === file ? { ...u, error: 'Upload failed' } : u))
    xhr.send(form)
  }

  // Optimistic send: render instantly with a pending marker, confirm on server.
  async function send() {
    const text = input.trim()
    const attachment = upload?.url
      ? { url: upload.url, meta: { name: upload.name, size: upload.size, mime: upload.mime } }
      : null
    if ((!text && !attachment) || sending || !conversation || (upload && !upload.url)) return
    setSending(true)
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: ChatMsg = {
      id: tempId,
      senderType: authedUserId ? 'user' : 'guest',
      body: text,
      attachmentUrl: attachment?.url ?? null,
      attachmentMeta: attachment ? JSON.stringify(attachment.meta) : null,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setMessages((cur) => [...cur, optimistic])
    setInput('')
    const sent = attachment
    setUpload(null)
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          ...(sent ? { attachmentUrl: sent.url, attachmentMeta: sent.meta } : {}),
          ...(authedUserId ? {} : { guestSession }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Failed to send message')
        setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)))
        return
      }
      const confirmed = data.message as ChatMsg
      newestServerAtRef.current = confirmed.createdAt > (newestServerAtRef.current ?? '') ? confirmed.createdAt : newestServerAtRef.current
      setMessages((cur) => {
        const withoutTemp = cur.filter((m) => m.id !== tempId)
        const seen = new Set(withoutTemp.map((m) => m.id))
        if (!seen.has(confirmed.id)) withoutTemp.push(confirmed)
        withoutTemp.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        return withoutTemp
      })
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
    } catch {
      toast.error('Failed to send message')
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)))
    } finally {
      setSending(false)
    }
  }

  async function submitRating() {
    if (!conversation || ratingStars < 1) return
    try {
      const res = await fetch('/api/chat/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          stars: ratingStars,
          ...(authedUserId ? {} : { guestSession }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Could not submit rating')
        return
      }
      setRatedLocally(true)
      setRatingStars(0)
      toast.success('Thanks for your feedback!')
    } catch {
      toast.error('Could not submit rating')
    }
  }

  const fontPx = FONT_SIZES[fontIdx]
  const canDecrease = fontIdx > 0
  const canIncrease = fontIdx < FONT_SIZES.length - 1

  const isComplete = conversation?.status === 'complete'
  const isRevoked = conversation?.status === 'revoke'
  const canType = !!conversation && !isRevoked && !isComplete
  const showTopicPicker = !conversation || pickerOpen
  const alreadyRated = conversation?.rated || ratedLocally

  const sortedMessages = useMemo(() => messages, [messages])

  // Admins don't get the buyer widget — the admin shell renders its own.
  if (authedRole === 'ADMIN') return null

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-12 sm:bottom-14 right-5 sm:right-6 z-50 group flex items-center justify-center w-[3.6rem] h-[3.6rem] sm:w-[4.2rem] sm:h-[4.2rem] rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl ring-2 ring-emerald-600/20 transition-all hover:scale-105 hover:shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          aria-label="Open chat support"
        >
          <MessageCircle className="w-6 h-6 sm:w-7 sm:h-7" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1.4rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center animate-pulse ring-2 ring-white dark:ring-zinc-900">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-12 sm:bottom-14 right-5 sm:right-6 z-50 w-[calc(100vw-2.5rem)] sm:w-[28rem] max-w-[28rem] bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-3 zoom-in-95 duration-200"
          style={{ maxHeight: '80vh' }}
        >
          {/* Header */}
          <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageCircle className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{isComplete ? 'Conversation closed' : 'Support Chat'}</div>
                <div className="text-[10px] text-emerald-100 truncate">
                  {isComplete ? 'Start a new conversation or reopen this one' : 'We typically reply within a few hours'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-0.5 bg-emerald-500/40 rounded-md p-0.5" role="group" aria-label="Adjust font size">
                <button
                  onClick={() => bumpFont(-1)}
                  disabled={!canDecrease}
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-white hover:bg-emerald-500/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Decrease font size"
                  title="Decrease font size"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={resetFont}
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-white hover:bg-emerald-500/60 transition-colors"
                  aria-label={`Reset font size (currently ${fontPx}px)`}
                  title={`Reset font size (currently ${fontPx}px)`}
                >
                  <Type className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => bumpFont(1)}
                  disabled={!canIncrease}
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-white hover:bg-emerald-500/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Increase font size"
                  title={`Increase font size (currently ${fontPx}px)`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <button onClick={() => setOpen(false)} className="hover:bg-emerald-700 rounded-md p-1" aria-label="Close chat">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Topic picker — only when there is no active conversation, or the
              buyer explicitly started a new one (Bug 3). */}
          {showTopicPicker ? (
            <div className="flex-1 overflow-y-auto p-6 bg-zinc-50 dark:bg-zinc-950" style={{ minHeight: '320px' }}>
              {loading || !bootstrapped ? (
                <div className="text-center text-sm text-zinc-400 py-10"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
              ) : (
                <div>
                  <h3 className="font-semibold text-base text-zinc-800 dark:text-zinc-100">What do you need help with?</h3>
                  <p className="text-sm text-zinc-500 mt-1">Choose a topic to get faster support.</p>
                  <div className="mt-4 space-y-2">
                    {TOPICS.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => startWithTopic(t.value)}
                        disabled={starting}
                        className="w-full text-left px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors text-sm font-medium text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {conversation && (
                    <button
                      onClick={() => { setPickerOpen(false); setTimeout(() => inputRef.current?.focus(), 100) }}
                      className="mt-4 text-xs text-zinc-500 hover:text-emerald-600 underline"
                    >
                      Cancel — back to this conversation
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Messages */}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-zinc-50 dark:bg-zinc-950"
                style={{ minHeight: '320px', maxHeight: 'calc(80vh - 200px)' }}
              >
                {/* Page context line (Bug 4) */}
                {conversation?.context && (
                  <div className="text-center">
                    <span className="inline-block text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-full px-3 py-1">
                      Context: Order {conversation.context.shortId ? `#${conversation.context.shortId}` : ''}
                      {conversation.context.productName ? ` (${conversation.context.productName})` : ''}
                    </span>
                  </div>
                )}
                {loadingOlder && (
                  <div className="text-center"><Loader2 className="w-4 h-4 mx-auto animate-spin text-zinc-400" /></div>
                )}
                {loading && messages.length === 0 ? (
                  <div className="text-center text-sm text-zinc-400 py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-zinc-400 py-8" style={{ fontSize: `${fontPx}px` }}>
                    <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>Describe your issue and we&apos;ll get right on it.</p>
                  </div>
                ) : (
                  sortedMessages.map((msg) =>
                    msg.senderType === 'system' ? (
                      <div key={msg.id} className="text-center">
                        <span
                          className="inline-block text-zinc-500 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/60 rounded-full px-3 py-1"
                          style={{ fontSize: `${Math.max(11, fontPx - 2)}px` }}
                        >
                          {msg.body.replace(/^\[System\]\s*/i, '')}
                        </span>
                      </div>
                    ) : (
                      <div key={msg.id} className={`flex ${msg.senderType === 'admin' ? 'justify-start' : 'justify-end'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                            msg.senderType === 'admin'
                              ? 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                              : 'bg-emerald-600 text-white'
                          } ${msg.pending ? 'opacity-60' : ''} ${msg.failed ? 'ring-2 ring-red-400' : ''}`}
                          style={{ fontSize: `${fontPx}px` }}
                        >
                          {msg.senderType === 'admin' && (
                            <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mb-0.5">Support</div>
                          )}
                          {msg.body && <p className="break-words whitespace-pre-wrap">{msg.body}</p>}
                          {msg.attachmentUrl && (
                            <ChatAttachment url={msg.attachmentUrl} meta={parseMeta(msg.attachmentMeta)} tone={msg.senderType === 'admin' ? 'in' : 'out'} fontPx={fontPx} />
                          )}
                          <div
                            className={`mt-1 flex items-center gap-1 ${msg.senderType === 'admin' ? 'text-zinc-400' : 'text-emerald-100'} ${msg.senderType === 'admin' ? '' : 'justify-end'}`}
                            style={{ fontSize: `${Math.max(10, fontPx - 4)}px` }}
                          >
                            <span>
                              {msg.pending ? 'Sending…' : msg.failed ? 'Failed — tap to retry' : new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {/* Read receipts on the buyer's own messages (Bug 7) */}
                            {!msg.pending && !msg.failed && msg.senderType !== 'admin' && (
                              msg.readAt ? (
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-200" aria-label="Read" />
                              ) : msg.deliveredAt ? (
                                <CheckCheck className="w-3.5 h-3.5 opacity-60" aria-label="Delivered" />
                              ) : (
                                <Check className="w-3.5 h-3.5 opacity-60" aria-label="Sent" />
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  )
                )}

                {/* Typing dots (Bug 7) */}
                {adminTyping && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-500">
                      <span className="flex gap-0.5" aria-hidden="true">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      Support is typing…
                    </div>
                  </div>
                )}

                {/* Rating card — only if completed and not already rated (Bug 2) */}
                {isComplete && !alreadyRated && (
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">How was your support experience?</p>
                    <div className="flex items-center justify-center gap-1 mt-2" role="radiogroup" aria-label="Rate your experience">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRatingStars(n)}
                          className="p-0.5"
                          role="radio"
                          aria-checked={ratingStars === n}
                          aria-label={`${n} star${n > 1 ? 's' : ''}`}
                        >
                          <Star className={`w-6 h-6 ${n <= ratingStars ? 'text-amber-400 fill-amber-400' : 'text-zinc-300 dark:text-zinc-600'}`} />
                        </button>
                      ))}
                    </div>
                    <Button
                      onClick={submitRating}
                      disabled={ratingStars < 1}
                      size="sm"
                      className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Submit
                    </Button>
                  </div>
                )}
                {isComplete && alreadyRated && (
                  <div className="text-center text-xs text-zinc-400">Thanks for your feedback.</div>
                )}
              </div>

              {/* Input / closed actions */}
              <div className="border-t border-zinc-200 dark:border-zinc-800 p-2 sm:p-3 bg-white dark:bg-zinc-900 shrink-0">
                {isComplete || isRevoked ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={() => setPickerOpen(true)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      size="sm"
                    >
                      Start new conversation
                    </Button>
                    {isComplete && (
                      <Button onClick={reopenConversation} variant="outline" size="sm" className="w-full">
                        Reopen this one
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {upload && (
                      <div className="mb-2 px-1">
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <Paperclip className="w-3 h-3 shrink-0" />
                          <span className="truncate flex-1">{upload.name}{upload.size ? ` · ${formatBytes(upload.size)}` : ''}</span>
                          {upload.error ? (
                            <button onClick={() => uploadFile(upload.file)} className="text-emerald-600 hover:underline" aria-label="Retry upload">Retry</button>
                          ) : upload.url ? null : (
                            <span className="tabular-nums">{upload.progress}%</span>
                          )}
                          <button onClick={() => setUpload(null)} className="text-zinc-400 hover:text-red-500" aria-label="Remove attachment">✕</button>
                        </div>
                        {upload.error ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-red-500"><AlertCircle className="w-3 h-3" /> {upload.error}</p>
                        ) : (
                          <div className="mt-1 h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${upload.url ? 100 : upload.progress}%` }} />
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf,application/zip"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) uploadFile(f)
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canType || !!upload}
                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-emerald-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                        aria-label="Attach a file (JPG, PNG, WebP, PDF or ZIP, max 5MB)"
                        title="Attach a file (JPG, PNG, WebP, PDF or ZIP, max 5MB)"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <Input
                        ref={inputRef}
                        type="text"
                        placeholder="Type your message..."
                        value={input}
                        onChange={(e) => { setInput(e.target.value); notifyTyping() }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if ((input.trim() || upload?.url) && !sending) send() } }}
                        className="flex-1 text-sm min-w-0"
                        maxLength={2000}
                        disabled={!canType || !bootstrapped}
                      />
                      <Button
                        onClick={send}
                        disabled={(!input.trim() && !upload?.url) || sending || !canType || (!!upload && !upload.url)}
                        size="icon"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 h-10 w-10 sm:h-11 sm:w-11 transition-transform active:scale-90"
                        aria-label="Send message"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

