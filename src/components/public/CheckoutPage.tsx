'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { api } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { toast } from 'sonner'
import {
  ShoppingCart, ArrowRight, Loader2, Lock, CheckCircle2, Key, Tag, X, Plus, Minus,
} from 'lucide-react'
import type { Product, User } from '@/lib/types'

// One batch row as returned by GET /api/products/[id]/batches.
// Only batches with at least one available key are returned.
interface PublicBatch {
  id: string
  label: string
  priceOverride: number | null
  effectivePrice: number
  availableCount: number
}

interface CouponState {
  code: string
  valid: boolean
  discountValue: number
  originalTotal: number
  newTotal: number
  message: string
}

export function CheckoutPage({ product, user }: { product: Product; user: User }) {
  // Batch state — null means "no batches exist for this product, fall back
  // to the legacy single-price flow". An empty array means batches existed
  // but none had stock.
  const [batches, setBatches] = useState<PublicBatch[] | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)

  // Resolve the currently-selected batch (or null if no batches).
  const selectedBatch = batches?.find((b) => b.id === selectedBatchId) ?? null
  // Effective unit price depends on the selected batch (or product.price fallback).
  const unitPrice = selectedBatch?.effectivePrice ?? product.price
  // Max quantity is limited to the selected batch's stock (or product.stock if no batches).
  const maxQty = selectedBatch ? Math.max(1, selectedBatch.availableCount) : Math.max(1, product.stock)

  const [qty, setQty] = useState(1)
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<CouponState | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deliveredKeys, setDeliveredKeys] = useState<string[] | null>(null)
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null)

  // Fetch the batches for this product on mount. The endpoint returns only
  // batches with at least one AVAILABLE key, sorted cheapest-first.
  // The default selection is the first item (cheapest), per the spec.
  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${product.id}/batches`)
      if (!res.ok) return
      const data = await res.json()
      const list: PublicBatch[] = data.batches ?? []
      setBatches(list)
      if (list.length > 0) {
        setSelectedBatchId(list[0].id) // cheapest-first
      }
    } catch {
      // Non-fatal — fall back to product.price flow.
      setBatches([])
    }
  }, [product.id])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  const originalTotal = unitPrice * qty
  const total = coupon?.valid ? coupon.newTotal : originalTotal
  const canAfford = user.balance >= total
  const outOfStock = (batches !== null && batches.length === 0) || product.stock === 0

  function changeQty(delta: number) {
    const next = Math.max(1, Math.min(maxQty, qty + delta))
    setQty(next)
    // If a coupon is applied, re-validate it against the new quantity + unit price.
    if (coupon?.valid && couponInput.trim()) {
      validateCoupon(couponInput.trim(), next, unitPrice)
    }
  }

  function selectBatch(id: string) {
    const next = batches?.find((b) => b.id === id) ?? null
    setSelectedBatchId(id)
    // Reset qty to 1 if it exceeds the new batch's stock.
    if (next && qty > next.availableCount) {
      setQty(1)
    }
    // Re-validate coupon against the new unit price.
    if (coupon?.valid && couponInput.trim()) {
      validateCoupon(couponInput.trim(), Math.min(qty, next?.availableCount ?? 1), next?.effectivePrice ?? product.price)
    }
  }

  async function validateCoupon(code: string, qtyOverride?: number, unitPriceOverride?: number) {
    if (!code.trim()) {
      setCouponError('Enter a coupon code first')
      toast.error('Enter a coupon code first')
      return
    }
    setValidating(true)
    setCouponError(null)
    try {
      // Pass the effective unit price so the discount is computed against the
      // selected batch's price, not product.price.
      const result = await api.validateCoupon(code.trim(), product.id, qtyOverride ?? qty, unitPriceOverride ?? unitPrice)
      if (result.valid) {
        setCoupon({
          code: result.code || code.toUpperCase(),
          valid: true,
          discountValue: result.discountValue ?? 0,
          originalTotal: result.originalTotal ?? originalTotal,
          newTotal: result.newTotal ?? originalTotal,
          message: result.message || 'Coupon applied',
        })
        setAppliedCouponCode(result.code || code.toUpperCase())
        setCouponError(null)
        toast.success(`✓ Coupon "${result.code || code.toUpperCase()}" applied — ${result.message || 'discount active'}`)
      } else {
        setCoupon(null)
        setAppliedCouponCode(null)
        const msg = result.message || 'Invalid coupon'
        setCouponError(msg)
        toast.error(msg)
      }
    } catch (e: any) {
      setCoupon(null)
      setAppliedCouponCode(null)
      const msg = e.message || 'Failed to validate coupon'
      setCouponError(msg)
      toast.error(msg)
    } finally {
      setValidating(false)
    }
  }

  function removeCoupon() {
    setCoupon(null)
    setAppliedCouponCode(null)
    setCouponInput('')
    setCouponError(null)
  }

  async function confirmPurchase() {
    setPurchasing(true)
    try {
      // Pass the selected batchId so the server picks keys ONLY from that batch.
      // If the batch was depleted in the meantime, the server returns an error
      // and we re-fetch the batch list so the dropdown updates.
      const result = await api.purchase(product.id, qty, appliedCouponCode || undefined, selectedBatchId || undefined)
      setDeliveredKeys(result.keys.map((k) => k.key))
      setConfirmOpen(false)
      toast.success(`Purchased ${qty} × ${product.name}!`)
    } catch (e: any) {
      toast.error(e.message || 'Purchase failed')
      // If the error mentions "batch" or "stock", refresh the batch list in
      // case the selected batch was depleted while the user was checking out.
      if (/batch|stock/i.test(e.message || '')) {
        await loadBatches()
      }
    } finally {
      setPurchasing(false)
    }
  }

  // Success state — show delivered keys
  if (deliveredKeys) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
            <a href="/" className="text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400 inline-flex items-center gap-2">
              <ArrowRight className="w-4 h-4 rotate-180" /> Back to marketplace
            </a>
            <TelegramButton />
          </div>
        </header>
        <main className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-6 py-8">
          <Card>
            <CardContent className="p-6 sm:p-8 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Purchase successful!</h1>
              <p className="text-sm text-zinc-500 mb-6">
                You bought {qty} × {product.name}
                {selectedBatch ? ` (batch ${selectedBatch.label})` : ''} for {formatMoney(total)}.
                {appliedCouponCode && <span className="block mt-1 text-xs">Coupon applied: <span className="font-mono">{appliedCouponCode}</span></span>}
              </p>
              <div className="text-left bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 mb-6">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5" /> Your license keys
                </div>
                <ul className="space-y-2">
                  {deliveredKeys.map((k, i) => (
                    <li key={i} className="font-mono text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-3 py-2 break-all">
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button asChild variant="outline">
                  <a href="/">Back to marketplace</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
        <SiteFooter userEmail={user.email} />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
          <a href={`/product-details-page?id=${product.id}`} className="text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400 inline-flex items-center gap-2">
            <ArrowRight className="w-4 h-4 rotate-180" /> Back to product
          </a>
          <TelegramButton />
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-6 py-6 sm:py-10">
        <h1 className="text-2xl font-bold mb-1">Checkout</h1>
        <p className="text-sm text-zinc-500 mb-6">Set quantity, apply coupon, and confirm your purchase.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Order summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-16 h-16 rounded-md bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-3xl shrink-0 overflow-hidden">
                  {product.image && (product.image.startsWith('/') || product.image.startsWith('http')) ? (
                    <Image
                      src={product.image}
                      alt={product.name}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                      unoptimized={product.image.startsWith('http')}
                    />
                  ) : (
                    product.image || '📦'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-base">
                    {product.name}
                    {selectedBatch && (
                      <span className="ml-2 text-xs text-zinc-500 font-normal">(batch {selectedBatch.label})</span>
                    )}
                  </h2>
                  <Badge variant="outline" className="text-xs mt-1">{product.category}</Badge>
                  <p className="text-xs text-zinc-500 mt-1">{formatMoney(unitPrice)} per unit</p>
                  {/* Delivery format — shown to buyer at checkout */}
                  {product.deliveryFormat && (
                    <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
                      <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">What you&apos;ll receive</div>
                      <code className="text-xs font-mono text-zinc-700 dark:text-zinc-300">{product.deliveryFormat}</code>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Instantly delivered after purchase.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-sm">
                {/* Batch selector — only shown when there's more than one batch
                    with stock. A single-batch product just shows the price as
                    usual. */}
                {batches && batches.length > 1 && (
                  <div>
                    <Label htmlFor="batch" className="text-xs">Batch</Label>
                    <select
                      id="batch"
                      value={selectedBatchId ?? ''}
                      onChange={(e) => selectBatch(e.target.value)}
                      className="mt-1 w-full h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm"
                    >
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label} · {formatMoney(b.effectivePrice)} · {b.availableCount} available
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-zinc-500 mt-1">Default selection: cheapest available batch.</p>
                  </div>
                )}

                <div>
                  <Label htmlFor="qty" className="text-xs">Quantity</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => changeQty(-1)} disabled={qty <= 1}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Input
                      id="qty"
                      type="number"
                      min={1}
                      max={maxQty}
                      value={qty}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 1
                        const clamped = Math.max(1, Math.min(maxQty, v))
                        setQty(clamped)
                        if (coupon?.valid && couponInput.trim()) {
                          validateCoupon(couponInput.trim(), clamped, unitPrice)
                        }
                      }}
                      className="w-20 text-center"
                    />
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => changeQty(1)} disabled={qty >= maxQty}>
                      <Plus className="w-4 h-4" />
                    </Button>
                    <span className="text-xs text-zinc-500 ml-1">
                      {selectedBatch ? `${selectedBatch.availableCount} in this batch` : `${product.stock} available`}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Coupon box */}
              <div className="space-y-2">
                <Label htmlFor="coupon" className="text-xs flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" /> Coupon code
                </Label>
                {coupon?.valid ? (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <Tag className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200 truncate">
                          {coupon.code}
                        </div>
                        <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                          − {formatMoney(coupon.discountValue)} ({coupon.message})
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={removeCoupon}
                      className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 shrink-0"
                      aria-label="Remove coupon"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        id="coupon"
                        placeholder="e.g. SAVE10"
                        value={couponInput}
                        onChange={(e) => {
                          setCouponInput(e.target.value.toUpperCase())
                          if (couponError) setCouponError(null)
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validateCoupon(couponInput, qty, unitPrice) } }}
                        className="flex-1 uppercase"
                      />
                      <Button
                        variant="outline"
                        onClick={() => validateCoupon(couponInput, qty, unitPrice)}
                        disabled={validating || !couponInput.trim()}
                      >
                        {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                      </Button>
                    </div>
                    {couponError && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                        <X className="w-3 h-3" /> {couponError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="space-y-2 text-sm border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Subtotal ({qty} × {formatMoney(unitPrice)})</span>
                  <span className="font-medium">{formatMoney(originalTotal)}</span>
                </div>
                {coupon?.valid && (
                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Discount</span>
                    <span className="font-medium">− {formatMoney(coupon.discountValue)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Your balance</span>
                  <span className={`font-medium ${canAfford ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {formatMoney(user.balance)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">After purchase</span>
                  <span className="font-medium">{formatMoney(user.balance - total)}</span>
                </div>
              </div>

              {!canAfford && (
                <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                  Insufficient balance. <a href="/deposit" className="underline font-medium">Deposit funds</a> before purchasing.
                </div>
              )}

              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(total)}</span>
                </div>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={purchasing || outOfStock || !canAfford}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <ShoppingCart className="w-4 h-4 mr-1" />
                  {outOfStock ? 'Sold out' : `Buy ${qty} for ${formatMoney(total)}`}
                </Button>
                <p className="text-[11px] text-zinc-500 flex items-center justify-center gap-1 mt-3">
                  <Lock className="w-3 h-3" /> You&apos;ll be asked to confirm before payment
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" /> Confirm your purchase
            </DialogTitle>
            <DialogDescription>
              Please review your order before completing the purchase. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Product</span>
              <span className="font-medium text-right max-w-[60%] truncate">
                {product.name}
                {selectedBatch && <span className="block text-xs text-zinc-500 font-normal">batch {selectedBatch.label}</span>}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Quantity</span>
              <span className="font-medium">{qty}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Unit price</span>
              <span className="font-medium">{formatMoney(unitPrice)}</span>
            </div>
            {coupon?.valid && (
              <div className="flex items-center justify-between text-sm text-emerald-700 dark:text-emerald-400">
                <span>Coupon ({coupon.code})</span>
                <span className="font-medium">− {formatMoney(coupon.discountValue)}</span>
              </div>
            )}
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 flex items-center justify-between">
              <span className="font-semibold">Total to pay</span>
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(total)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Balance after purchase</span>
              <span>{formatMoney(user.balance - total)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purchasing}>
              Cancel
            </Button>
            <Button
              onClick={confirmPurchase}
              disabled={purchasing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {purchasing ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Processing…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-1" /> Confirm & pay</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFooter userEmail={user.email} />

      {/* Toast notifications — must be mounted for toast.success/error to show */}
      <Toaster richColors position="top-right" />
    </div>
  )
}
