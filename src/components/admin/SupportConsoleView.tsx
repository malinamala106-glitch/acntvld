'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Send, Loader2, MessageCircle, Pin, PinOff, ChevronDown, ChevronRight, Trash2, StickyNote, Zap, Check, CheckCheck } from 'lucide-react'
import { ChatAttachment } from '@/components/shared/ChatAttachment'
import { toast } from 'sonner'

// ---- Types ----
interface Conversation {
  id: string
  isGuest: boolean
  userId: string | null
  name: string
  email: string | null
  guestSessionId: string | null
  topic: string
  status: string
  assignedTo: string | null
  assignedToName: string | null
  pinnedBy: string[]
  unreadCount: number
  notesCount: number
  lastMessage: string
  lastFromAdmin: boolean
  lastMessageAt: string
  createdAt: string
  userStatus?: string | null
  guestIpMasked?: string | null
  firstMessage?: string
  contextOrderId?: string | null
  contextProductId?: string | null
}

interface Message {
  id: string
  conversationId?: string
  senderId?: string | null
  senderType: 'user' | 'admin' | 'system' | 'guest'
  body: string
  attachmentUrl?: string | null
  attachmentMeta?: string | null
  createdAt: string
  deliveredAt?: string | null
  readAt?: string | null
  pending?: boolean
}

/** Parse a stored attachmentMeta JSON string for the file card. */
function parseAttachmentMeta(raw?: string | null) {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object'
      ? { name: String(o.name ?? 'attachment'), size: Number(o.size) || 0, mime: String(o.mime ?? '') }
      : null
  } catch {
    return null
  }
}

interface Note {
  id: string
  body: string
  createdAt: string
  adminName: string
}

interface Canned {
  id: string
  shortcut: string
  body: string
}

interface Props {
  initialUserId?: string | null
  onConsumeInitial?: () => void
  onUnreadChange?: (n: number) => void
  // Open a registered user's profile modal from the console header link.
  openUserId?: string | null
  onConsumeOpenUser?: () => void
}

const TOPIC_LABELS: Record<string, string> = {
  order: 'Order-related issue',
  purchase: 'Purchase-related issue',
  deposit: 'Deposit-related issue',
  product: 'Product-related issue',
  other: 'Other issue',
}

const STATUS_META: Record<string, { label: string; dot: string; badge: string }> = {
  processing: { label: 'Processing', dot: '🟡', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  complete: { label: 'Complete', dot: '🟢', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  revoke: { label: 'Revoke', dot: '🔴', badge: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
}

const PIN_LIMIT = 5
const MESSAGE_PAGE = 100
const TYPING_WINDOW_MS = 4000

type Tab = 'all' | 'registered' | 'guest' | 'mine'
type MenuKind = null | { convoId: string; kind: 'assign' | 'topic' } | { convoId: string; kind: 'note' }

// Relative-time formatter — "2 min ago", "1 hr ago", "Yesterday", "Jan 5"
function relTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>()
  for (const m of current) if (!m.pending) byId.set(m.id, m)
  for (const m of current) if (m.pending) {
    // Keep optimistic sends until the server confirms (same id echo).
    byId.set(m.id, m)
  }
  for (const m of incoming) byId.set(m.id, m)
  return Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export function SupportConsoleView({ initialUserId, onConsumeInitial, onUnreadChange, openUserId, onConsumeOpenUser }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [noteInput, setNoteInput] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [canned, setCanned] = useState<Canned[]>([])
  const [cannedOpen, setCannedOpen] = useState(false)
  const [admins, setAdmins] = useState<{ id: string; email: string; name: string | null }[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingConvos, setLoadingConvos] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ processing: true })
  const [menu, setMenu] = useState<MenuKind>(null)
  const [pinToastShown, setPinToastShown] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const lastTypingSentRef = useRef(0)
  const [buyerTyping, setBuyerTyping] = useState(false)
  const [hasRating, setHasRating] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // --- Load conversation list (3s merge-poll) ---
  const loadConversations = useCallback(async (silent = true) => {
    if (!silent) setLoadingConvos(true)
    try {
      const params = new URLSearchParams()
      params.set('tab', tab)
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/chat/conversations?${params.toString()}`)
      const data = await res.json()
      if (data.conversations) {
        setConversations(data.conversations)
        onUnreadChange?.(data.totalUnread ?? 0)
      }
    } catch {
      // Silent — toast spam would be annoying on every poll
    } finally {
      if (!silent) setLoadingConvos(false)
    }
  }, [tab, search, onUnreadChange])

  // --- Load messages for the selected conversation ---
  const loadMessages = useCallback(async (opts?: { before?: string; silent?: boolean }) => {
    if (!selectedId) return
    const params = new URLSearchParams({ conversationId: selectedId })
    if (opts?.before) params.set('before', opts.before)
    if (!opts?.silent) setLoadingMsgs(true)
    try {
      const res = await fetch(`/api/admin/chat/messages?${params.toString()}`)
      const data = await res.json()
      if (data.messages) {
        if (opts?.before) {
          setMessages((cur) => {
            const seen = new Set(cur.map((m) => m.id))
            return [...(data.messages as Message[]).filter((m) => !seen.has(m.id)), ...cur]
          })
          setHasMore(!!data.hasMore)
        } else {
          setMessages((cur) => mergeMessages(cur, data.messages))
          setHasMore(!!data.hasMore)
          if (!opts?.silent) {
            setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50)
          }
        }
        setBuyerTyping(!!data.conversation?.userTypingAt && Date.now() - new Date(data.conversation.userTypingAt).getTime() < TYPING_WINDOW_MS)
      }
    } catch {
      // Silent
    } finally {
      if (!opts?.silent) setLoadingMsgs(false)
    }
  }, [selectedId])

  // Fetch rating existence for the selected conversation (badge only).
  useEffect(() => {
    if (!selectedId) { setHasRating(false); return }
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/chat/rating?conversationId=${encodeURIComponent(selectedId)}`)
        if (res.ok) {
          const data = await res.json()
          setHasRating(!!data?.rating)
        }
      } catch { setHasRating(false) }
    })()
  }, [selectedId, messages.length])

  // Initial load + 3s polling for conversation list.
  useEffect(() => {
    loadConversations(false)
    const t = setInterval(() => loadConversations(true), 3000)
    return () => clearInterval(t)
  }, [loadConversations])

  // Load messages when a conversation is selected; 3s poll while open.
  useEffect(() => {
    if (!selectedId) return
    setMessages([])
    setHasMore(false)
    loadMessages()
    const t = setInterval(() => loadMessages({ silent: true }), 3000)
    return () => clearInterval(t)
  }, [selectedId, loadMessages])

  // Load canned responses (for the "/" quick-reply menu). Refreshed when
  // the admin types "/" so newly added replies show up without a reload.
  const lastCannedLoadRef = useRef(0)
  const loadCanned = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastCannedLoadRef.current < 30000) return
    lastCannedLoadRef.current = now
    try {
      const res = await fetch('/api/admin/chat/canned')
      if (res.ok) {
        const data = await res.json()
        setCanned(data.items ?? [])
      }
    } catch {}
  }, [])

  useEffect(() => {
    loadCanned(true)
    ;(async () => {
      try {
        const res = await fetch('/api/admin/chat/admins')
        if (res.ok) {
          const data = await res.json()
          setAdmins(data.admins ?? [])
        }
      } catch {}
    })()
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const data = await res.json()
          setMyId(data?.user?.id ?? null)
        }
      } catch {}
    })()
  }, [loadCanned])

  // If initialUserId is provided (admin clicked Message on a user profile),
  // find that user's conversation and select it.
  useEffect(() => {
    if (initialUserId && conversations.length > 0) {
      const convo = conversations.find((c) => c.userId === initialUserId)
      if (convo) {
        setSelectedId(convo.id)
        onConsumeInitial?.()
      }
    }
  }, [initialUserId, conversations, onConsumeInitial])

  // openUserId is consumed without needing to select anything — the profile
  // modal opens from AdminApp; we just clear the handoff value.

  // Close any open row menu on outside click.
  useEffect(() => {
    if (!menu) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menu])

  // Focus the input when a conversation is opened.
  useEffect(() => {
    if (selectedId) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [selectedId])

  async function action(payload: Record<string, unknown>, successMsg?: string) {
    try {
      const res = await fetch('/api/admin/chat/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'Action failed')
        return null
      }
      if (successMsg) toast.success(successMsg)
      return data
    } catch {
      toast.error('Action failed')
      return null
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending || !selectedId) return
    setSending(true)
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: Message = {
      id: tempId,
      conversationId: selectedId,
      senderType: 'admin',
      body: text,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setMessages((cur) => [...cur, optimistic])
    setInput('')
    setCannedOpen(false)
    try {
      const data = await action({ action: 'reply', conversationId: selectedId, message: text })
      if (!data) {
        setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, pending: false } : m)))
        return
      }
      const confirmed = data.message as Message
      setMessages((cur) =>
        mergeMessages(
          cur.filter((m) => m.id !== tempId),
          [{ ...confirmed, conversationId: selectedId, senderType: 'admin' }]
        )
      )
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
      loadConversations(true)
    } finally {
      setSending(false)
    }
  }

  // "/" opens the canned-response picker.
  function onInputChange(v: string) {
    setInput(v)
    setCannedOpen(v.startsWith('/'))
    if (v.startsWith('/')) loadCanned()
    notifyTyping()
  }

  function notifyTyping() {
    if (!selectedId) return
    const now = Date.now()
    if (now - lastTypingSentRef.current < 2000) return // throttle
    lastTypingSentRef.current = now
    fetch('/api/admin/chat/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedId }),
    }).catch(() => {})
  }

  function applyCanned(c: Canned) {
    setInput(c.body)
    setCannedOpen(false)
    inputRef.current?.focus()
  }

  const visibleCanned = useMemo(() => {
    if (!cannedOpen) return []
    const q = input.slice(1).toLowerCase()
    return canned.filter((c) => c.shortcut.slice(1).toLowerCase().startsWith(q)).slice(0, 6)
  }, [cannedOpen, canned, input])

  async function togglePin(c: Conversation) {
    const data = await action({ action: 'pin', conversationId: c.id })
    if (!data) return
    if (data.pinned && !pinToastShown) {
      setPinToastShown(true)
    }
    loadConversations(true)
  }

  async function setStatus(c: Conversation, status: string) {
    const data = await action({ action: 'status', conversationId: c.id, status })
    if (!data) return
    loadConversations(true)
    if (status === 'revoke' && selectedId === c.id) {
      setSelectedId(null)
    }
  }

  async function deleteConversation(c: Conversation) {
    if (!window.confirm(`Delete the conversation with ${c.name}? This removes all messages and notes. This cannot be undone.`)) return
    const data = await action({ action: 'delete', conversationId: c.id })
    if (!data) return
    if (selectedId === c.id) setSelectedId(null)
    loadConversations(true)
  }

  async function addNote() {
    const body = noteInput.trim()
    if (!body || !selectedId) return
    const data = await action({ action: 'note', conversationId: selectedId, body }, 'Note added')
    if (!data) return
    setNoteInput('')
    setNotes((cur) => [{ id: data.note.id, body: data.note.body, createdAt: data.note.createdAt, adminName: data.note.adminEmail }, ...cur])
  }

  async function loadNotes() {
    if (!selectedId) return
    try {
      const res = await fetch(`/api/admin/chat/notes?conversationId=${encodeURIComponent(selectedId)}`)
      if (res.ok) {
        const data = await res.json()
        setNotes(data.notes ?? [])
      }
    } catch {}
  }

  async function assignTo(c: Conversation, adminId: string | null) {
    await action({ action: 'assign', conversationId: c.id, adminId }, adminId ? 'Conversation assigned' : 'Conversation unassigned')
    setMenu(null)
    loadConversations(true)
  }

  async function changeTopic(c: Conversation, topic: string) {
    await action({ action: 'topic', conversationId: c.id, topic }, 'Topic updated')
    setMenu(null)
    loadConversations(true)
  }

  // Lazy-load older messages when scrolled to the top.
  function onScroll() {
    const el = scrollRef.current
    if (!el || loadingOlder || !hasMore) return
    if (el.scrollTop < 60 && messages.length > 0) {
      setLoadingOlder(true)
      loadMessages({ before: messages[0]?.createdAt }).finally(() => setLoadingOlder(false))
    }
  }

  const selectedConvo = conversations.find((c) => c.id === selectedId)

  // ---- Grouping: PINNED first, then by status. Only PROCESSING open. ----
  const pinned = useMemo(
    () => conversations.filter((c) => myId && c.pinnedBy.includes(myId)),
    [conversations, myId]
  )
  const nonPinned = useMemo(
    () => conversations.filter((c) => !myId || !c.pinnedBy.includes(myId)),
    [conversations, myId]
  )
  const groups: { key: string; label: string; items: Conversation[]; badgeClass: string }[] = [
    { key: 'processing', label: 'PROCESSING', items: nonPinned.filter((c) => c.status === 'processing'), badgeClass: STATUS_META.processing.badge },
    { key: 'complete', label: 'COMPLETE', items: nonPinned.filter((c) => c.status === 'complete'), badgeClass: STATUS_META.complete.badge },
    { key: 'revoke', label: 'REVOKE', items: nonPinned.filter((c) => c.status === 'revoke'), badgeClass: STATUS_META.revoke.badge },
  ]

  const tabCounts = useMemo(() => ({
    all: conversations.length,
    registered: conversations.filter((c) => !c.isGuest).length,
    guest: conversations.filter((c) => c.isGuest).length,
    mine: conversations.filter((c) => c.assignedTo && myId && c.assignedTo === myId).length,
  }), [conversations, myId])

  function renderRow(c: Conversation, pinnedRow: boolean) {
    const isMine = c.assignedTo && myId && c.assignedTo === myId
    return (
      <div
        key={c.id}
        className={`group relative border-b border-zinc-100 dark:border-zinc-800 transition-colors ${
          pinnedRow ? 'bg-amber-50/70 dark:bg-amber-950/20' : c.isGuest ? 'bg-zinc-100/60 dark:bg-zinc-800/30' : ''
        } ${selectedId === c.id ? 'ring-1 ring-inset ring-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
      >
        <button onClick={() => setSelectedId(c.id)} className="w-full text-left p-3 pr-16">
          <div className="flex items-center gap-2">
            {pinnedRow && <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0 rotate-45" />}
            <span className={`font-medium text-sm truncate ${c.isGuest ? 'text-zinc-500 dark:text-zinc-400' : ''}`}>
              {c.name}
            </span>
            {c.isGuest && (
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">Guest</span>
            )}
            <span className={`ml-auto inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${STATUS_META[c.status]?.badge ?? ''}`}>
              {STATUS_META[c.status]?.dot} {STATUS_META[c.status]?.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {c.email ? (
              <span className="text-xs text-zinc-500 truncate">{c.email}</span>
            ) : (
              <span className="text-xs text-zinc-400 truncate">
                {c.guestIpMasked ? `${c.guestIpMasked} · ` : ''}Guest {c.guestSessionId ? `#${c.guestSessionId.slice(-4).toUpperCase()}` : ''}
              </span>
            )}
            <span className="ml-auto text-[10px] text-zinc-400 shrink-0">{relTime(c.lastMessageAt)}</span>
          </div>
          <div className="text-xs text-zinc-500 truncate mt-0.5">
            {c.lastFromAdmin ? 'You: ' : ''}{c.lastMessage || '—'}
          </div>
          {c.firstMessage && c.firstMessage !== c.lastMessage && (
            <div className="text-[11px] text-zinc-400 truncate mt-0.5">First: {c.firstMessage}</div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
              {TOPIC_LABELS[c.topic] ?? c.topic}
            </span>
            {isMine && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-300">Mine</span>
            )}
            {hasRatingBadge(c.id)}
          </div>
        </button>
        {/* Unread badge + row actions */}
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {c.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {c.unreadCount}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); togglePin(c) }}
            className={`p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 ${pinnedRow ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100'}`}
            aria-label={pinnedRow ? `Unpin conversation with ${c.name}` : `Pin conversation with ${c.name}`}
            title={pinnedRow ? 'Unpin' : 'Pin'}
          >
            {pinnedRow ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenu(menu?.convoId === c.id && menu.kind === 'topic' ? null : { convoId: c.id, kind: 'topic' }) }}
            className="p-1 rounded text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            aria-label={`More actions for ${c.name}`}
            title="More"
          >
            ⋯
          </button>
        </div>
        {menu?.convoId === c.id && menu.kind === 'topic' && (
          <div ref={menuRef} className="absolute right-2 top-8 z-20 w-48 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 text-sm">
            <button onClick={() => { setMenu({ convoId: c.id, kind: 'assign' }) }} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Assign…</button>
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-400">Change topic</div>
            {Object.entries(TOPIC_LABELS).map(([k, label]) => (
              <button
                key={k}
                onClick={() => changeTopic(c, k)}
                className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${c.topic === k ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`}
              >
                {c.topic === k ? '✓ ' : ''}{label}
              </button>
            ))}
            <button onClick={() => { setMenu({ convoId: c.id, kind: 'note' }); setShowNotes(true); setSelectedId(c.id); loadNotes() }} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <StickyNote className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Add note
            </button>
            <button onClick={() => deleteConversation(c)} className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
              <Trash2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Delete
            </button>
          </div>
        )}
        {menu?.convoId === c.id && menu.kind === 'assign' && (
          <div ref={menuRef} className="absolute right-2 top-8 z-20 w-48 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 text-sm">
            <button onClick={() => assignTo(c, null)} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Unassigned</button>
            {admins.map((a) => (
              <button
                key={a.id}
                onClick={() => assignTo(c, a.id)}
                className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${c.assignedTo === a.id ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`}
              >
                {c.assignedTo === a.id ? '✓ ' : ''}{a.name || a.email}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function hasRatingBadge(convoId: string) {
    if (selectedId === convoId && hasRating) {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300">★ Rated</span>
      )
    }
    return null
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Support Console</h1>
        <p className="text-sm text-zinc-500">All buyer ↔ support conversations. New messages appear within about a second.</p>
      </div>

      {/* Tabs: All / Registered / Guest / Mine */}
      <div className="flex gap-1 text-sm">
        {([
          ['all', 'All'],
          ['registered', 'Registered'],
          ['guest', 'Guest'],
          ['mine', 'Mine'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === key
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
            {tabCounts[key] > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[11px] font-bold ${tab === key ? 'bg-emerald-600 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                {tabCounts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-260px)] min-h-[520px]">
        {/* LEFT: Conversation list */}
        <div className="flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingConvos && conversations.length === 0 ? (
              <div className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-400" /></div>
            ) : conversations.length === 0 ? (
              <div className="text-center text-sm text-zinc-400 py-8 px-4">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                {search ? 'No conversations match your search.' : 'No conversations yet. When a buyer picks a topic in the chat widget, it will appear here.'}
              </div>
            ) : (
              <>
                {pinned.length > 0 && (
                  <SectionHeader
                    label={`PINNED (${pinned.length})`}
                    open={!!openSections.pinned}
                    onToggle={() => setOpenSections((s) => ({ ...s, pinned: !s.pinned }))}
                    dot="📌"
                  />
                )}
                {openSections.pinned && pinned.map((c) => renderRow(c, true))}
                {groups.map((g) => (
                  <div key={g.key}>
                    {g.items.length > 0 ? (
                      <SectionHeader
                        label={`${g.label} (${g.items.length})`}
                        open={!!openSections[g.key]}
                        onToggle={() => setOpenSections((s) => ({ ...s, [g.key]: !s[g.key] }))}
                      />
                    ) : null}
                    {openSections[g.key] && g.items.map((c) => renderRow(c, false))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Active conversation */}
        <div className="flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
              <div className="text-center">
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>Select a conversation to view messages</p>
                <p className="text-xs mt-1">Or click the Message button on any user profile.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header: identity + topic badge + status dropdown + ⋯ menu */}
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{selectedConvo?.name ?? 'Conversation'}</span>
                      {selectedConvo?.isGuest && (
                        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">Guest</span>
                      )}
                      {selectedConvo && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                          {TOPIC_LABELS[selectedConvo.topic] ?? selectedConvo.topic}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {selectedConvo ? (
                        selectedConvo.isGuest ? (
                          <>{selectedConvo.guestIpMasked ? `${selectedConvo.guestIpMasked} · ` : ''}Guest {selectedConvo.guestSessionId ? `#${selectedConvo.guestSessionId.slice(-4).toUpperCase()}` : ''}</>
                        ) : selectedConvo.userId ? (
                          <>
                            <a
                              href="#users"
                              onClick={(e) => {
                                e.preventDefault()
                                window.dispatchEvent(new CustomEvent('open-user-profile', { detail: { userId: selectedConvo.userId } }))
                              }}
                              className="text-emerald-600 hover:underline"
                            >
                              {selectedConvo.email}
                            </a>
                            {selectedConvo.userStatus === 'ACTIVE' && <span className="ml-2">· 🟢 Online</span>}
                          </>
                        ) : (
                          <>Deleted user</>
                        )
                      ) : (
                        '…'
                      )}
                      {selectedConvo?.assignedToName && <span className="ml-2 text-zinc-400">· Assigned: {selectedConvo.assignedToName}</span>}
                    </div>
                  </div>

                  {/* Status dropdown */}
                  <select
                    value={selectedConvo?.status ?? 'processing'}
                    onChange={(e) => selectedConvo && setStatus(selectedConvo, e.target.value)}
                    className={`text-xs rounded-md border px-2 py-1.5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 ${STATUS_META[selectedConvo?.status ?? 'processing']?.badge ?? ''}`}
                    aria-label="Conversation status"
                  >
                    <option value="processing">🟡 Processing</option>
                    <option value="complete">🟢 Complete</option>
                    <option value="revoke">🔴 Revoke</option>
                  </select>

                  {/* ⋯ menu */}
                  <div className="relative">
                    <button
                      onClick={() => setMenu(menu?.convoId === selectedId && menu.kind === 'topic' ? null : { convoId: selectedId, kind: 'topic' })}
                      className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      aria-label="More actions"
                      title="More actions"
                    >
                      ⋯
                    </button>
                    {menu?.convoId === selectedId && menu.kind === 'topic' && (
                      <div ref={menuRef} className="absolute right-0 top-8 z-20 w-48 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 text-sm">
                        <button onClick={() => setMenu({ convoId: selectedId, kind: 'assign' })} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Assign…</button>
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-400">Change topic</div>
                        {Object.entries(TOPIC_LABELS).map(([k, label]) => (
                          <button
                            key={k}
                            onClick={() => selectedConvo && changeTopic(selectedConvo, k)}
                            className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selectedConvo?.topic === k ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`}
                          >
                            {selectedConvo?.topic === k ? '✓ ' : ''}{label}
                          </button>
                        ))}
                        <button onClick={() => { setMenu(null); setShowNotes(true); loadNotes() }} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                          <StickyNote className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Add note
                        </button>
                        <button
                          onClick={() => selectedConvo && deleteConversation(selectedConvo)}
                          className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Delete
                        </button>
                      </div>
                    )}
                    {menu?.convoId === selectedId && menu.kind === 'assign' && (
                      <div ref={menuRef} className="absolute right-0 top-8 z-20 w-48 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 text-sm">
                        <button onClick={() => assignTo(selectedConvo!, null)} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Unassigned</button>
                        {admins.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => assignTo(selectedConvo!, a.id)}
                            className={`w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selectedConvo?.assignedTo === a.id ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`}
                          >
                            {selectedConvo?.assignedTo === a.id ? '✓ ' : ''}{a.name || a.email}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 bg-zinc-50 dark:bg-zinc-950"
              >
                {loadingOlder && <div className="text-center"><Loader2 className="w-4 h-4 mx-auto animate-spin text-zinc-400" /></div>}
                {selectedConvo && (selectedConvo.contextOrderId || selectedConvo.contextProductId) && (
                  <div className="text-center">
                    <span className="inline-block text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-full px-3 py-1">
                      Context: {selectedConvo.contextOrderId ? `Order ${selectedConvo.contextOrderId}` : ''}{selectedConvo.contextProductId ? ` Product ${selectedConvo.contextProductId}` : ''}
                    </span>
                  </div>
                )}
                {loadingMsgs && messages.length === 0 ? (
                  <div className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-400" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-zinc-400 py-8">
                    No messages yet. Send the first reply below.
                  </div>
                ) : (
                  messages.map((m) =>
                    m.senderType === 'system' ? (
                      <div key={m.id} className="text-center">
                        <span className="inline-block text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/60 rounded-full px-3 py-1">
                          {m.body.replace(/^\[System\]\s*/i, '')}
                        </span>
                      </div>
                    ) : (
                      <div key={m.id} className={`flex ${m.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                            m.senderType === 'admin'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                          } ${m.pending ? 'opacity-60' : ''}`}
                        >
                          <div className={`text-[10px] font-semibold mb-0.5 ${m.senderType === 'admin' ? 'text-emerald-100' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {m.senderType === 'admin' ? 'Admin' : selectedConvo?.isGuest ? 'Guest' : (selectedConvo?.name ?? 'User')}
                          </div>
                          {m.body && <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>}
                          {m.attachmentUrl && (
                            <ChatAttachment url={m.attachmentUrl} meta={parseAttachmentMeta(m.attachmentMeta)} tone={m.senderType === 'admin' ? 'out' : 'in'} fontPx={13} />
                          )}
                          <div className={`text-[10px] mt-1 flex items-center gap-1 ${m.senderType === 'admin' ? 'text-emerald-100 justify-end' : 'text-zinc-400'}`}>
                            <span>{m.pending ? 'Sending…' : timeShort(m.createdAt)}</span>
                            {m.senderType === 'admin' && !m.pending && (
                              m.readAt ? <CheckCheck className="w-3 h-3" aria-label="Read" />
                              : m.deliveredAt ? <CheckCheck className="w-3 h-3 opacity-60" aria-label="Delivered" />
                              : <Check className="w-3 h-3 opacity-60" aria-label="Sent" />
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  )
                )}
                {buyerTyping && (
                  <div className="text-xs text-zinc-400 italic pl-1">{selectedConvo?.isGuest ? 'Guest' : selectedConvo?.name} is typing…</div>
                )}
              </div>

              {/* Internal notes drawer */}
              {showNotes && (
                <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 shrink-0 max-h-56 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Internal notes (admins only)</div>
                    <button onClick={() => setShowNotes(false)} className="text-xs text-zinc-400 hover:text-zinc-600" aria-label="Hide notes">Hide</button>
                  </div>
                  {notes.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {notes.map((n) => (
                        <div key={n.id} className="text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1.5">
                          <span className="text-zinc-400">{new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {n.adminName}</span>
                          <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote() } }}
                      placeholder="Add a private note…"
                      className="h-8 text-xs"
                      maxLength={2000}
                    />
                    <Button size="sm" onClick={addNote} disabled={!noteInput.trim()} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">Add</Button>
                  </div>
                </div>
              )}

              {/* Input with canned-response "/" picker */}
              <div className="border-t border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-900 shrink-0 relative">
                {cannedOpen && visibleCanned.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
                    {visibleCanned.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => applyCanned(c)}
                        className="w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{c.shortcut}</span>
                        <span className="text-xs text-zinc-500 ml-2 truncate inline-block max-w-[70%] align-bottom">{c.body}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    type="text"
                    placeholder="Type a message… (/ for canned replies)"
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (cannedOpen && visibleCanned.length > 0 && e.key === 'Tab') {
                        e.preventDefault()
                        applyCanned(visibleCanned[0])
                        return
                      }
                      if (e.key === 'Escape') setCannedOpen(false)
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim() && !sending) send() }
                    }}
                    className="flex-1 text-sm"
                    maxLength={2000}
                  />
                  <Button
                    onClick={send}
                    disabled={!input.trim() || sending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                    aria-label="Send message"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span className="ml-1 hidden sm:inline">Send</span>
                  </Button>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-400">
                  <button onClick={() => { setShowNotes((s) => !s); if (!showNotes) loadNotes() }} className="inline-flex items-center gap-1 hover:text-zinc-600">
                    <StickyNote className="w-3 h-3" /> Notes{selectedConvo?.notesCount ? ` (${selectedConvo.notesCount})` : ''}
                  </button>
                  <button onClick={() => setCannedOpen((s) => !s)} className="inline-flex items-center gap-1 hover:text-zinc-600" aria-label="Show canned replies">
                    <Zap className="w-3 h-3" /> / Canned replies
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, open, onToggle, dot }: { label: string; open: boolean; onToggle: () => void; dot?: string }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 bg-zinc-50 dark:bg-zinc-950 sticky top-0 z-10"
      aria-expanded={open}
    >
      {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      {dot && <span>{dot}</span>}
      {label}
    </button>
  )
}
