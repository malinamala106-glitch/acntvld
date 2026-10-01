'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { toast } from 'sonner'
import { formatMoney } from '@/lib/format'
import {
  Gavel, Clock, Zap, Info, ArrowRight, Loader2, Trophy, Lock, Users, X, CheckCircle2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Auction, SiteContent } from '@/lib/types'
import { contentValue } from '@/lib/site-content'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'

interface Props {
  auctions: Auction[]
  /** Admin-editable section copy (hero heading, badge text, empty state). */
  content?: SiteContent | null
  siteName?: string
}

function timeLeft(endsAt: string): { ms: number; days: number; hours: number; minutes: number; seconds: number; expired: boolean } {
  const ms = Math.max(0, new Date(endsAt).getTime() - Date.now())
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return { ms, days, hours, minutes, seconds, expired: ms === 0 }
}

type TimeLeft = ReturnType<typeof timeLeft>

type UrgencyKey = 'high' | 'medium' | 'low' | 'ended'

interface UrgencyStyle {
  key: UrgencyKey
  label: string
  Icon: LucideIcon
  /** Top ticker bar background. */
  ticker: string
  /** Gradient behind the item's visual. */
  gradient: string
  /** Progress bar fill. */
  bar: string
  /** Bid button colours. */
  button: string
  /** "Time Left" text colour. */
  timeLeft: string
}

const HOUR_MS = 3600000

// Urgency thresholds drive the whole colour system: red under 6h, amber under 48h, blue beyond.
function getUrgency(ms: number, expired: boolean): UrgencyStyle {
  if (expired) {
    return {
      key: 'ended', label: 'ENDED', Icon: Clock,
      ticker: 'bg-slate-500', gradient: 'from-slate-100 to-slate-200',
      bar: 'bg-slate-400', button: 'bg-slate-400', timeLeft: 'text-slate-600',
    }
  }
  if (ms <= 6 * HOUR_MS) {
    return {
      key: 'high', label: 'ENDING SOON', Icon: Zap,
      ticker: 'bg-red-500', gradient: 'from-red-50 to-orange-50',
      bar: 'bg-red-500', button: 'bg-red-600 hover:bg-red-700', timeLeft: 'text-red-600',
    }
  }
  if (ms <= 48 * HOUR_MS) {
    return {
      key: 'medium', label: 'LIVE NOW', Icon: Clock,
      ticker: 'bg-amber-500', gradient: 'from-amber-50 to-yellow-50',
      bar: 'bg-amber-500', button: 'bg-green-600 hover:bg-green-700', timeLeft: 'text-amber-600',
    }
  }
  return {
    key: 'low', label: 'LIVE', Icon: Clock,
    ticker: 'bg-blue-500', gradient: 'from-blue-50 to-cyan-50',
    bar: 'bg-blue-500', button: 'bg-green-600 hover:bg-green-700', timeLeft: 'text-blue-600',
  }
}

/** Ticker clock: "2d 03:04:05" beyond a day, "hh:mm:ss" within one. */
function formatTickerClock({ days, hours, minutes, seconds }: TimeLeft): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

/** Compact "Time Left" stat: "3d 4h", "4h 12m", "14m 22s". */
function formatShortTimeLeft({ days, hours, minutes, seconds }: TimeLeft): string {
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${seconds}s`
}

/**
 * The API accepts ANY bid above $0 (one bid per user), so Auction has no real
 * "minimum next bid" field. This is a display-only nudge just above the current
 * highest bid — the bid dialog itself still accepts whatever the bidder types.
 */
function suggestedNextBid(auction: Auction): number {
  if (!auction.currentBid || auction.currentBid <= 0) return auction.askingPrice || 1
  const step = Math.max(1, Math.round(auction.currentBid * 0.05 * 100) / 100)
  return Math.round((auction.currentBid + step) * 100) / 100
}

export function SpecialDealsPage({ auctions: initialAuctions, content, siteName = 'DigitalVault' }: Props) {
  const copy = (key: string) => contentValue(content, key)
  const [auctions, setAuctions] = useState<Auction[]>(initialAuctions)
  const [bidModalAuction, setBidModalAuction] = useState<Auction | null>(null)
  // Map of auctionId → the user's bid on that auction (if any)
  const [myBids, setMyBids] = useState<Record<string, { id: string; amount: number; cancelStatus: string }>>({})

  // Refresh auctions + user's bids every 30s to keep currentBid + countdown + "You Joined" status fresh
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auctions')
      const data = await res.json()
      if (data.auctions) setAuctions(data.auctions)

      // Fetch the user's bids (to know which auctions they've already joined)
      try {
        const myBidsRes = await fetch('/api/bids')
        const myBidsData = await myBidsRes.json()
        if (myBidsData.bids) {
          const map: Record<string, { id: string; amount: number; cancelStatus: string }> = {}
          for (const b of myBidsData.bids) {
            // Treat NONE / REJECTED as "active" (joined). APPROVED = cancelled, so not joined anymore.
            if (b.cancelStatus === 'NONE' || b.cancelStatus === 'REJECTED' || b.cancelStatus === 'PENDING') {
              map[b.auctionId] = { id: b.id, amount: b.amount, cancelStatus: b.cancelStatus }
            }
          }
          setMyBids(map)
        }
      } catch {}
    } catch {}
  }, [])

  useEffect(() => {
    // Use setTimeout to avoid setState-in-effect lint warning
    const t = setTimeout(refresh, 0)
    const interval = setInterval(refresh, 30000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [refresh])

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <a href="/" className="flex items-center gap-2" aria-label="Go home">
              <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
              <span className="font-bold hidden sm:inline">{siteName}</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <TelegramButton />
            <Button asChild variant="outline" size="sm">
              <a href="/">← Marketplace</a>
            </Button>
          </div>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={content} activeHref="/special-deal" />
      </header>

      {/* Hero */}
      <section className="border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950/30 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-14">
          <div className="max-w-3xl">
            {copy('specialDeal.badge') && (
              <Badge variant="outline" className="mb-3 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
                <Gavel className="w-3 h-3 mr-1" /> {copy('specialDeal.badge')}
              </Badge>
            )}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white">
              {copy('specialDeal.heroTitle')}
            </h1>
            <p className="mt-4 text-base sm:text-lg text-zinc-600 dark:text-zinc-400">
              {copy('specialDeal.heroSubtitle')}
            </p>
            {/* Hero notes — the first is the lock note, the rest are plain. Empty
                ones are skipped entirely so no dangling · separator is left behind. */}
            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              {[copy('specialDeal.heroBadge1'), copy('specialDeal.heroBadge2'), copy('specialDeal.heroBadge3')]
                .filter(Boolean)
                .map((note, i) => (
                  <span key={note + i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                    {i === 0 ? <Lock className="w-3.5 h-3.5" /> : i === 1 ? <Trophy className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    {note}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-8 sm:py-12">
        {auctions.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-zinc-500">
              <Gavel className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p>{copy('specialDeal.emptyText')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {auctions.map((a) => (
              <AuctionCard key={a.id} auction={a} myBid={myBids[a.id] || null} onBid={() => setBidModalAuction(a)} />
            ))}
          </div>
        )}
      </main>

      <SiteFooter siteName={siteName} tagline={copy('footer.tagline')} content={content} />

      {bidModalAuction && (
        <BidModal auction={bidModalAuction} onClose={() => setBidModalAuction(null)} onPlaced={refresh} />
      )}
    </div>
  )
}

function AuctionCard({ auction, myBid, onBid }: { auction: Auction; myBid: { id: string; amount: number; cancelStatus: string } | null; onBid: () => void }) {
  const [time, setTime] = useState(() => timeLeft(auction.endsAt))

  useEffect(() => {
    const interval = setInterval(() => setTime(timeLeft(auction.endsAt)), 1000)
    return () => clearInterval(interval)
  }, [auction.endsAt])

  const isEnded = time.expired || auction.status !== 'ACTIVE'
  const isImageUrl = auction.image && (auction.image.startsWith('/') || auction.image.startsWith('http'))
  // User has joined this auction if they have an active or pending-cancel bid on it
  const hasJoined = !!myBid

  // --- Presentation-only derivations (no state, fetching or bid logic touched) ---
  const urgency = getUrgency(time.ms, isEnded)
  const currentBidExceedsAsking = auction.currentBid > auction.askingPrice
  const progressPct = auction.askingPrice > 0
    ? Math.min(100, Math.max(0, Math.round((auction.currentBid / auction.askingPrice) * 100)))
    : 0
  const nextBid = suggestedNextBid(auction)
  const tickerClock = formatTickerClock(time)
  const shortTimeLeft = formatShortTimeLeft(time)
  const isHot = urgency.key === 'high'

  return (
    <div className={`bg-white rounded-xl shadow-md overflow-hidden flex flex-col relative ${isHot ? 'glow-border' : ''}`}>
      {/* Top status ticker — colour communicates urgency at a glance */}
      <div className={`text-white text-xs font-bold px-4 py-1.5 flex justify-between items-center ${urgency.ticker}`}>
        <span className="flex items-center gap-1.5">
          <urgency.Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {urgency.label}
        </span>
        {/* The clock is derived from Date.now() on both server and client, so the two
            renders inevitably differ by a second — suppress the (pre-existing) warning. */}
        <span className="font-mono text-sm" suppressHydrationWarning>{tickerClock}</span>
      </div>

      {/* Body: visual + trading data */}
      <div className="p-5 flex flex-col sm:flex-row gap-5">
        {/* Visual */}
        <div className={`w-full sm:w-1/3 min-h-[140px] bg-gradient-to-br ${urgency.gradient} rounded-lg flex items-center justify-center p-6 relative overflow-hidden`}>
          {isImageUrl ? (
            <Image
              src={auction.image!}
              alt={auction.title}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="absolute inset-0 w-full h-full object-cover"
              unoptimized={auction.image!.startsWith('http')}
            />
          ) : (
            <span className="text-6xl drop-shadow-md" aria-hidden="true">{auction.image || '🏆'}</span>
          )}
          <span className="absolute bottom-2 left-2 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded">
            {auction.bidCount ?? 0} bid{(auction.bidCount ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Data */}
        <div className="w-full sm:w-2/3 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-1 gap-2">
              <a href={`/special-deal/${auction.slug}`} className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 leading-tight hover:text-emerald-600 transition-colors">{auction.title}</h3>
              </a>
              <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">{auction.category}</span>
            </div>

            {auction.description && (
              <p className="text-xs text-slate-500 line-clamp-2 mb-3">{auction.description}</p>
            )}

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="flex justify-between items-end mb-2">
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Current Bid</div>
                  <div className="text-3xl font-extrabold text-slate-900 leading-none">{formatMoney(auction.currentBid)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Asking</div>
                  <div className={`text-sm font-semibold text-slate-500 ${currentBidExceedsAsking ? 'line-through' : ''}`}>
                    {formatMoney(auction.askingPrice)}
                  </div>
                </div>
              </div>

              <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                <div className={`${urgency.bar} h-1.5 rounded-full`} style={{ width: `${progressPct}%` }} />
              </div>

              <div className="flex justify-between text-[10px] font-medium text-slate-500">
                <span>
                  Min. Next Bid: <strong className="text-slate-800">{formatMoney(nextBid)}</strong>
                </span>
                <span>
                  Time Left: <strong className={`font-mono ${urgency.timeLeft}`} suppressHydrationWarning>{shortTimeLeft}</strong>
                </span>
              </div>
            </div>

            {/* Your bid badge (shown if user has joined this auction) */}
            {hasJoined && (
              <div className={`mt-3 rounded-lg p-2.5 text-xs flex items-center justify-between gap-2 border ${
                myBid!.cancelStatus === 'PENDING'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                <span className="font-bold">Your bid: {formatMoney(myBid!.amount)}</span>
                {myBid!.cancelStatus === 'PENDING' && <span className="text-[10px] font-semibold">Cancel pending</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex justify-between items-center gap-3 mt-auto">
        <a
          href={`/special-deal/${auction.slug}`}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1"
        >
          <Info className="w-3.5 h-3.5" aria-hidden="true" /> Details
        </a>
        {hasJoined ? (
          // Show "You Joined" — link to the deal detail page so user can manage their bid
          <a
            href={`/special-deal/${auction.slug}`}
            className="text-white text-sm font-bold py-2.5 px-6 rounded-lg transition-all shadow-md hover:shadow-lg flex items-center gap-2 bg-slate-600 hover:bg-slate-700"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> You Joined
          </a>
        ) : (
          <button
            type="button"
            onClick={onBid}
            disabled={isEnded}
            className={`text-white text-sm font-bold py-2.5 px-6 rounded-lg transition-all shadow-md hover:shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${urgency.button}`}
          >
            <Zap className="w-4 h-4" aria-hidden="true" /> Bid {formatMoney(nextBid)}
          </button>
        )}
      </div>
    </div>
  )
}

function BidModal({ auction, onClose, onPlaced }: { auction: Auction; onClose: () => void; onPlaced: () => void }) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // One-bid-per-user rule: any positive amount is accepted (even lower than current highest bid)
  // The user can place only ONE bid per auction. To bid again, they must request cancellation first.

  async function submitBid() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid bid amount (must be greater than 0)')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/auctions/${auction.id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Bid placed! Funds locked from your wallet. You can place a new bid only after requesting cancellation and getting admin approval.')
        onPlaced()
        onClose()
      } else {
        toast.error(data?.error || 'Failed to place bid')
      }
    } catch {
      toast.error('Failed to place bid')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-emerald-600" /> Place a bid
          </DialogTitle>
          <DialogDescription>
            Enter your bid for <span className="font-semibold">{auction.title}</span>. You can bid any amount — even lower than the current highest. The bid amount will be locked from your wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-zinc-500">Asking price</span>
              <span className="font-medium">{formatMoney(auction.askingPrice)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-zinc-500">Current highest bid</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(auction.currentBid)}</span>
            </div>
          </div>

          {/* One-bid-per-user rule callout */}
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold mb-0.5">One bid per deal</p>
              <p>You can place only ONE bid on this deal. To place a new bid, you must request cancellation first — admin approval is required. Your locked funds will be refunded once the cancellation is approved.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bidAmount">
              Your bid (any amount &gt; $0)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-medium">$</span>
              <Input
                id="bidAmount"
                type="number"
                min={0.01}
                step="0.01"
                placeholder="e.g. 10.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
                className="pl-7"
                onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) submitBid() }}
              />
            </div>
            <p className="text-xs text-zinc-500 flex items-start gap-1.5">
              <Lock className="w-3 h-3 mt-0.5 shrink-0" />
              The bid amount is locked from your wallet. You can request cancellation later — admin approval refunds the locked funds.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            onClick={submitBid}
            disabled={submitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Placing bid…</> : <>Place Bid</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----- Detail page component (exported for /special-deal/[slug] route) -----

interface BidWithUser {
  id: string
  amount: number
  userId: string
  createdAt: string
  cancelStatus: string
  user?: { email: string | null; name: string | null } | null
}

export function SpecialDealDetailPage({ auction: initial, content, siteName = 'DigitalVault' }: { auction: Auction & { bids?: BidWithUser[] }; content?: SiteContent | null; siteName?: string }) {
  const copy = (key: string) => contentValue(content, key)
  const [auction, setAuction] = useState(initial)
  const [bidModalOpen, setBidModalOpen] = useState(false)
  const [time, setTime] = useState(() => timeLeft(initial.endsAt))
  const [myBid, setMyBid] = useState<BidWithUser | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setTime(timeLeft(initial.endsAt)), 1000)
    return () => clearInterval(interval)
  }, [initial.endsAt])

  const refresh = useCallback(async () => {
    try {
      // Fetch this auction's full details (including bids)
      const res = await fetch(`/api/auctions`)
      const data = await res.json()
      const found = (data.auctions || []).find((a: any) => a.id === initial.id)
      if (found) setAuction((prev) => ({ ...prev, ...found }))

      // Fetch the user's bids (to find their bid on this auction, if any)
      const myBidsRes = await fetch('/api/bids')
      const myBidsData = await myBidsRes.json()
      if (myBidsData.bids) {
        const found = myBidsData.bids.find((b: any) => b.auctionId === initial.id)
        setMyBid(found || null)
      }
    } catch {}
  }, [initial.id])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [refresh])

  async function requestCancel() {
    if (!myBid) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/bids/${myBid.id}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success('Cancellation request submitted. Admin will review it. Your locked funds will be refunded once approved.')
        await refresh()
      } else {
        toast.error(data?.error || 'Failed to request cancellation')
      }
    } catch {
      toast.error('Failed to request cancellation')
    } finally {
      setCancelling(false)
    }
  }

  const isEnded = time.expired || auction.status !== 'ACTIVE'
  const isImageUrl = auction.image && (auction.image.startsWith('/') || auction.image.startsWith('http'))

  const bids = auction.bids || []

  // Stats: how many people joined (unique bidders) + how many placed bids (total bids)
  const uniqueBidders = new Set(bids.map((b) => b.userId)).size
  const totalBids = auction.bidCount ?? bids.length

  // Determine if user can place a bid (no active bid yet)
  const hasActiveBid = myBid && (myBid.cancelStatus === 'NONE' || myBid.cancelStatus === 'REJECTED')
  const hasPendingCancel = myBid && myBid.cancelStatus === 'PENDING'
  const hasApprovedCancel = myBid && myBid.cancelStatus === 'APPROVED'

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <Toaster richColors position="top-right" />

      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
          <a href="/special-deal" className="text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400 inline-flex items-center gap-2">
            <ArrowRight className="w-4 h-4 rotate-180" /> Back to all special deals
          </a>
          <TelegramButton />
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={content} activeHref="/special-deal" />
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-6 sm:py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {/* Image */}
          <div className="aspect-square bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 rounded-lg overflow-hidden flex items-center justify-center text-7xl">
            {isImageUrl ? (
              <Image
                src={auction.image!}
                alt={auction.title}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="w-full h-full object-cover"
                priority
                unoptimized={auction.image!.startsWith('http')}
              />
            ) : (
              auction.image || '🏆'
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Badge variant="outline" className="text-xs">{auction.category}</Badge>
              <Badge variant="outline" className={isEnded ? 'border-zinc-300 text-zinc-500' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'}>
                {isEnded ? 'Ended' : 'Live now'}
              </Badge>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold mb-3">{auction.title}</h1>

            {/* Countdown — large */}
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-4 mb-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Time remaining
              </div>
              <div className="flex items-center gap-2 font-mono font-bold">
                {time.days > 0 && (
                  <div className="text-center">
                    <div className="text-2xl sm:text-3xl text-emerald-700 dark:text-emerald-300">{time.days}</div>
                    <div className="text-[9px] uppercase text-zinc-500">days</div>
                  </div>
                )}
                {time.days > 0 && <span className="text-xl text-emerald-700 dark:text-emerald-300">:</span>}
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl text-emerald-700 dark:text-emerald-300">{String(time.hours).padStart(2, '0')}</div>
                  <div className="text-[9px] uppercase text-zinc-500">hrs</div>
                </div>
                <span className="text-xl text-emerald-700 dark:text-emerald-300">:</span>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl text-emerald-700 dark:text-emerald-300">{String(time.minutes).padStart(2, '0')}</div>
                  <div className="text-[9px] uppercase text-zinc-500">min</div>
                </div>
                <span className="text-xl text-emerald-700 dark:text-emerald-300">:</span>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl text-emerald-700 dark:text-emerald-300">{String(time.seconds).padStart(2, '0')}</div>
                  <div className="text-[9px] uppercase text-zinc-500">sec</div>
                </div>
              </div>
            </div>

            {/* Description */}
            {auction.description && (
              <div className="mb-4">
                <h2 className="text-sm font-semibold mb-1">Description</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{auction.description}</p>
              </div>
            )}

            {/* Delivery format */}
            {auction.deliveryFormat && (
              <div className="mb-4 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1">Delivery format</div>
                <div className="text-sm font-semibold">{auction.deliveryFormat}</div>
              </div>
            )}

            {/* Bid info — including the new stats */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-sm mb-4">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500">Asking price</span>
                <span className="font-medium">{formatMoney(auction.askingPrice)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500">Current highest bid</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(auction.currentBid)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> People joined
                </span>
                <span className="font-medium">{uniqueBidders}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500 flex items-center gap-1">
                  <Gavel className="w-3.5 h-3.5" /> Bids placed
                </span>
                <span className="font-medium">{totalBids}</span>
              </div>
            </div>

            {/* Your bid status (if user has bid on this auction) */}
            {myBid && (
              <div className={`rounded-md border p-3 mb-4 text-sm ${
                myBid.cancelStatus === 'APPROVED'
                  ? 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                  : myBid.cancelStatus === 'PENDING'
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
              }`}>
                <div className="font-semibold mb-1">Your bid: {formatMoney(myBid.amount)}</div>
                {myBid.cancelStatus === 'NONE' && <div className="text-xs">Active — funds locked from your wallet.</div>}
                {myBid.cancelStatus === 'PENDING' && <div className="text-xs">Cancellation request pending admin review. Your funds are still locked until approved.</div>}
                {myBid.cancelStatus === 'APPROVED' && <div className="text-xs">Cancelled — locked funds refunded to your wallet.</div>}
                {myBid.cancelStatus === 'REJECTED' && <div className="text-xs">Cancellation request was rejected by admin. Your bid stays active — you can request cancellation again if needed.</div>}
              </div>
            )}

            <div className="mt-auto">
              {/* Show different buttons based on user's bid status */}
              {hasActiveBid ? (
                <Button
                  onClick={requestCancel}
                  disabled={isEnded || cancelling}
                  size="lg"
                  variant="outline"
                  className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                >
                  {cancelling ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <X className="w-5 h-5 mr-2" />}
                  {cancelling ? 'Submitting…' : 'Request to cancel bid'}
                </Button>
              ) : hasPendingCancel ? (
                <Button
                  disabled
                  size="lg"
                  variant="outline"
                  className="w-full"
                >
                  <Loader2 className="w-5 h-5 mr-2" /> Cancellation pending…
                </Button>
              ) : hasApprovedCancel ? (
                <Button
                  onClick={() => setBidModalOpen(true)}
                  disabled={isEnded}
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Gavel className="w-5 h-5 mr-2" />
                  {isEnded ? 'Auction ended' : 'Place a new bid'}
                </Button>
              ) : (
                <Button
                  onClick={() => setBidModalOpen(true)}
                  disabled={isEnded}
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Gavel className="w-5 h-5 mr-2" />
                  {isEnded ? 'Auction ended' : 'Place a bid'}
                </Button>
              )}
              <p className="text-[11px] text-zinc-500 flex items-center justify-center gap-1 mt-2">
                <Lock className="w-3 h-3" /> Sign in required · One bid per deal · Funds locked from wallet
              </p>
            </div>
          </div>
        </div>

        {/* Bids section — always show after placing a bid (or if there are any bids) */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> Bids
              <Badge variant="outline" className="ml-1 text-[10px]">{totalBids} total · {uniqueBidders} bidders</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bids.length === 0 ? (
              <p className="text-sm text-zinc-500 py-6 text-center">No bids yet. Be the first to bid!</p>
            ) : (
              <div className="space-y-2">
                {bids.map((bid, i) => (
                  <div key={bid.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0
                          ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}>
                        {i + 1}
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {bid.user?.name || bid.user?.email?.split('@')[0] || 'Anonymous'}
                          {i === 0 && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">Highest</span>}
                          {bid.cancelStatus === 'PENDING' && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-medium">Cancel pending</span>}
                          {bid.cancelStatus === 'APPROVED' && <span className="ml-2 text-xs text-zinc-500 font-medium">Cancelled</span>}
                          {bid.cancelStatus === 'REJECTED' && <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-medium">Cancel rejected</span>}
                        </div>
                        <div className="text-xs text-zinc-500">{new Date(bid.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="font-bold text-sm">{formatMoney(bid.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <SiteFooter siteName={siteName} tagline={copy('footer.tagline')} content={content} />

      {bidModalOpen && (
        <BidModal auction={auction} onClose={() => setBidModalOpen(false)} onPlaced={refresh} />
      )}
    </div>
  )
}
