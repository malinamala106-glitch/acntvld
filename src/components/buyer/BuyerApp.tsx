'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { api } from '@/lib/api'
import type { User, Product, Order, Deposit, CryptoWallet, PublicSettings, Bid } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { ActivityLog } from '@/components/shared/ActivityLog'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { CopyButton } from '@/components/shared/CopyButton'
import { formatMoney, formatDate, shortId, statusBadgeClass } from '@/lib/format'
import { toast } from 'sonner'
import {
  Wallet, ShoppingCart, Package, History, LogOut, Search, Loader2, Plus, Key,
  CheckCircle2, XCircle, Clock, LayoutDashboard, Download, FileText, FileSpreadsheet,
  TrendingUp, ArrowDownCircle, Gavel, Activity as ActivityIcon,
} from 'lucide-react'

interface Props {
  user: User
  onUserChange: (u: User) => void
  onLogout: () => void
}

type View = 'dashboard' | 'marketplace' | 'orders' | 'deposits' | 'bids' | 'activity'

const VALID_VIEWS: View[] = ['dashboard', 'marketplace', 'orders', 'deposits', 'bids', 'activity']

// Read the current view from the URL hash (e.g. #marketplace) so it survives page reload.
// Falls back to 'marketplace' if no valid hash is present.
function getInitialView(): View {
  if (typeof window === 'undefined') return 'marketplace'
  const hash = window.location.hash.replace('#', '') as View
  return VALID_VIEWS.includes(hash) ? hash : 'marketplace'
}

export function BuyerApp({ user, onUserChange, onLogout }: Props) {
  const [view, setViewRaw] = useState<View>(getInitialView)

  // Wrapper that also updates the URL hash so the view survives page reload.
  const setView = useCallback((v: View) => {
    setViewRaw(v)
    if (typeof window !== 'undefined') {
      window.location.hash = v
    }
  }, [])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [bids, setBids] = useState<Bid[]>([])
  const [wallets, setWallets] = useState<CryptoWallet[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [prods, ords, deps, wlts, st] = await Promise.all([
        api.listProducts(false),
        api.listOrders(false),
        api.listDeposits(false),
        api.listWallets(false),
        api.getSettings(),
      ])
      setProducts(prods)
      setOrders(ords)
      setDeposits(deps)
      setWallets(wlts)
      setSettings(st)

      // Fetch user's bids (for the "Your Bids" view)
      try {
        const bidsRes = await fetch('/api/bids')
        const bidsData = await bidsRes.json()
        if (bidsData.bids) setBids(bidsData.bids)
      } catch {}

      const me = await api.me()
      if (me) onUserChange(me)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [onUserChange])

  useEffect(() => {
    refresh()
  }, [refresh])

  const categories = Array.from(new Set(products.map((p) => p.category)))
  const filtered = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCat = category === 'all' || p.category === category
    return matchSearch && matchCat
  })

  async function handlePurchase(p: Product, qty = 1) {
    // Navigate to the standalone checkout page (with quantity + coupon + confirmation)
    window.location.href = `/checkout-page?id=${p.id}`
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            <span className="font-bold hidden sm:inline">{settings?.siteName ?? 'DigitalVault'}</span>
          </div>
          <nav className="flex-1 flex items-center gap-1" aria-label="Main">
            <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" />
            <NavButton active={view === 'marketplace'} onClick={() => setView('marketplace')} icon={<Package className="w-4 h-4" />} label="Marketplace" />
            <NavButton active={view === 'orders'} onClick={() => setView('orders')} icon={<History className="w-4 h-4" />} label="My Purchases" badge={orders.length || undefined} />
            <NavButton active={view === 'bids'} onClick={() => setView('bids')} icon={<Gavel className="w-4 h-4" />} label="Your Bids" badge={bids.filter(b => b.cancelStatus === 'PENDING').length || undefined} />
            <NavButton active={view === 'deposits'} onClick={() => setView('deposits')} icon={<Wallet className="w-4 h-4" />} label="Deposits" badge={deposits.filter(d => d.status === 'PENDING').length || undefined} />
            <NavButton active={view === 'activity'} onClick={() => setView('activity')} icon={<ActivityIcon className="w-4 h-4" />} label="Activity" />
          </nav>
          <div className="flex items-center gap-3">
            <TelegramButton />
            <div className="text-right hidden sm:block">
              <div className="text-xs text-zinc-500">Balance</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(user.balance)}</div>
            </div>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => window.location.href = '/deposit'}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Deposit</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-zinc-500" aria-label="Logout">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Logout</span>
            </Button>
          </div>
        </div>
        <div className="sm:hidden border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm flex items-center justify-between">
          <span className="text-zinc-500">Balance</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(user.balance)}</span>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={settings?.content} activeHref="/" />
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 lg:py-8">
        {view === 'dashboard' && (
          <BuyerDashboard user={user} orders={orders} deposits={deposits} loading={loading} />
        )}

        {view === 'marketplace' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">Marketplace</h1>
                <p className="text-sm text-zinc-500">Browse digital assets and purchase instantly with your balance.</p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                  <Input
                    placeholder="Search products..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 w-full sm:w-64"
                    aria-label="Search products"
                  />
                </div>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-40" aria-label="Filter by category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loading && products.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="h-64 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center text-zinc-500">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
                  <p>No products match your search.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    balance={user.balance}
                    onBuy={() => handlePurchase(p, 1)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'orders' && (
          <OrdersView orders={orders} loading={loading} />
        )}

        {view === 'deposits' && (
          <DepositsView deposits={deposits} loading={loading} />
        )}

        {view === 'bids' && (
          <BidsView bids={bids} loading={loading} onRefresh={refresh} />
        )}

        {view === 'activity' && (
          <ActivityLog />
        )}
      </main>

      <SiteFooter siteName={settings?.siteName ?? 'DigitalVault'} userEmail={user.email} content={settings?.content} />
    </div>
  )
}

// ----- Your Bids view -----
// Shows all bids placed by the current user, with cancel option + status tracking.
// Statuses: Active (cancelStatus NONE/REJECTED), Pending cancellation (PENDING), Cancelled (APPROVED)
function BidsView({ bids, loading, onRefresh }: { bids: Bid[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function requestCancel(bidId: string) {
    setCancellingId(bidId)
    try {
      const res = await fetch(`/api/bids/${bidId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success('Cancellation request submitted. Admin will review it. Your locked funds will be refunded once approved.')
        await onRefresh()
      } else {
        toast.error(data?.error || 'Failed to request cancellation')
      }
    } catch {
      toast.error('Failed to request cancellation')
    } finally {
      setCancellingId(null)
    }
  }

  if (loading && bids.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Your Bids</h1>
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-zinc-400" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (bids.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Your Bids</h1>
        <Card>
          <CardContent className="py-16 text-center text-zinc-500">
            <Gavel className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>You haven't placed any bids yet.</p>
            <a href="/special-deal" className="inline-block mt-3 text-sm font-medium text-emerald-600 hover:underline">
              Browse special deals →
            </a>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Stats
  const activeBids = bids.filter(b => b.cancelStatus === 'NONE' || b.cancelStatus === 'REJECTED')
  const pendingCancel = bids.filter(b => b.cancelStatus === 'PENDING')
  const cancelled = bids.filter(b => b.cancelStatus === 'APPROVED')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your Bids</h1>
        <p className="text-sm text-zinc-500">Track the status of bids you've placed on special deals.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-zinc-500 flex items-center gap-1"><Gavel className="w-3 h-3" /> Active</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{activeBids.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Pending cancel</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingCancel.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-zinc-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Cancelled</div>
            <div className="text-2xl font-bold text-zinc-500">{cancelled.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Bid cards */}
      <div className="space-y-3">
        {bids.map((bid) => {
          const auction = (bid as any).auction
          const isImageUrl = auction?.image && (auction.image.startsWith('/') || auction.image.startsWith('http'))
          const isHighest = auction?.currentBidderId && (bid as any).userId && auction.currentBidderId === (bid as any).userId
          const canCancel = bid.cancelStatus === 'NONE' || bid.cancelStatus === 'REJECTED'
          const isPendingCancel = bid.cancelStatus === 'PENDING'
          const isCancelled = bid.cancelStatus === 'APPROVED'

          return (
            <Card key={bid.id} className={isCancelled ? 'opacity-70' : ''}>
              <CardContent className="p-4 flex items-center gap-4">
                {/* Auction thumbnail */}
                <a href={auction?.slug ? `/special-deal/${auction.slug}` : '/special-deal'} className="shrink-0">
                  <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-2xl overflow-hidden">
                    {isImageUrl ? (
                      <Image
                        src={auction.image}
                        alt=""
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                        unoptimized={auction.image.startsWith('http')}
                      />
                    ) : (
                      auction?.image || '🏆'
                    )}
                  </div>
                </a>

                {/* Bid details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <a href={auction?.slug ? `/special-deal/${auction.slug}` : '/special-deal'} className="font-medium text-sm hover:text-emerald-600 truncate block">
                        {auction?.title || 'Auction'}
                      </a>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        Bid: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatMoney(bid.amount)}</span>
                        {isHighest && !isCancelled && (
                          <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">★ Highest</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">Placed on {new Date(bid.createdAt).toLocaleString()}</div>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0">
                      {bid.cancelStatus === 'NONE' && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 text-[10px]">Active</Badge>
                      )}
                      {bid.cancelStatus === 'PENDING' && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 text-[10px]">Cancel pending</Badge>
                      )}
                      {bid.cancelStatus === 'APPROVED' && (
                        <Badge variant="outline" className="border-zinc-300 text-zinc-500 text-[10px]">Cancelled</Badge>
                      )}
                      {bid.cancelStatus === 'REJECTED' && (
                        <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 text-[10px]">Cancel rejected</Badge>
                      )}
                    </div>
                  </div>

                  {/* Cancel button (only if active, not pending) */}
                  {canCancel && (
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requestCancel(bid.id)}
                        disabled={cancellingId === bid.id}
                        className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                      >
                        {cancellingId === bid.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                        Request cancel
                      </Button>
                    </div>
                  )}
                  {isPendingCancel && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                      Waiting for admin to approve your cancellation request. Funds still locked.
                    </p>
                  )}
                  {bid.cancelStatus === 'REJECTED' && bid.cancelAdminNote && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">
                      Admin note: {bid.cancelAdminNote}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function NavButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge ? (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold" aria-label={`${badge} pending`}>
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function ProductCard({ product, balance, onBuy }: { product: Product; balance: number; onBuy: () => void }) {
  const [buying, setBuying] = useState(false)
  const outOfStock = product.stock === 0
  const canAfford = balance >= product.price

  async function handleBuy() {
    setBuying(true)
    try {
      onBuy()
    } finally {
      setBuying(false)
    }
  }

  return (
    <Card className="flex flex-col overflow-hidden hover:shadow-md transition-shadow border-zinc-200 dark:border-zinc-800">
      <a href={`/product-details-page?id=${product.id}`} className="aspect-video bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-5xl hover:opacity-95 transition-opacity" aria-label={`View details for ${product.name}`}>
        {product.image || '📦'}
      </a>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a href={`/product-details-page?id=${product.id}`} className="hover:text-emerald-600 transition-colors block">
              <CardTitle className="text-base">{product.name}</CardTitle>
            </a>
            <CardDescription className="text-xs mt-1">
              {(() => {
                const parts: string[] = [product.category]
                try {
                  const fields = product.metadata ? JSON.parse(product.metadata) : []
                  if (Array.isArray(fields)) {
                    for (const f of fields) {
                      if (f && f.name && f.value && f.value.trim()) {
                        parts.push(f.value.trim())
                      }
                    }
                  }
                } catch {}
                return parts.join(' · ')
              })()}
            </CardDescription>
          </div>
          <Badge variant="outline" className={outOfStock ? 'border-zinc-300 text-zinc-500' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'}>
            {outOfStock ? 'Sold out' : `${product.stock} in stock`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3 min-h-[3.5rem]">
          {product.description || 'No description provided.'}
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between pt-0 border-t border-zinc-100 dark:border-zinc-800 pt-3 mt-1 gap-2">
        <div className="min-w-0">
          <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(product.price)}</div>
          <div className="text-xs text-zinc-500 hidden sm:block">per unit</div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button asChild variant="outline" size="sm">
            <a href={`/product-details-page?id=${product.id}`} aria-label={`View details for ${product.name}`}>Details</a>
          </Button>
          <Button
            onClick={handleBuy}
            disabled={outOfStock || buying}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            <span className="ml-1 hidden sm:inline">Buy</span>
          </Button>
        </div>
      </CardFooter>
      {!canAfford && !outOfStock && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-amber-600 dark:text-amber-400">Insufficient balance — please deposit.</p>
        </div>
      )}
    </Card>
  )
}

// ----- Network-first Deposit Dialog -----
function DepositDialog({ wallets, minDeposit, onSubmitted }: { wallets: CryptoWallet[]; minDeposit: number; onSubmitted: () => void }) {
  const [open, setOpen] = useState(false)
  const [network, setNetwork] = useState<string>('')
  const [walletId, setWalletId] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [txHash, setTxHash] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Available networks (distinct, from active wallets)
  const networks = Array.from(new Set(wallets.filter((w) => w.isActive).map((w) => w.network))).sort()
  // Wallets filtered by selected network
  const networkWallets = wallets.filter((w) => w.isActive && w.network === network)
  const selectedWallet = wallets.find((w) => w.id === walletId) ?? networkWallets[0]

  function reset() {
    setNetwork('')
    setWalletId('')
    setAmount('')
    setTxHash('')
    setNote('')
  }

  async function submit() {
    if (!network) {
      toast.error('Please select a network')
      return
    }
    if (!selectedWallet) {
      toast.error('No active wallet available for this network')
      return
    }
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (amt < minDeposit) {
      toast.error(`Minimum deposit is ${minDeposit.toFixed(2)} USD`)
      return
    }
    setSubmitting(true)
    try {
      await api.createDeposit({
        walletId: selectedWallet.id,
        network: selectedWallet.network,
        amount: amt,
        txHash: txHash.trim() || undefined,
        note: note.trim() || undefined,
      })
      toast.success('Deposit request submitted. Admin will review shortly.')
      reset()
      setOpen(false)
      onSubmitted()
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit deposit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline ml-1">Deposit</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit via crypto</DialogTitle>
          <DialogDescription>
            Select a network, send funds to the matching wallet, then submit. All deposits are manually reviewed by the admin — your balance will be credited after approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Step 1: Select network */}
          <div className="space-y-2">
            <Label htmlFor="network">1. Select network</Label>
            <Select value={network} onValueChange={(v) => { setNetwork(v); setWalletId('') }}>
              <SelectTrigger id="network">
                <SelectValue placeholder="Choose a network" />
              </SelectTrigger>
              <SelectContent>
                {networks.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">No wallets configured yet.</div>
                ) : (
                  networks.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Step 2: Wallet address auto-appears */}
          {network && networkWallets.length > 0 && (
            <div className="space-y-2">
              <Label>2. Send to this wallet address</Label>
              {networkWallets.length > 1 ? (
                <Select value={selectedWallet?.id ?? ''} onValueChange={setWalletId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {networkWallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.label ? `${w.label} · ${w.address.slice(0, 12)}…` : w.address.slice(0, 20) + '…'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {selectedWallet && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Send <span className="font-mono">{selectedWallet.network}</span> to:
                  </div>
                  <div className="flex items-center justify-between gap-2 bg-white dark:bg-zinc-900 rounded-md p-2">
                    <code className="text-xs break-all">{selectedWallet.address}</code>
                    <CopyButton value={selectedWallet.address} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">3. Amount (USD) {minDeposit > 0 && <span className="text-xs text-zinc-500">· min {minDeposit.toFixed(2)}</span>}</Label>
            <Input
              id="amount"
              type="number"
              min={minDeposit}
              step="0.01"
              placeholder={`e.g. ${Math.max(minDeposit, 50)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txHash">4. Transaction ID / hash (recommended)</Label>
            <Input
              id="txHash"
              placeholder="0x... or tx hash"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              placeholder="Any message for the admin"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !network || !selectedWallet} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Submit deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----- Buyer Dashboard view -----
function BuyerDashboard({ user, orders, deposits, loading }: { user: User; orders: Order[]; deposits: Deposit[]; loading: boolean }) {
  const totalSpent = orders.reduce((s, o) => s + o.totalAmount, 0)
  const totalDeposited = deposits
    .filter((d) => d.status === 'APPROVED' && d.type !== 'ADMIN_DEBIT')
    .reduce((s, d) => s + (d.type === 'ADMIN_CREDIT' ? 0 : d.amount), 0)
  const totalKeys = orders.reduce((s, o) => s + (o.keys?.length ?? 0), 0)
  const recent = orders.slice(0, 3)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user.name || user.email.split('@')[0]}</h1>
        <p className="text-sm text-zinc-500">Here&apos;s a summary of your account activity.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashStat icon={<Wallet className="w-5 h-5" />} label="Current balance" value={formatMoney(user.balance)} accent="emerald" />
        <DashStat icon={<ShoppingCart className="w-5 h-5" />} label="Orders" value={String(orders.length)} accent="zinc" />
        <DashStat icon={<Key className="w-5 h-5" />} label="License keys" value={String(totalKeys)} accent="zinc" />
        <DashStat icon={<TrendingUp className="w-5 h-5" />} label="Total spent" value={formatMoney(totalSpent)} accent="zinc" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && orders.length === 0 ? (
            <div className="text-center py-6"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
          ) : recent.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">No orders yet. Browse the marketplace to buy your first product.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl" aria-hidden="true">{o.product?.image || '📦'}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{o.product?.name ?? 'Unknown'}</div>
                      <div className="text-xs text-zinc-500">{formatDate(o.createdAt)} · {o.keys?.length ?? 0} key{(o.keys?.length ?? 0) !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div className="font-bold text-sm">{formatMoney(o.totalAmount)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DashStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: 'emerald' | 'zinc' }) {
  const accentClass = accent === 'emerald'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${accentClass}`} aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-zinc-500 truncate">{label}</div>
          <div className="text-lg font-bold truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ----- Orders view with downloads -----
function OrdersView({ orders, loading }: { orders: Order[]; loading: boolean }) {
  if (loading && orders.length === 0) {
    return <div className="text-center py-12 text-zinc-500"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
  }
  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-zinc-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>No purchases yet. Browse the marketplace to buy your first product.</p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">My Purchases</h1>
          <p className="text-sm text-zinc-500">All your completed orders and license keys. Download in CSV/TXT or copy.</p>
        </div>
        {orders.length > 0 && (
          <DownloadAllButton orders={orders} />
        )}
      </div>
      <div className="space-y-3">
        {orders.map((o) => (
          <Card key={o.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-md bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-2xl" aria-hidden="true">
                    {o.product?.image || '📦'}
                  </div>
                  <div>
                    <CardTitle className="text-base">{o.product?.name || 'Unknown product'}{o.batch?.label ? <span className="ml-2 text-xs text-zinc-500 font-normal font-mono">(batch {o.batch.label})</span> : null}</CardTitle>
                    <CardDescription className="text-xs">
                      Order #{shortId(o.id)} · {formatDate(o.createdAt)} · Qty {o.quantity}
                    </CardDescription>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{formatMoney(o.totalAmount)}</div>
                  <Badge variant="outline" className={statusBadgeClass(o.status)}>{o.status}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-medium flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800">
                  <span className="flex items-center gap-2"><Key className="w-3 h-3" aria-hidden="true" /> License keys ({o.keys?.length ?? 0})</span>
                  {o.keys && o.keys.length > 0 && (
                    <div className="flex items-center gap-1">
                      <CopyAllButton keys={o.keys.map((k) => k.key)} />
                      <DownloadCsvButton order={o} />
                      <DownloadTxtButton order={o} />
                    </div>
                  )}
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {o.keys?.length ? o.keys.map((k, idx) => (
                    <div key={k.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-zinc-500 w-6">{idx + 1}.</span>
                        <code className="text-xs font-mono break-all">{k.key}</code>
                      </div>
                      <CopyButton value={k.key} label="" />
                    </div>
                  )) : (
                    <div className="px-3 py-3 text-sm text-zinc-500">No keys delivered.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ----- Download / copy helpers -----
function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function orderToCsv(o: Order): string {
  const header = 'Order ID,Product,Quantity,Unit Price,Total,Date,Key\n'
  const rows = (o.keys ?? []).map((k, i) => {
    const cells = [
      o.id,
      o.product?.name ?? 'Unknown',
      String(o.quantity),
      o.unitPrice.toFixed(2),
      o.totalAmount.toFixed(2),
      new Date(o.createdAt).toISOString(),
      k.key,
    ]
    return cells.map((c) => {
      // Quote and escape
      const s = String(c)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }).join(',')
  })
  return header + rows.join('\n')
}

function orderToTxt(o: Order): string {
  const lines: string[] = []
  lines.push(`Order #${o.id}`)
  lines.push(`Product: ${o.product?.name ?? 'Unknown'}`)
  lines.push(`Quantity: ${o.quantity}`)
  lines.push(`Unit Price: $${o.unitPrice.toFixed(2)}`)
  lines.push(`Total: $${o.totalAmount.toFixed(2)}`)
  lines.push(`Date: ${new Date(o.createdAt).toISOString()}`)
  lines.push('')
  lines.push('License Keys:')
  ;(o.keys ?? []).forEach((k, i) => {
    lines.push(`${i + 1}. ${k.key}`)
  })
  return lines.join('\n')
}

function DownloadCsvButton({ order }: { order: Order }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => {
        downloadFile(`order-${shortId(order.id)}.csv`, orderToCsv(order), 'text/csv;charset=utf-8')
        toast.success('CSV downloaded')
      }}
      aria-label="Download keys as CSV"
    >
      <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> CSV
    </Button>
  )
}

function DownloadTxtButton({ order }: { order: Order }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => {
        downloadFile(`order-${shortId(order.id)}.txt`, orderToTxt(order), 'text/plain;charset=utf-8')
        toast.success('TXT downloaded')
      }}
      aria-label="Download keys as TXT"
    >
      <FileText className="w-3.5 h-3.5 mr-1" /> TXT
    </Button>
  )
}

function CopyAllButton({ keys }: { keys: string[] }) {
  const [copied, setCopied] = useState(false)
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(keys.join('\n'))
      setCopied(true)
      toast.success(`${keys.length} key${keys.length > 1 ? 's' : ''} copied to clipboard`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyAll}>
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" /> : <Download className="w-3.5 h-3.5 mr-1" />}
      Copy all
    </Button>
  )
}

function DownloadAllButton({ orders }: { orders: Order[] }) {
  function downloadAllCsv() {
    const allKeys = orders.flatMap((o) => (o.keys ?? []).map((k) => ({
      orderId: o.id,
      product: o.product?.name ?? 'Unknown',
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      total: o.totalAmount,
      date: new Date(o.createdAt).toISOString(),
      key: k.key,
    })))
    if (allKeys.length === 0) {
      toast.error('No keys to download')
      return
    }
    const header = 'Order ID,Product,Quantity,Unit Price,Total,Date,Key\n'
    const rows = allKeys.map((r) => {
      const cells = [r.orderId, r.product, String(r.quantity), r.unitPrice.toFixed(2), r.total.toFixed(2), r.date, r.key]
      return cells.map((c) => {
        const s = String(c)
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"'
        }
        return s
      }).join(',')
    })
    downloadFile(`all-keys-${new Date().toISOString().slice(0, 10)}.csv`, header + rows.join('\n'), 'text/csv;charset=utf-8')
    toast.success(`${allKeys.length} keys exported`)
  }

  return (
    <Button variant="outline" size="sm" onClick={downloadAllCsv}>
      <FileSpreadsheet className="w-4 h-4 mr-1" /> Export all keys (CSV)
    </Button>
  )
}

// ----- Deposits view -----
function DepositsView({ deposits, loading }: { deposits: Deposit[]; loading: boolean }) {
  if (loading && deposits.length === 0) {
    return <div className="text-center py-12 text-zinc-500"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
  }
  if (deposits.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-zinc-500">
          <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>No deposit requests yet. Click the Deposit button to add funds.</p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Deposit history</h1>
        <p className="text-sm text-zinc-500">Track the status of your crypto deposits and admin balance adjustments.</p>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Network</th>
                <th className="text-left px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Tx hash</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {deposits.map((d) => {
                const isDebit = d.type === 'ADMIN_DEBIT'
                return (
                  <tr key={d.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(d.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={d.type === 'CRYPTO' || !d.type ? 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400' : isDebit ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'}>
                        {d.type === 'ADMIN_CREDIT' ? 'Admin credit' : d.type === 'ADMIN_DEBIT' ? 'Admin debit' : 'Crypto'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">{d.network}</td>
                    <td className={`px-4 py-3 font-bold ${isDebit ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {isDebit ? '-' : '+'}{formatMoney(d.amount)}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate">
                      {d.txHash ? (
                        <code className="text-xs font-mono">{d.txHash.slice(0, 16)}…</code>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={statusBadgeClass(d.status)}>
                        <span className="inline-flex items-center gap-1">
                          {d.status === 'APPROVED' && <CheckCircle2 className="w-3 h-3" />}
                          {d.status === 'PENDING' && <Clock className="w-3 h-3" />}
                          {d.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                          {d.status}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 max-w-xs truncate">
                      {d.adminNote ? <span className="text-amber-600 dark:text-amber-400">{d.adminNote}</span> : (d.note || '—')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

