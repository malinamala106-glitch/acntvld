'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { formatMoney } from '@/lib/format'
import type { Product, LicenseKey } from '@/lib/types'
import {
  Search, Loader2, Trash2, CheckCircle2, XCircle, Clock, Download, Pencil, X, Check, ArrowLeft,
} from 'lucide-react'

type FilterMode = 'all' | 'available' | 'sold'

interface Props {
  product: Product
  mode: FilterMode
  open: boolean
  onClose: () => void
  onRefresh: () => void
}

// One Batch row as returned by GET /api/admin/products/[id]/batches.
interface BatchSummary {
  id: string
  label: string
  priceOverride: number | null
  effectivePrice: number
  availableCount: number
  soldCount: number
  holdCount: number
  totalCount: number
  createdAt: string
}

export function EntriesModal({ product, mode, open, onClose, onRefresh }: Props) {
  const [keys, setKeys] = useState<LicenseKey[]>([])
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  // Active batch filter — null = show keys from ALL batches. When set, only
  // keys belonging to that batch are shown.
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)

  const modeLabel = mode === 'all' ? 'All Entries' : mode === 'available' ? 'Stock (Unsold)' : 'Sold'
  const modeStatus = mode === 'all' ? 'all' : mode === 'available' ? 'available' : 'sold'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch keys + batch summaries in parallel.
      const [keysRes, batchesRes] = await Promise.all([
        fetch(`/api/admin/products/${product.id}/keys?status=${modeStatus}`),
        fetch(`/api/admin/products/${product.id}/batches`),
      ])
      const keysData = await keysRes.json()
      const batchesData = await batchesRes.json()
      setKeys(keysData.keys || [])
      setBatches(batchesData.batches || [])
    } catch {
      toast.error('Failed to load entries')
    } finally {
      setLoading(false)
    }
  }, [product.id, modeStatus])

  useEffect(() => {
    if (open) {
      load()
      setSelected(new Set())
      setSearch('')
      setActiveBatchId(null)
    }
  }, [open, load])

  // Group keys by batchId for display. Keys without a batch (legacy data)
  // get bucketed under a synthetic "No batch" group.
  const grouped = useMemo(() => {
    const map = new Map<string, { batch: BatchSummary | null; keys: LicenseKey[] }>()
    for (const k of keys) {
      const bid = k.batchId ?? 'no-batch'
      const batch = batches.find((b) => b.id === k.batchId) ?? null
      if (!map.has(bid)) map.set(bid, { batch, keys: [] })
      map.get(bid)!.keys.push(k)
    }
    // Sort batches newest-first; "no-batch" goes last.
    return Array.from(map.values()).sort((a, b) => {
      if (!a.batch) return 1
      if (!b.batch) return -1
      return b.batch.createdAt.localeCompare(a.batch.createdAt)
    })
  }, [keys, batches])

  // Filter by search + active batch.
  const filtered = useMemo(() => {
    let list = keys
    if (activeBatchId) {
      list = list.filter((k) => (k.batchId ?? 'no-batch') === activeBatchId)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((k) => k.key.toLowerCase().includes(q))
    }
    return list
  }, [keys, activeBatchId, search])

  function toggleSelected(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((k) => k.id)))
    }
  }

  const selectedIds = Array.from(selected)
  const hasSelection = selectedIds.length > 0

  async function bulkAction(action: 'delete' | 'status', status?: 'AVAILABLE' | 'SOLD' | 'HOLD') {
    if (!hasSelection) {
      toast.error('Select entries first')
      return
    }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/products/${product.id}/keys`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, keyIds: selectedIds, status }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.updated || data.deleted ? `${data.updated || data.deleted} entries updated` : 'Done')
        setSelected(new Set())
        await load()
        onRefresh()
      } else {
        toast.error(data?.error || 'Failed')
      }
    } catch {
      toast.error('Failed')
    } finally {
      setActionLoading(false)
    }
  }

  async function saveEdit(keyId: string) {
    if (!editValue.trim()) {
      toast.error('Credential cannot be empty')
      return
    }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/products/${product.id}/keys`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', keyId, newKey: editValue.trim() }),
      })
      if (res.ok) {
        toast.success('Credential updated')
        setEditingId(null)
        setEditValue('')
        await load()
      } else {
        toast.error('Failed to update')
      }
    } catch {
      toast.error('Failed to update')
    } finally {
      setActionLoading(false)
    }
  }

  function downloadCSV() {
    const rows = hasSelection ? filtered.filter((k) => selected.has(k.id)) : filtered
    const headers = ['Status', 'Credential', 'Batch', 'Buyer', 'Sold At']
    const lines = [headers.join(',')]
    for (const k of rows) {
      const buyer = k.order?.user?.email || k.order?.user?.name || ''
      const soldAt = k.order?.createdAt ? new Date(k.order.createdAt).toISOString() : ''
      const statusLabel = k.status === 'AVAILABLE' ? 'Unsold' : k.status === 'HOLD' ? 'Hold' : 'Sold'
      const batchLabel = k.batch?.label ?? ''
      lines.push([statusLabel, `"${k.key.replace(/"/g, '""')}"`, `"${batchLabel}"`, `"${buyer}"`, soldAt].join(','))
    }
    downloadFile(lines.join('\n'), 'csv')
  }

  function downloadTXT() {
    const rows = hasSelection ? filtered.filter((k) => selected.has(k.id)) : filtered
    const lines = rows.map((k) => {
      const buyer = k.order?.user?.email || k.order?.user?.name || ''
      const statusLabel = k.status === 'AVAILABLE' ? 'Unsold' : k.status === 'HOLD' ? 'Hold' : 'Sold'
      const batchLabel = k.batch?.label ?? ''
      return `${statusLabel} — ${k.key}${batchLabel ? ` — batch: ${batchLabel}` : ''}${buyer ? ` — bought by: ${buyer}` : ''}`
    })
    downloadFile(lines.join('\n'), 'txt')
  }

  function downloadFile(content: string, ext: 'csv' | 'txt') {
    const blob = new Blob([content], { type: ext === 'csv' ? 'text/csv' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${product.name.replace(/[^a-z0-9]+/gi, '-')}-${mode}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  function statusBadge(status: string) {
    if (status === 'SOLD') return <Badge variant="outline" className="text-[10px] border-zinc-300 text-zinc-500 bg-zinc-50 dark:bg-zinc-900">SOLD</Badge>
    if (status === 'HOLD') return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">HOLD</Badge>
    return <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">UNSOLD</Badge>
  }

  const availableActions: { label: string; icon: React.ReactNode; onClick: () => void; color: string }[] = []

  // Delete — always available (for non-sold)
  if (mode !== 'sold') {
    availableActions.push({
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => bulkAction('delete'),
      color: 'text-red-600 border-red-300 hover:bg-red-50 dark:border-red-800 dark:text-red-400',
    })
  }

  // Mark as Sold — available in "all" and "available" modes
  if (mode !== 'sold') {
    availableActions.push({
      label: 'Sold',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      onClick: () => bulkAction('status', 'SOLD'),
      color: 'text-zinc-600 border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400',
    })
  }

  // Mark as Unsold — available in "all" and "sold" modes
  if (mode !== 'available') {
    availableActions.push({
      label: 'Unsold',
      icon: <XCircle className="w-3.5 h-3.5" />,
      onClick: () => bulkAction('status', 'AVAILABLE'),
      color: 'text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400',
    })
  }

  // Hold — available in "all" and "available" modes
  if (mode !== 'sold') {
    availableActions.push({
      label: 'Hold',
      icon: <Clock className="w-3.5 h-3.5" />,
      onClick: () => bulkAction('status', 'HOLD'),
      color: 'text-amber-600 border-amber-300 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400',
    })
  }

  // Download — always available
  availableActions.push({
    label: 'CSV',
    icon: <Download className="w-3.5 h-3.5" />,
    onClick: downloadCSV,
    color: 'text-zinc-600 border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400',
  })
  availableActions.push({
    label: 'TXT',
    icon: <Download className="w-3.5 h-3.5" />,
    onClick: downloadTXT,
    color: 'text-zinc-600 border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400',
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <Toaster richColors position="top-right" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {modeLabel} · {product.name}
          </DialogTitle>
          <DialogDescription>
            {keys.length} {keys.length === 1 ? 'entry' : 'entries'} across {batches.length} {batches.length === 1 ? 'batch' : 'batches'}
            {product.deliveryFormat && <span className="ml-1">· Format: <code className="text-[10px]">{product.deliveryFormat}</code></span>}
          </DialogDescription>
        </DialogHeader>

        {/* Batch summary chips — click to filter the list to one batch. */}
        {batches.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveBatchId(null)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${activeBatchId === null ? 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            >
              All batches
            </button>
            {batches.map((b) => (
              <button
                key={b.id}
                onClick={() => setActiveBatchId(b.id)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors flex items-center gap-1.5 ${activeBatchId === b.id ? 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                title={`${b.label} · ${formatMoney(b.effectivePrice)}`}
              >
                <span className="font-medium">{b.label}</span>
                <span className="text-[10px] text-zinc-500">{formatMoney(b.effectivePrice)}</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{b.availableCount}/{b.totalCount}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search bar */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            placeholder="Search credentials..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Bulk action buttons */}
        <div className="flex flex-wrap gap-1.5">
          {availableActions.map((a, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={a.onClick}
              disabled={actionLoading || !hasSelection}
              className={`h-7 text-xs ${a.color}`}
            >
              {a.icon}
              <span className="ml-1">{a.label}</span>
            </Button>
          ))}
          {hasSelection && (
            <span className="text-xs text-zinc-500 self-center ml-1">{selectedIds.length} selected</span>
          )}
        </div>

        {/* List — grouped by batch when no batch filter is active; flat otherwise. */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {loading ? (
            <div className="text-center py-8"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-400" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500">No entries found.</div>
          ) : activeBatchId ? (
            // Single-batch view (flat list)
            <KeysList
              keys={filtered}
              mode={mode}
              selected={selected}
              editingId={editingId}
              editValue={editValue}
              onToggle={toggleSelected}
              onToggleAll={toggleAll}
              onEdit={(id, val) => { setEditingId(id); setEditValue(val) }}
              onCancelEdit={() => { setEditingId(null); setEditValue('') }}
              onSaveEdit={saveEdit}
              onEditValueChange={setEditValue}
              statusBadge={statusBadge}
              actionLoading={actionLoading}
            />
          ) : (
            // Grouped view — one section per batch
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {grouped.map(({ batch, keys: batchKeys }) => (
                <div key={batch?.id ?? 'no-batch'} className="py-2">
                  {/* Batch header */}
                  <div className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{batch?.label ?? 'No batch'}</span>
                    {batch && (
                      <span className="text-xs text-zinc-500">
                        · {formatMoney(batch.effectivePrice)}{batch.priceOverride === null ? ' (default)' : ''}
                      </span>
                    )}
                    {batch && (
                      <span className="text-[10px] text-zinc-500 ml-auto flex items-center gap-2">
                        <span className="text-emerald-600 dark:text-emerald-400">{batch.availableCount} avail</span>
                        <span className="text-zinc-500">{batch.soldCount} sold</span>
                        {batch.holdCount > 0 && <span className="text-amber-600">{batch.holdCount} hold</span>}
                      </span>
                    )}
                  </div>
                  <KeysList
                    keys={batchKeys.filter((k) => !search.trim() || k.key.toLowerCase().includes(search.toLowerCase()))}
                    mode={mode}
                    selected={selected}
                    editingId={editingId}
                    editValue={editValue}
                    onToggle={toggleSelected}
                    onToggleAll={() => {
                      const allBatch = batchKeys.filter((k) => !search.trim() || k.key.toLowerCase().includes(search.toLowerCase()))
                      const allSelected = allBatch.every((k) => selected.has(k.id))
                      const next = new Set(selected)
                      if (allSelected) {
                        allBatch.forEach((k) => next.delete(k.id))
                      } else {
                        allBatch.forEach((k) => next.add(k.id))
                      }
                      setSelected(next)
                    }}
                    onEdit={(id, val) => { setEditingId(id); setEditValue(val) }}
                    onCancelEdit={() => { setEditingId(null); setEditValue('') }}
                    onSaveEdit={saveEdit}
                    onEditValueChange={setEditValue}
                    statusBadge={statusBadge}
                    actionLoading={actionLoading}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Extracted list renderer — used both inside the grouped view (per-batch) and
// for the single-batch-filtered flat view.
function KeysList({
  keys, mode, selected, editingId, editValue, onToggle, onToggleAll, onEdit, onCancelEdit, onSaveEdit, onEditValueChange, statusBadge, actionLoading,
}: {
  keys: LicenseKey[]
  mode: 'all' | 'available' | 'sold'
  selected: Set<string>
  editingId: string | null
  editValue: string
  onToggle: (id: string) => void
  onToggleAll: () => void
  onEdit: (id: string, val: string) => void
  onCancelEdit: () => void
  onSaveEdit: (id: string) => void
  onEditValueChange: (v: string) => void
  statusBadge: (s: string) => React.ReactNode
  actionLoading: boolean
}) {
  if (keys.length === 0) {
    return <div className="text-center py-4 text-sm text-zinc-500">No entries in this batch.</div>
  }
  return (
    <div>
      {/* Header row with select-all checkbox */}
      <div className="sticky top-0 z-20 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 py-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={keys.length > 0 && keys.every((k) => selected.has(k.id))}
          onChange={onToggleAll}
          className="w-4 h-4 accent-emerald-600 shrink-0"
        />
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Status · Credential {mode === 'sold' && '· Buyer'}
        </span>
      </div>
      {/* Rows */}
      {keys.map((k) => (
        <div
          key={k.id}
          className={`flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${selected.has(k.id) ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}
        >
          <input
            type="checkbox"
            checked={selected.has(k.id)}
            onChange={() => onToggle(k.id)}
            className="w-4 h-4 accent-emerald-600 shrink-0"
          />
          {statusBadge(k.status)}
          {editingId === k.id ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Input
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                className="h-7 text-xs font-mono"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(k.id); if (e.key === 'Escape') onCancelEdit() }}
              />
              <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => onSaveEdit(k.id)} disabled={actionLoading}>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={onCancelEdit}>
                <X className="w-3.5 h-3.5 text-zinc-400" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <code className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1">{k.key}</code>
              {mode === 'sold' && k.order?.user && (
                <span className="text-[10px] text-zinc-500 shrink-0">
                  bought by: {k.order.user.name || k.order.user.email}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onEdit(k.id, k.key)}
                aria-label="Edit credential"
              >
                <Pencil className="w-3 h-3 text-zinc-400" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
