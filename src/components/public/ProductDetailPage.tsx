'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { isImageUrlValue } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { formatMoney } from '@/lib/format'
import { sanitizeHtml } from '@/lib/sanitize'
import { ShoppingCart, ArrowRight, Lock, AlertCircle, Package, Truck } from 'lucide-react'
import type { Product } from '@/lib/types'

export function ProductDetailPage({ product }: { product: Product }) {
  const outOfStock = product.stock === 0
  const isImageUrl = isImageUrlValue(product.image)

  function handleBuy() {
    // Navigate to the standalone checkout page (with quantity input, coupon, confirmation)
    window.location.href = `/checkout-page?id=${product.id}`
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-emerald-600 dark:text-zinc-400">
            <ArrowRight className="w-4 h-4 rotate-180" /> Back to marketplace
          </Link>
          <div className="flex items-center gap-2">
            <TelegramButton />
            <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white text-xs" aria-hidden="true">D</div>
          </div>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks activeHref="/" />
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-3 sm:px-6 py-6 lg:py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {/* Image */}
          <div className="aspect-square bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 rounded-lg overflow-hidden flex items-center justify-center text-7xl">
            {isImageUrl ? (
              // Product hero sits above the fold and is the LCP candidate —
              // next/image prioritizes it (no lazy loading on the first
              // viewport image).
              <Image
                src={product.image!}
                alt={product.name}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="w-full h-full object-cover"
                priority
                unoptimized={product.image!.startsWith('http')}
              />
            ) : (
              product.image || '📦'
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Badge variant="outline" className="text-xs">{product.category}</Badge>
              {/* Render metadata as badges */}
              {(() => {
                try {
                  const fields = product.metadata ? JSON.parse(product.metadata) : []
                  if (!Array.isArray(fields)) return null
                  return fields.filter((f: any) => f && f.name && f.value && f.value.trim()).map((f: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs text-zinc-500">{f.value.trim()}</Badge>
                  ))
                } catch { return null }
              })()}
              <Badge variant="outline" className={outOfStock ? 'border-zinc-300 text-zinc-500' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'}>
                {outOfStock ? 'Sold out' : `${product.stock} in stock`}
              </Badge>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold mb-4">{product.name}</h1>

            {product.description ? (
              <div className="mb-6">
                <h2 className="text-sm font-semibold mb-1">Description</h2>
                {product.renderHtml ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed
                      [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-zinc-900 dark:[&_h1]:text-zinc-100
                      [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100
                      [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-zinc-800 dark:[&_h3]:text-zinc-200
                      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1
                      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1
                      [&_a]:text-emerald-600 [&_a]:underline [&_a]:hover:text-emerald-700
                      [&_p]:my-1.5 [&_p]:leading-relaxed
                      [&_strong]:font-semibold [&_strong]:text-zinc-800 dark:[&_strong]:text-zinc-200"
                    // Admin-authored rich text — sanitized (DOMPurify) before it
                    // can touch the DOM: scripts, event handlers and
                    // javascript: URLs are stripped, formatting tags survive.
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(product.description) }}
                  />
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{product.description}</p>
                )}
              </div>
            ) : (
              <div className="mb-6 text-sm text-zinc-500 italic flex items-center gap-2">
                <Package className="w-4 h-4" /> No description provided.
              </div>
            )}

            {/* Delivery format — shown to buyer before purchase */}
            {product.deliveryFormat && (
              <div className="mb-6 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">What you'll receive</div>
                <code className="block text-sm font-mono text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 rounded-md px-3 py-2 border border-zinc-200 dark:border-zinc-800">
                  {product.deliveryFormat}
                </code>
                <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                  <Truck className="w-3 h-3" /> Instantly delivered after purchase.
                </p>
              </div>
            )}

            <div className="mt-auto">
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div>
                  <div className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(product.price)}</div>
                  <div className="text-xs text-zinc-500">per unit</div>
                </div>
                <Button
                  onClick={handleBuy}
                  disabled={outOfStock}
                  size="lg"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <ShoppingCart className="w-5 h-5 mr-2" />
                  {outOfStock ? 'Sold out' : 'Buy now'}
                </Button>
              </div>
              <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-2">
                {outOfStock ? 'This product is out of stock.' : (<><Lock className="w-3 h-3" /> Sign in required to purchase</>)}
              </p>
            </div>
          </div>
        </div>

        {/* Related: simple trust signals */}
        <Card className="mt-8">
          <CardContent className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold mb-1">Instant delivery</div>
              <p className="text-zinc-500 text-xs">Keys are delivered to your account immediately after purchase.</p>
            </div>
            <div>
              <div className="font-semibold mb-1">Crypto deposits</div>
              <p className="text-zinc-500 text-xs">Top up your balance with crypto (BTC, ETH, USDT, SOL).</p>
            </div>
            <div>
              <div className="font-semibold mb-1">No login to browse</div>
              <p className="text-zinc-500 text-xs">Look around freely — you only need an account to buy.</p>
            </div>
          </CardContent>
        </Card>
      </main>

      <SiteFooter />
    </div>
  )
}
