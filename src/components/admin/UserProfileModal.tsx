'use client'

import { useState, useEffect, useCallback, Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/shared/CopyButton'
import { formatMoney, formatDate, shortId } from '@/lib/format'
import { sanitizeForLog } from '@/lib/log-sanitize'
import { toast } from 'sonner'
import {
  X, Loader2, TrendingUp, Wallet, ShoppingBag, Clock,
  Lock, AlertCircle, MessageSquare, Key,
} from 'lucide-react'

// --- Error Boundary ---
class ModalErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: any) {
    // Scrub the error + component stack before logging — React's `info`
    // can include component stacks that quote rendered props, and props
    // may contain user input (e.g. the email being edited). Passing
    // through sanitizeForLog redacts known-sensitive keys and masks
    // long base64/hex-shaped strings before they reach dev.log / server.log.
    // eslint-disable-next-line no-console
    console.error('UserProfileModal crashed:', sanitizeForLog(error), sanitizeForLog(info))
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={this.props.onClose}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Something went wrong</h3>
              <button onClick={this.props.onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
            <p className="text-sm text-zinc-500 mb-2">Could not load user details.</p>
            <p className="text-xs text-zinc-400 mb-4 font-mono break-all">{this.state.error?.message || 'Unknown error'}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// --- Safe helpers ---
function safeFormatMoney(n: any): string {
  const num = typeof n === 'number' ? n : parseFloat(n)
  return isNaN(num) ? '$0.00' : formatMoney(num)
}
function safeFormatDate(d: any): string {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? new Date(d) : d
    if (isNaN(date.getTime())) return '—'
    return formatDate(date)
  } catch { return '—' }
}
function safeStr(s: any, fallback = '—'): string {
  if (s === null || s === undefined || s === '') return fallback
  return String(s)
}
function safeArr(a: any): any[] {
  return Array.isArray(a) ? a : []
}
function safeNum(n: any, fallback = 0): number {
  const num = typeof n === 'number' ? n : parseFloat(n)
  return isNaN(num) ? fallback : num
}

type Tab = 'overview' | 'orders' | 'deposits' | 'activity' | 'notes'

interface Props {
  userId: string
  currentAdminId: string
  onClose: () => void
  onRefresh: () => void
}

export function UserProfileModal({ userId, currentAdminId, onClose, onRefresh }: Props) {
  return (
    <ModalErrorBoundary onClose={onClose}>
      <UserProfileModalInner userId={userId} currentAdminId={currentAdminId} onClose={onClose} onRefresh={onRefresh} />
    </ModalErrorBoundary>
  )
}

function UserProfileModalInner({ userId, currentAdminId, onClose, onRefresh }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [savingRole, setSavingRole] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustType, setAdjustType] = useState<'credit' | 'debit'>('credit')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const isSelf = userId === currentAdminId

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`)
      if (!res.ok) throw new Error('Failed')
      const d = await res.json()
      setData(d)
      setAdminNote(d?.adminNote ?? '')
    } catch {
      toast.error('Failed to load user profile')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  async function doSaveRole(role: string) {
    setSavingRole(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (res.ok) {
        // Optimistically update the local state so the dropdown reflects the
        // new role immediately, then re-fetch to confirm with the server.
        const prettyLabel = role === 'ADMIN' ? 'Admin' : role === 'BUYER' ? 'Buyer' : role.charAt(0) + role.slice(1).toLowerCase()
        toast.success(`Role updated to ${prettyLabel}`)
        setData((prev: any) => prev?.user ? { ...prev, user: { ...prev.user, role } } : prev)
        await load()
        onRefresh()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error || 'Failed to change role')
        // Re-fetch to make sure the dropdown reverts if the server rejected it.
        await load()
      }
    } catch {
      toast.error('Failed to change role')
      await load()
    }
    finally { setSavingRole(false) }
  }

  function handleRoleChange(newRole: string) {
    if (!data?.user) return
    const currentRole = data.user.role || 'BUYER'
    if (newRole === currentRole) return
    // Save immediately — backend enforces the "last admin" guard and any
    // other validation. We surface errors as toasts.
    doSaveRole(newRole)
  }

  async function doSaveStatus(status: string) {
    if (isSelf && (status === 'BANNED' || status === 'MUTED')) {
      toast.error("You can't ban or mute yourself")
      return
    }
    setSavingStatus(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        const label = status === 'ACTIVE' ? 'Active' : status === 'MUTED' ? 'Muted' : status === 'BANNED' ? 'Banned' : 'Pending'
        toast.success(`Status updated to ${label}`)
        await load()
        onRefresh()
      } else {
        const d = await res.json()
        toast.error(d?.error || 'Failed to change status')
      }
    } catch { toast.error('Failed to change status') }
    finally { setSavingStatus(false) }
  }

  function toggleMute() {
    if (!data?.user) return
    const currentStatus = data.user.status || 'ACTIVE'
    if (currentStatus === 'MUTED') {
      doSaveStatus('ACTIVE')
    } else {
      if (!confirm(`Are you sure you want to mute ${data.user.email || 'this user'}?`)) return
      doSaveStatus('MUTED')
    }
  }

  function toggleBan() {
    if (!data?.user) return
    const currentStatus = data.user.status || 'ACTIVE'
    if (currentStatus === 'BANNED') {
      doSaveStatus('ACTIVE')
    } else {
      if (!confirm(`Are you sure you want to ban ${data.user.email || 'this user'}?`)) return
      doSaveStatus('BANNED')
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote }),
      })
      toast.success('Notes saved')
    } catch { toast.error('Failed to save notes') }
    finally { setSavingNotes(false) }
  }

  function handleDelete() {
    if (isSelf) { toast.error("You can't delete yourself"); return }
    if (!data?.user) return
    const email = data.user.email || 'this user'
    if (!confirm(`This will permanently delete ${email} and all their data. Type DELETE to confirm.`)) return
    const typed = prompt(`Type DELETE to confirm deletion of ${email}:`)
    if (typed !== 'DELETE') { toast.info('Deletion cancelled'); return }
    doDelete()
  }

  async function doDelete() {
    try {
      await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' })
      toast.success('User deleted')
      onClose()
      onRefresh()
    } catch { toast.error('Failed to delete user') }
  }

  function handleMessage() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-chat-with-user', { detail: { userId, email: data?.user?.email, name: data?.user?.name } }))
      onClose()
    }
  }

  async function submitAdjust() {
    const amt = parseFloat(adjustAmount)
    if (!amt || amt <= 0) { toast.error('Enter a positive amount'); return }
    if (!adjustReason.trim()) { toast.error('Reason required'); return }
    setAdjustSubmitting(true)
    try {
      const signed = adjustType === 'credit' ? amt : -amt
      const res = await fetch(`/api/admin/users/${userId}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: signed, reason: adjustReason.trim() }),
      })
      const result = await res.json()
      if (res.ok) {
        toast.success(`${adjustType === 'credit' ? 'Credited' : 'Debited'} ${safeFormatMoney(amt)}`)
        setAdjustOpen(false)
        setAdjustAmount(''); setAdjustReason('')
        await load()
        onRefresh()
      } else { toast.error(result?.error || 'Failed') }
    } catch { toast.error('Failed') }
    finally { setAdjustSubmitting(false) }
  }

  function statusBadge(status: string | null | undefined) {
    const s = status || 'ACTIVE'
    switch (s) {
      case 'ACTIVE': return <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">🟢 Active</Badge>
      case 'MUTED': return <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">🟡 Muted</Badge>
      case 'BANNED': return <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 bg-red-50 dark:bg-red-950/30">🔴 Banned</Badge>
      case 'PENDING': return <Badge variant="outline" className="border-zinc-300 text-zinc-500">⚪ Pending</Badge>
      default: return <Badge variant="outline">{s}</Badge>
    }
  }

  function initials(name?: string | null, email?: string) {
    const base = name || email || '?'
    return (base || '?').slice(0, 2).toUpperCase()
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      </div>
    )
  }

  if (!data || !data.user) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-8 max-w-md" onClick={e => e.stopPropagation()}>
          <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
          <p className="text-sm text-zinc-500 mb-4">User not found.</p>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  }

  const u = data.user || {}
  const orders = safeArr(data.orders)
  const deposits = safeArr(data.deposits)
  const activity = safeArr(data.activity)
  const userRole = u.role || 'BUYER'
  const userStatus = u.status || 'ACTIVE'
  const isMuted = userStatus === 'MUTED'
  const isBanned = userStatus === 'BANNED'
  const userEmail = safeStr(u.email, '—')
  const userName = safeStr(u.name, '—')
  const userBalance = safeNum(u.balance, 0)
  const orderCount = u._count?.orders ?? 0
  const depositCount = u._count?.deposits ?? 0
  const totalSpent = safeNum(u.totalSpent, 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-[1000px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
              {initials(u.name, u.email)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold truncate">{userName || (userEmail !== '—' ? userEmail.split('@')[0] : 'Unknown')}</h2>
                {statusBadge(userStatus)}
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span className="truncate">{userEmail}</span>
                {userEmail !== '—' && <CopyButton value={userEmail} label="" />}
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <code className="text-[10px] font-mono text-zinc-400">{shortId(u.id)}</code>
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Joined {safeFormatDate(u.createdAt)} · Last seen {safeFormatDate(u.updatedAt)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleMessage}>
              <MessageSquare className="w-3.5 h-3.5 mr-1" /> Message
            </Button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
              <X className="w-5 h-5 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
          {(['overview', 'orders', 'deposits', 'activity', 'notes'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${
                tab === t ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {t}
              {t === 'orders' && orders.length > 0 && <span className="ml-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 rounded-full">{orders.length}</span>}
              {t === 'deposits' && deposits.length > 0 && <span className="ml-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 rounded-full">{deposits.length}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' && (
            <div className="space-y-4">
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={<Wallet className="w-4 h-4" />} label="Balance" value={safeFormatMoney(userBalance)} actionLabel="Adjust" onAction={() => setAdjustOpen(true)} />
                <StatCard icon={<ShoppingBag className="w-4 h-4" />} label="Orders" value={String(orderCount)} actionLabel="View →" onAction={() => setTab('orders')} />
                <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Deposits" value={String(depositCount)} actionLabel="View →" onAction={() => setTab('deposits')} />
                <StatCard icon={<Clock className="w-4 h-4" />} label="Total Spent" value={safeFormatMoney(totalSpent)} actionLabel="History →" onAction={() => setTab('orders')} />
              </div>

              {/* Two-column: Role & Status + Quick Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Role & Status */}
                <Card className="rounded-2xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Role &amp; Status</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Role</Label>
                        <Select value={userRole} onValueChange={handleRoleChange}>
                          <SelectTrigger className="h-9 text-sm" disabled={savingRole || isSelf}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BUYER">Buyer</SelectItem>
                            <SelectItem value="VENDOR">Vendor</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Status</Label>
                        <Select value={userStatus} onValueChange={doSaveStatus}>
                          <SelectTrigger className="h-9 text-sm" disabled={savingStatus || isSelf}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTIVE">🟢 Active</SelectItem>
                            <SelectItem value="MUTED">🟡 Muted</SelectItem>
                            <SelectItem value="BANNED">🔴 Banned</SelectItem>
                            <SelectItem value="PENDING">⚪ Pending</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Lock className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-zinc-500">2FA: Disabled</span>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => toast.info('Reset password link sent (demo)')}>
                      <Key className="w-3 h-3 mr-1" /> Reset password
                    </Button>
                    {isSelf && <p className="text-[10px] text-amber-500">You can't change your own role or ban yourself.</p>}
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card className="rounded-2xl shadow-sm">
                  <CardContent className="p-4 space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Quick Actions</h3>
                    {/* Text-only buttons, left-aligned, no icons. 14px / 10px-16px padding / 8px radius.
                        Danger buttons (Ban, Delete) use red text. Neutral buttons use default text color. */}
                    <button
                      type="button"
                      onClick={() => setEditOpen(true)}
                      disabled={isSelf}
                      className="w-full text-left text-sm px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Edit profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustOpen(true)}
                      className="w-full text-left text-sm px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Adjust balance
                    </button>
                    <button
                      type="button"
                      onClick={toggleMute}
                      disabled={isSelf}
                      className="w-full text-left text-sm px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isMuted ? 'Unmute user' : 'Mute user'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleBan}
                      disabled={isSelf}
                      className="w-full text-left text-sm px-4 py-2.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isBanned ? 'Unban user' : 'Ban user'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isSelf}
                      className="w-full text-left text-sm px-4 py-2.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete user
                    </button>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Activity */}
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Recent Activity</h3>
                  {activity.length === 0 ? (
                    <p className="text-sm text-zinc-400 py-3 text-center">No recent activity.</p>
                  ) : (
                    <div className="space-y-2">
                      {activity.slice(0, 5).map((a: any) => (
                        <div key={a?.id || Math.random()} className="flex items-center gap-3 text-sm py-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${(a?.status) === 'SUCCESS' ? 'bg-emerald-500' : (a?.status) === 'PENDING' ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className="text-zinc-600 dark:text-zinc-400 truncate flex-1">{a?.description || a?.action || '—'}</span>
                          <span className="text-xs text-zinc-400 shrink-0">{safeFormatDate(a?.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'orders' && (
            <div>
              {orders.length === 0 ? (
                <p className="text-center py-12 text-zinc-400">No orders yet.</p>
              ) : (
                <div className="space-y-2">
                  {orders.map((o: any) => (
                    <div key={o?.id || Math.random()} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
                          <ShoppingBag className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{o?.product?.name ?? 'Unknown'}</div>
                          <div className="text-xs text-zinc-400">{safeFormatDate(o?.createdAt)} · #{o?.shortId ?? (o?.id ? o.id.slice(0, 8) : '—')} · Qty {o?.quantity ?? 0}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{safeFormatMoney(o?.totalAmount)}</div>
                        <div className="text-xs text-zinc-400">{o?.status ?? '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'deposits' && (
            <div>
              {deposits.length === 0 ? (
                <p className="text-center py-12 text-zinc-400">No deposits yet.</p>
              ) : (
                <div className="space-y-2">
                  {deposits.map((d: any) => (
                    <div key={d?.id || Math.random()} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center shrink-0">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{safeFormatMoney(d?.amount)} via {safeStr(d?.network, '—')}</div>
                          <div className="text-xs text-zinc-400">{safeFormatDate(d?.createdAt)}{d?.txHash ? ` · TX: ${String(d.txHash).slice(0, 16)}…` : ''}</div>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${d?.status === 'APPROVED' ? 'border-emerald-300 text-emerald-700' : d?.status === 'PENDING' ? 'border-amber-300 text-amber-700' : 'border-red-300 text-red-700'}`}>
                        {d?.status ?? '—'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div>
              {activity.length === 0 ? (
                <p className="text-center py-12 text-zinc-400">No activity logged.</p>
              ) : (
                <div className="space-y-2">
                  {activity.map((a: any) => (
                    <div key={a?.id || Math.random()} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${(a?.status) === 'SUCCESS' ? 'bg-emerald-500' : (a?.status) === 'PENDING' ? 'bg-amber-500' : 'bg-red-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{a?.action ?? '—'}</div>
                        <div className="text-xs text-zinc-500">{a?.description ?? ''}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{safeFormatDate(a?.createdAt)} · {a?.status ?? '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="space-y-3">
              <Label>Admin notes (visible to admins only)</Label>
              <Textarea
                rows={8}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Write notes about this user…"
                className="resize-y"
              />
              <div className="flex justify-end">
                <Button onClick={saveNotes} disabled={savingNotes} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {savingNotes ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Save notes
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Adjust Balance sub-modal */}
        {adjustOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setAdjustOpen(false)}>
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-1">Adjust balance</h3>
              <p className="text-sm text-zinc-500 mb-4">{userName || userEmail} · Current: <span className="font-bold text-emerald-600">{safeFormatMoney(userBalance)}</span></p>
              <div className="space-y-3">
                <div>
                  <Label>Amount (USD)</Label>
                  <Input type="number" min="0" step="0.01" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="50.00" autoFocus />
                </div>
                <div>
                  <Label>Type</Label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={adjustType === 'credit'} onChange={() => setAdjustType('credit')} className="accent-emerald-600" />
                      <span className="text-sm">Credit (+)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={adjustType === 'debit'} onChange={() => setAdjustType('debit')} className="accent-emerald-600" />
                      <span className="text-sm">Debit (−)</span>
                    </label>
                  </div>
                </div>
                <div>
                  <Label>Reason *</Label>
                  <Input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Refund for order #1024" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                <Button onClick={submitAdjust} disabled={adjustSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {adjustSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Profile sub-modal — name / email / password / notification */}
        {editOpen && (
          <EditProfileModal
            userId={userId}
            initialName={u.name ?? ''}
            initialEmail={u.email ?? ''}
            onClose={() => setEditOpen(false)}
            onSaved={async () => { await load(); onRefresh() }}
          />
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, actionLabel, onAction }: { icon: React.ReactNode; label: string; value: string; actionLabel: string; onAction: () => void }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <span className="text-xs text-zinc-500">{label}</span>
        </div>
        <div className="text-xl font-bold">{value}</div>
        <button onClick={onAction} className="text-xs text-emerald-600 hover:underline mt-1">{actionLabel}</button>
      </CardContent>
    </Card>
  )
}

// ===== Edit Profile sub-modal =====
// Allows an admin to edit a user's display name, email, and optionally
// set a new password. Inline validation for email format, password length,
// and password match. Optional email-notification checkbox (best-effort:
// the API records the request but actual email sending is out of scope here).
function EditProfileModal({
  userId,
  initialName,
  initialEmail,
  onClose,
  onSaved,
}: {
  userId: string
  initialName: string
  initialEmail: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notify, setNotify] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Per-field inline errors. `null` = no error visible yet.
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; confirm?: string | null; name?: string | null; general?: string | null }>({})

  // Light email format check — matches the backend rule.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  // Validates the form and updates `errors`. Returns true if everything is OK
  // to submit. The function is pure — it does not touch state beyond `errors`.
  function validate(): boolean {
    const next: typeof errors = {}

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      next.name = 'Display name is required'
    }

    const trimmedEmail = email.trim()
    if (trimmedEmail.length === 0) {
      next.email = 'Email is required'
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      next.email = 'Please enter a valid email'
    }

    if (newPassword.length > 0) {
      if (newPassword.length < 6) {
        next.password = 'Password must be at least 6 characters'
      } else if (newPassword !== confirmPassword) {
        next.confirm = "Passwords don't match"
      }
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return

    // Build the patch payload. Only include fields the admin actually typed
    // something into — leaving password blank means "keep current".
    const payload: any = {
      name: name.trim(),
      email: email.trim(),
    }
    if (newPassword.length > 0) {
      payload.newPassword = newPassword
      payload.sendNotification = notify
    } else if (notify) {
      // Even if password isn't changing, the admin may want to notify about
      // name/email changes.
      payload.sendNotification = notify
    }

    setSubmitting(true)
    setErrors({})
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success('Profile updated')
        await onSaved()
        onClose()
      } else {
        const d = await res.json().catch(() => ({}))
        const msg = d?.error || 'Failed to update profile'
        // Try to attach server-side validation messages to the right field.
        if (/email/i.test(msg)) setErrors({ email: msg })
        else if (/password/i.test(msg)) setErrors({ password: msg })
        else if (/name/i.test(msg)) setErrors({ name: msg })
        else setErrors({ general: msg })
      }
    } catch {
      setErrors({ general: 'Failed to update profile' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Edit profile · {initialEmail || initialName || 'User'}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {errors.general && (
          <div className="mb-3 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {errors.general}
          </div>
        )}

        <div className="space-y-3">
          {/* Display name */}
          <div>
            <Label htmlFor="ep-name">Display name</Label>
            <Input
              id="ep-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: null })) }}
              placeholder="Display name"
              autoFocus
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>

          {/* Email */}
          <div>
            <Label htmlFor="ep-email">Email</Label>
            <Input
              id="ep-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: null })) }}
              placeholder="user@example.com"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
          </div>

          {/* Change password divider */}
          <div className="flex items-center gap-3 pt-2 pb-1">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Change password</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          </div>

          {/* New password */}
          <div>
            <Label htmlFor="ep-pass">New password</Label>
            <Input
              id="ep-pass"
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setErrors((p) => ({ ...p, password: null, confirm: null })) }}
              placeholder="Leave blank to keep current"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
          </div>

          {/* Confirm password */}
          <div>
            <Label htmlFor="ep-confirm">Confirm password</Label>
            <Input
              id="ep-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setErrors((p) => ({ ...p, confirm: null })) }}
              placeholder="Re-enter new password"
              disabled={newPassword.length === 0}
            />
            {errors.confirm && <p className="mt-1 text-xs text-red-600">{errors.confirm}</p>}
          </div>

          {/* Notify checkbox */}
          <label className="flex items-center gap-2 cursor-pointer text-sm pt-1">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            <span>Send email notification to user</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
