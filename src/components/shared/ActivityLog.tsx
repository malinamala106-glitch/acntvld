'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { buildUserActivityView, formatSignedUsd, humanizeActionKey, parseLogMetadata } from '@/lib/activity-display'
import {
  Search, Loader2, ChevronLeft, ChevronRight, Download, Lock, Clock,
  TrendingUp, ShoppingCart, LogIn, LogOut, UserPlus, Wallet, Gavel,
  XCircle, CheckCircle2, Settings, AlertCircle, FileText, ArrowLeft,
} from 'lucide-react'

// Action type → icon mapping
function actionIcon(actionType: string): React.ReactNode {
  switch (actionType) {
    case 'LOGIN': return <LogIn className="w-3.5 h-3.5" />
    case 'LOGOUT': return <LogOut className="w-3.5 h-3.5" />
    case 'LOGIN_FAILED': return <AlertCircle className="w-3.5 h-3.5" />
    case 'REGISTER': return <UserPlus className="w-3.5 h-3.5" />
    case 'DEPOSIT': return <Wallet className="w-3.5 h-3.5" />
    case 'BID_PLACED': return <Gavel className="w-3.5 h-3.5" />
    case 'BID_CANCEL_REQUESTED': return <Clock className="w-3.5 h-3.5" />
    case 'BID_CANCEL_APPROVED': return <CheckCircle2 className="w-3.5 h-3.5" />
    case 'BID_CANCEL_REJECTED': return <XCircle className="w-3.5 h-3.5" />
    case 'BID_WON': return <TrendingUp className="w-3.5 h-3.5" />
    case 'PURCHASE': return <ShoppingCart className="w-3.5 h-3.5" />
    case 'REFUND': return <ArrowLeft className="w-3.5 h-3.5" />
    case 'PROFILE_CHANGED': return <Settings className="w-3.5 h-3.5" />
    case 'ADMIN_ACTION': return <Lock className="w-3.5 h-3.5" />
    default: return <FileText className="w-3.5 h-3.5" />
  }
}

// Status → color class mapping
function statusBadgeClass(status: string): string {
  switch (status) {
    case 'SUCCESS': return 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
    case 'PENDING': return 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30'
    case 'FAILED': return 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 bg-red-50 dark:bg-red-950/30'
    case 'CANCELLED': return 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900'
    case 'ARCHIVED': return 'border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-900'
    default: return 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'SUCCESS': return '🟢 Success'
    case 'PENDING': return '🟡 Pending'
    case 'FAILED': return '🔴 Failed'
    case 'CANCELLED': return '🔴 Cancelled'
    case 'ARCHIVED': return '📦 Archived'
    default: return status
  }
}

function actionTypeLabel(actionType: string): string {
  const labels: Record<string, string> = {
    LOGIN: 'Login',
    LOGOUT: 'Logout',
    LOGIN_FAILED: 'Failed Login',
    REGISTER: 'Register',
    DEPOSIT: 'Deposit',
    BID_PLACED: 'Bid Placed',
    BID_CANCEL_REQUESTED: 'Cancel Requested',
    BID_CANCEL_APPROVED: 'Cancel Approved',
    BID_CANCEL_REJECTED: 'Cancel Rejected',
    BID_WON: 'Bid Won',
    PURCHASE: 'Purchase',
    REFUND: 'Refund',
    PROFILE_CHANGED: 'Profile Changed',
    ADMIN_ACTION: 'Admin Action',
  }
  return labels[actionType] || actionType
}

interface ActivityLogEntry {
  id: string
  actionType: string
  description: string
  status: string
  createdAt: string

  // --- Admin audit trail only ---------------------------------------------
  // /api/admin/activity-logs sends these; /api/activity-logs deliberately does
  // not, so everything here is optional.
  userId?: string | null
  userEmail?: string | null
  userLabel?: string | null
  action?: string | null
  referenceId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: any
  isArchived?: boolean

  // --- User activity log only ---------------------------------------------
  // Already sanitized server-side (see src/lib/activity-display.ts).
  typeLabel?: string
  reason?: string | null
  amount?: number | null
  actorName?: string | null
  device?: string | null
}

interface Props {
  admin?: boolean // if true, show full audit trail with user column + full IP + CSV export
}

export function ActivityLog({ admin = false }: Props) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionType, setActionType] = useState('all')
  const [status, setStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(admin ? 50 : 20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [selectedLog, setSelectedLog] = useState<ActivityLogEntry | null>(null)
  // Audit-trail modal only: preview the entry the way the buyer sees it.
  const [viewAs, setViewAs] = useState<'admin' | 'user'>('admin')

  const apiBase = admin ? '/api/admin/activity-logs' : '/api/activity-logs'

  function openLog(log: ActivityLogEntry) {
    setViewAs('admin')
    setSelectedLog(log)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (actionType !== 'all') params.set('actionType', actionType)
      if (status !== 'all') params.set('status', status)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (admin && includeArchived) params.set('includeArchived', 'true')
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`${apiBase}?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setLogs(data.logs || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 0)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load activity logs')
    } finally {
      setLoading(false)
    }
  }, [apiBase, search, actionType, status, dateFrom, dateTo, page, pageSize, admin, includeArchived])

  useEffect(() => {
    const t = setTimeout(load, 250) // debounce search
    return () => clearTimeout(t)
  }, [load])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, actionType, status, dateFrom, dateTo, includeArchived])

  function exportCsv() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (actionType !== 'all') params.set('actionType', actionType)
    if (status !== 'all') params.set('status', status)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (includeArchived) params.set('includeArchived', 'true')
    params.set('format', 'csv')
    window.open(`${apiBase}?${params.toString()}`, '_blank')
  }

  const hasFilters = search || actionType !== 'all' || status !== 'all' || dateFrom || dateTo

  function clearFilters() {
    setSearch('')
    setActionType('all')
    setStatus('all')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-600" />
            {admin ? 'Audit Trail' : 'Activity Log'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {admin
              ? 'Complete system audit trail — all user and admin actions. Logs are immutable.'
              : 'Your recent account activity.'}
          </p>
        </div>
        {admin && (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <Input
                placeholder={admin ? 'Search by action, description, or reference ID…' : 'Search your activity…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search activity logs"
              />
            </div>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by action type">
                <SelectValue placeholder="Action type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="LOGIN">{admin ? '🔐 Login' : '🔐 Signed in'}</SelectItem>
                <SelectItem value="LOGOUT">{admin ? '🔓 Logout' : '🔓 Signed out'}</SelectItem>
                <SelectItem value="LOGIN_FAILED">{admin ? '⚠️ Failed login' : '⚠️ Failed sign-in'}</SelectItem>
                <SelectItem value="REGISTER">{admin ? '📝 Register' : '📝 Account created'}</SelectItem>
                <SelectItem value="DEPOSIT">💰 Deposit</SelectItem>
                <SelectItem value="BID_PLACED">🎯 Bid placed</SelectItem>
                <SelectItem value="BID_CANCEL_REQUESTED">⏳ Cancel requested</SelectItem>
                <SelectItem value="BID_CANCEL_APPROVED">✅ Cancel approved</SelectItem>
                <SelectItem value="BID_CANCEL_REJECTED">❌ Cancel rejected</SelectItem>
                <SelectItem value="BID_WON">🏆 Bid won</SelectItem>
                <SelectItem value="PURCHASE">🛒 Purchase</SelectItem>
                <SelectItem value="REFUND">↩️ Refund</SelectItem>
                <SelectItem value="PROFILE_CHANGED">{admin ? '⚙️ Profile changed' : '⚙️ Account updated'}</SelectItem>
                <SelectItem value="ADMIN_ACTION">{admin ? '🔒 Admin action' : '⚖️ Account adjustments'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="SUCCESS">🟢 Success</SelectItem>
                <SelectItem value="PENDING">🟡 Pending</SelectItem>
                <SelectItem value="FAILED">🔴 Failed</SelectItem>
                <SelectItem value="CANCELLED">🔴 Cancelled</SelectItem>
                {admin && <SelectItem value="ARCHIVED">📦 Archived</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Date range + archived toggle (admin only) */}
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
            <div className="flex gap-2">
              <div className="space-y-1">
                <Label htmlFor="dateFrom" className="text-[10px] uppercase text-zinc-400">From</Label>
                <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-36 h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dateTo" className="text-[10px] uppercase text-zinc-400">To</Label>
                <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-36 h-9 text-sm" />
              </div>
            </div>
            {admin && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer ml-auto">
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
                Include archived
              </label>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-9">
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{total} {total === 1 ? 'entry' : 'entries'}{hasFilters ? ' (filtered)' : ''}</span>
      </div>

      {/* Table (desktop) / Cards (mobile) */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-zinc-500">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>No activity logs found{hasFilters ? ' matching your filters' : ' yet'}.</p>
          </CardContent>
        </Card>
      ) : !admin ? (
        /*
         * User activity log.
         *
         * Self-contained rows — no detail modal (there is nothing else the
         * buyer is allowed to see) and none of the internal fields the audit
         * trail relies on: reference id, IP address, user agent, database ids,
         * old/new balance snapshots or raw action enums. The server already
         * strips them; this view simply has nowhere to put them.
         */
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {log.typeLabel || actionTypeLabel(log.actionType)}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  {log.description}
                </p>
                {log.reason && (
                  <p className="text-xs text-zinc-500 mt-1">Reason: {log.reason}</p>
                )}
                <p className="text-xs text-zinc-400 mt-1">
                  {new Date(log.createdAt).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {typeof log.amount === 'number' && log.amount !== 0 && (
                  <div
                    className={`text-sm font-semibold ${log.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                  >
                    {formatSignedUsd(log.amount)}
                  </div>
                )}
                {log.status && log.status !== 'SUCCESS' && (
                  <Badge variant="outline" className={`text-[10px] mt-1 ${statusBadgeClass(log.status)}`}>
                    {statusLabel(log.status)}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                  <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="text-left px-3 py-2 font-medium">Timestamp</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    {admin && <th className="text-left px-3 py-2 font-medium">User</th>}
                    {admin && <th className="text-left px-3 py-2 font-medium">IP Address</th>}
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {logs.map((log, i) => (
                    <tr
                      key={log.id}
                      onClick={() => openLog(log)}
                      className={`cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors ${i % 2 === 1 ? 'bg-zinc-50/50 dark:bg-zinc-900/50' : ''}`}
                    >
                      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                            {actionIcon(log.actionType)}
                          </span>
                          {actionTypeLabel(log.actionType)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 max-w-xs truncate" title={log.description}>
                        {log.description}
                      </td>
                      {admin && (
                        <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                          {log.userLabel || 'System'}
                          {log.userEmail && log.userLabel !== log.userEmail && (
                            <div className="text-[10px] text-zinc-400 truncate max-w-[120px]">{log.userEmail}</div>
                          )}
                        </td>
                      )}
                      {admin && (
                        <td className="px-3 py-2 text-xs font-mono text-zinc-500 whitespace-nowrap">
                          {log.ipAddress || '—'}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(log.status)}`}>
                          {statusLabel(log.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-zinc-400 whitespace-nowrap">
                        {log.referenceId || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {logs.map((log) => (
              <Card key={log.id} onClick={() => openLog(log)} className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-7 h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
                        {actionIcon(log.actionType)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{actionTypeLabel(log.actionType)}</div>
                        <div className="text-[10px] text-zinc-400">{new Date(log.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${statusBadgeClass(log.status)}`}>
                      {statusLabel(log.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{log.description}</p>
                  {log.referenceId && (
                    <p className="text-[10px] font-mono text-zinc-400 mt-1">Ref: {log.referenceId}</p>
                  )}
                  {admin && log.ipAddress && (
                    <p className="text-[10px] font-mono text-zinc-400 mt-0.5">IP: {log.ipAddress}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

        </>
      )}

      {/* Pagination (shared by the audit trail and the user activity log) */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedLog && (
        <Dialog open onOpenChange={(v) => { if (!v) setSelectedLog(null) }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                  {actionIcon(selectedLog.actionType)}
                </span>
                {actionTypeLabel(selectedLog.actionType)}
              </DialogTitle>
              <DialogDescription>
                {new Date(selectedLog.createdAt).toLocaleString('en-US', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </DialogDescription>
            </DialogHeader>

            {/*
             * Admin-only: toggle between the full audit record and exactly what
             * the buyer sees for this same entry. Nothing about the admin view
             * changes — this only lets support staff answer "what did they see?".
             */}
            {admin && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-zinc-500">View as</Label>
                <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5">
                  {(['admin', 'user'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewAs(mode)}
                      className={`px-2.5 py-1 text-xs rounded font-medium capitalize transition-colors ${
                        viewAs === mode
                          ? 'bg-emerald-600 text-white'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {viewAs === 'user' ? (
              <UserActivityPreview log={selectedLog} />
            ) : (
            <div className="space-y-3">
              {/* Status badge */}
              <div>
                <Label className="text-xs text-zinc-500">Status</Label>
                <div className="mt-1">
                  <Badge variant="outline" className={statusBadgeClass(selectedLog.status)}>
                    {statusLabel(selectedLog.status)}
                  </Badge>
                </div>
              </div>

              {/* Description */}
              <div>
                <Label className="text-xs text-zinc-500">Description</Label>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1 leading-relaxed">{selectedLog.description}</p>
              </div>

              {/* Reference ID */}
              {selectedLog.referenceId && (
                <div>
                  <Label className="text-xs text-zinc-500">Reference ID</Label>
                  <p className="text-sm font-mono text-zinc-700 dark:text-zinc-300 mt-1">{selectedLog.referenceId}</p>
                </div>
              )}

              {/* IP address */}
              {selectedLog.ipAddress && (
                <div>
                  <Label className="text-xs text-zinc-500">IP Address {!admin && '(masked for privacy)'}</Label>
                  <p className="text-sm font-mono text-zinc-700 dark:text-zinc-300 mt-1">{selectedLog.ipAddress}</p>
                </div>
              )}

              {/* User agent */}
              {selectedLog.userAgent && (
                <div>
                  <Label className="text-xs text-zinc-500">User Agent</Label>
                  <p className="text-xs font-mono text-zinc-500 mt-1 break-all">{selectedLog.userAgent}</p>
                </div>
              )}

              {/* User info (admin only) */}
              {admin && (
                <div>
                  <Label className="text-xs text-zinc-500">User</Label>
                  <div className="mt-1 text-sm">
                    <div className="font-medium">{selectedLog.userLabel || 'System'}</div>
                    {selectedLog.userEmail && selectedLog.userLabel !== selectedLog.userEmail && (
                      <div className="text-xs text-zinc-500">{selectedLog.userEmail}</div>
                    )}
                    {selectedLog.userId && (
                      <div className="text-[10px] font-mono text-zinc-400">ID: {selectedLog.userId}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata */}
              {selectedLog.metadata && typeof selectedLog.metadata === 'object' && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <Label className="text-xs text-zinc-500">Additional details</Label>
                  <div className="mt-1 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 space-y-1">
                    {Object.entries(selectedLog.metadata).map(([key, value]) => (
                      <div key={key} className="flex items-start justify-between gap-2 text-xs">
                        <span className="text-zinc-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300 text-right break-all">
                          {/* Internal action enums stay readable for admins too. */}
                          {key.toLowerCase() === 'action'
                            ? humanizeActionKey(String(value)) ?? String(value)
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Immutable notice */}
              <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 flex items-center gap-2 text-[11px] text-zinc-500">
                <Lock className="w-3 h-3 shrink-0" />
                <span>This log entry is immutable and cannot be modified or deleted{selectedLog.isArchived ? '. Status: archived (older than 90 days).' : '.'}</span>
              </div>
            </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Admin-only "View as user" preview for a single audit-trail entry. It reuses
// the same builder the buyer's API uses, so the preview can never drift from
// what the user actually sees.
function UserActivityPreview({ log }: { log: ActivityLogEntry }) {
  const view = buildUserActivityView({
    actionType: log.actionType,
    action: log.action,
    description: log.description,
    status: log.status,
    metadata: parseLogMetadata(log.metadata),
    userAgent: log.userAgent,
    userEmail: log.userEmail,
  })

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{view.typeLabel}</div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
              {view.description}
            </p>
            {view.reason && (
              <p className="text-xs text-zinc-500 mt-1">Reason: {view.reason}</p>
            )}
            <p className="text-xs text-zinc-400 mt-1">
              {new Date(log.createdAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {typeof view.amount === 'number' && view.amount !== 0 && (
              <div
                className={`text-sm font-semibold ${view.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
              >
                {formatSignedUsd(view.amount)}
              </div>
            )}
            {log.status && log.status !== 'SUCCESS' && (
              <Badge variant="outline" className={`text-[10px] mt-1 ${statusBadgeClass(log.status)}`}>
                {statusLabel(log.status)}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Exactly what the user sees. The audit trail below keeps the full record — reference id, IP address, device, balance snapshot and the acting admin.
      </p>
    </div>
  )
}
