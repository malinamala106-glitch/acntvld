'use client'

import { memo, useEffect, useState, useCallback, useMemo, Component, ReactNode } from 'react'
import Image from 'next/image'
import { isImageUrlValue } from '@/lib/media'
import { api } from '@/lib/api'
import type { User, Product, PublicSettings, SiteContent } from '@/lib/types'
import { contentValue } from '@/lib/site-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { TelegramButton } from '@/components/shared/TelegramButton'
import { SiteFooter } from '@/components/shared/SiteFooter'
import { SiteNavLinks } from '@/components/shared/SiteNavLinks'
import { formatMoney } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from 'sonner'
import {
  ShoppingCart, Package, Search, Loader2, Lock, ArrowRight,
  Eye, EyeOff, CheckCircle2, AlertCircle,
} from 'lucide-react'

interface PendingPurchase {
  productId: string
  quantity: number
}

interface Props {
  onAuthenticated: (user: User, pendingPurchase?: PendingPurchase) => void
  initialProducts?: Product[]
  siteName?: string
  /** Admin-editable section copy (headings, hero text, empty states). */
  content?: SiteContent | null
  externalAuthOpen?: boolean
  externalAuthTab?: 'login' | 'register'
  externalPendingPurchase?: PendingPurchase | null
  onExternalAuthClose?: () => void
}

/** Render an admin-authored heading, turning explicit line breaks into <br />. */
function MultilineHeading({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  return (
    <h1 className={className}>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br className="hidden sm:inline" />}
          {line}
        </span>
      ))}
    </h1>
  )
}

export function PublicStorefront({
  onAuthenticated,
  initialProducts,
  siteName = 'DigitalVault',
  content,
  externalAuthOpen,
  externalAuthTab,
  externalPendingPurchase,
  onExternalAuthClose,
}: Props) {
  const copy = (key: string) => contentValue(content, key)
  const [products, setProducts] = useState<Product[]>(initialProducts ?? [])
  const [loading, setLoading] = useState(!initialProducts)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [authOpen, setAuthOpen] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | undefined>()

  const debouncedSearch = useDebounce(search, 250)

  // Sync with external auth open state (e.g. from AppShell ?buy=ID redirect)
  useEffect(() => {
    if (externalAuthOpen) {
      const t = setTimeout(() => {
        setAuthOpen(true)
        if (externalAuthTab) setAuthTab(externalAuthTab)
        if (externalPendingPurchase) setPendingPurchase(externalPendingPurchase)
        onExternalAuthClose?.()
      }, 50)
      return () => clearTimeout(t)
    }
  }, [externalAuthOpen, externalAuthTab, externalPendingPurchase, onExternalAuthClose])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const prods = await api.listProducts(false)
      setProducts(prods)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!initialProducts) refresh()
  }, [initialProducts, refresh])

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products]
  )

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim()
    return products.filter((p) => {
      const matchSearch = !q ||
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      const matchCat = category === 'all' || p.category === category
      return matchSearch && matchCat
    })
  }, [products, debouncedSearch, category])

  function handleBuyClick(product: Product) {
    // Set the pending purchase + open the auth modal directly — no redirect needed.
    setPendingPurchase({ productId: product.id, quantity: 1 })
    setAuthTab('login')
    setAuthOpen(true)
  }

  function handleAuthenticated(user: User) {
    setAuthOpen(false)
    onAuthenticated(user, pendingPurchase)
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            <span className="font-bold hidden sm:inline">{siteName}</span>
          </div>
          <div className="flex-1" />
          <TelegramButton />
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setPendingPurchase(undefined); setAuthTab('login'); setAuthOpen(true) }}
            className="shrink-0"
          >
            Sign in
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
            onClick={() => { setPendingPurchase(undefined); setAuthTab('register'); setAuthOpen(true) }}
          >
            <span className="hidden sm:inline">Sign up</span>
            <span className="sm:hidden">Join</span>
          </Button>
        </div>
        {/* Secondary nav: admin-editable page links (Site content → Navigation links) */}
        <SiteNavLinks content={content} activeHref="/" />
      </header>

      {/* Hero section — visible without login */}
      <section className="border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950/30 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-14 lg:py-20">
          <div className="max-w-3xl">
            <MultilineHeading
              text={copy('marketplace.heroTitle')}
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white"
            />
            <p className="mt-4 text-base sm:text-lg text-zinc-600 dark:text-zinc-400">
              {copy('marketplace.heroSubtitle')}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              {copy('marketplace.heroBadge1') && (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> {copy('marketplace.heroBadge1')}
                </span>
              )}
              {copy('marketplace.heroBadge1') && copy('marketplace.heroBadge2') && (
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
              )}
              {copy('marketplace.heroBadge2') && (
                <span className="inline-flex items-center gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5" /> {copy('marketplace.heroBadge2')}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Marketplace */}
      <main className="flex-1">
        <section id="products" className="max-w-7xl mx-auto px-3 sm:px-6 py-8 sm:py-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">{copy('marketplace.sectionTitle')}</h2>
              <p className="text-sm text-zinc-500">{copy('marketplace.sectionSubtitle')}</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <Input
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-full sm:w-60"
                  aria-label="Search products"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-32 sm:w-40 shrink-0" aria-label="Filter by category">
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
                <p>{search ? `No products match "${search}".` : copy('marketplace.emptyText')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((p) => (
                <PublicProductCard key={p.id} product={p} onBuy={() => handleBuyClick(p)} />
              ))}
            </div>
          )}
        </section>
      </main>

      <SiteFooter siteName={siteName} tagline={copy('footer.tagline')} content={content} />

      {/* Auth modal */}
      <AuthModal
        open={authOpen}
        setOpen={(v) => setAuthOpen(v)}
        onAuthenticated={handleAuthenticated}
        pendingPurchase={pendingPurchase}
        initialTab={authTab}
      />
    </div>
  )
}

// Public product card — Details link opens /product-details-page?id=xxx, Buy opens auth modal.
// Memoised: the storefront filters on every (debounced) keystroke, and memo lets
// cards whose product hasn't changed skip re-rendering during that pass.
const PublicProductCard = memo(function PublicProductCard({ product, onBuy }: { product: Product; onBuy: () => void }) {
  const outOfStock = product.stock === 0
  const isImageUrl = isImageUrlValue(product.image)
  const productUrl = `/product-details-page?id=${product.id}`
  return (
    <Card className="flex flex-col overflow-hidden hover:shadow-md transition-shadow border-zinc-200 dark:border-zinc-800">
      <a href={productUrl} className="aspect-video bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-5xl overflow-hidden" aria-label={`View details for ${product.name}`}>
        {isImageUrl ? (
          <Image
            src={product.image!}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="w-full h-full object-cover"
            unoptimized={product.image!.startsWith('http')}
          />
        ) : (
          product.image || '📦'
        )}
      </a>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <a href={productUrl} className="hover:text-emerald-600 transition-colors">
            <CardTitle className="text-base">{product.name}</CardTitle>
          </a>
          <Badge variant="outline" className={outOfStock ? 'border-zinc-300 text-zinc-500' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'}>
            {outOfStock ? 'Sold out' : `${product.stock} in stock`}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {(() => {
            // Build the metadata line: category · field1 · field2 · ...
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
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3 min-h-[3.5rem]">
          {product.description || 'No description provided.'}
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between pt-0 border-t border-zinc-100 dark:border-zinc-800 pt-3 mt-1 gap-2">
        <div className="min-w-0">
          {/* Show "From $X" when multiple batches exist with different prices.
              Show "$X – $Y" when there's a range. Fall back to plain price
              when only one batch / no batch pricing. */}
          {product.hasBatchPricing && typeof product.fromPrice === 'number' && typeof product.maxPrice === 'number' && product.fromPrice !== product.maxPrice ? (
            <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">
              <span className="text-xs text-zinc-500 font-normal">From </span>{formatMoney(product.fromPrice)}
              <span className="text-xs text-zinc-400 font-normal"> – </span>{formatMoney(product.maxPrice)}
            </div>
          ) : product.hasBatchPricing && typeof product.fromPrice === 'number' && product.fromPrice !== product.price ? (
            <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">
              <span className="text-xs text-zinc-500 font-normal">From </span>{formatMoney(product.fromPrice)}
            </div>
          ) : (
            <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(product.price)}</div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button asChild variant="outline" size="sm">
            <a href={productUrl} aria-label={`View details for ${product.name}`}>
              Details <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </a>
          </Button>
          <Button
            size="sm"
            onClick={onBuy}
            disabled={outOfStock}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span className="hidden sm:inline ml-1">Buy</span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
})

// Auth modal error boundary — wraps the AuthTabs subtree so that if a future
// bug throws during render or in an effect, the user sees a friendly error
// card instead of a frozen / blank modal. Without this, an uncaught error
// in the modal would propagate up and the whole storefront could go white.
class AuthModalErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('AuthModal crashed:', error)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-3 mx-auto" />
          <h3 className="font-semibold text-base mb-1">Sign-in could not load</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Something went wrong while opening the sign-in form. The page is still responsive — you can close this and try again.
          </p>
          <p className="text-[10px] text-zinc-400 mb-4 font-mono break-all">{this.state.error?.message || 'Unknown error'}</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={this.props.onClose}>Close</Button>
            <Button size="sm" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// Auth modal — sign-in is email/username + password; signup is Google-only.
function AuthModal({ open, setOpen, onAuthenticated, pendingPurchase, initialTab }: {
  open: boolean
  setOpen: (v: boolean) => void
  onAuthenticated: (u: User) => void
  pendingPurchase?: PendingPurchase
  initialTab?: 'login' | 'register'
}) {
  // "Having trouble signing up? Contact →" — close the modal, then open the
  // floating support chat so it isn't hidden behind the dialog overlay.
  function handleContact() {
    setOpen(false)
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('open-chat-widget', { detail: { topic: 'other' } }))
      }
    }, 120)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <AuthModalErrorBoundary onClose={() => setOpen(false)}>
          <AuthTabs onAuthenticated={onAuthenticated} initialTab={initialTab} pendingPurchase={pendingPurchase} onContact={handleContact} />
        </AuthModalErrorBoundary>
      </DialogContent>
    </Dialog>
  )
}

// Math CAPTCHA generator
//
// IMPORTANT: this function must always terminate. The original version had a
// `while (wrongs.size < 3)` loop that could spin forever when the math result
// was deeply negative (e.g. a=2, b=20, op='-' → answer=-18), because every
// generated "wrong" was also negative and got rejected by the `wrong >= 0`
// filter. That froze the browser tab whenever the modal opened.
//
// Fix: avoid subtraction that can go negative (clamp `b` to be ≤ `a` when
// op='-' so the answer is always ≥ 0). Also adds a hard iteration cap as a
// safety net so a future bug can't reintroduce an infinite loop.
function generateCaptcha() {
  let a = Math.floor(Math.random() * 20) + 1 // 1..20
  let b = Math.floor(Math.random() * 20) + 1 // 1..20
  const op = Math.random() > 0.5 ? '+' : '-'
  // For subtraction, ensure a >= b so the answer is non-negative — keeps
  // wrong-answer generation trivially valid (no infinite loop).
  if (op === '-' && b > a) {
    const tmp = a
    a = b
    b = tmp
  }
  const answer = op === '+' ? a + b : a - b

  // Generate 3 wrong answers close to the correct one.
  // Hard cap on iterations to guarantee termination even if the random
  // distribution is unlucky (it shouldn't be, but defense-in-depth).
  const wrongs = new Set<number>()
  let iterations = 0
  while (wrongs.size < 3 && iterations < 100) {
    iterations++
    const delta = Math.floor(Math.random() * 5) - 2 // -2..+2
    const wrong = answer + delta
    if (wrong !== answer && wrong >= 0 && !wrongs.has(wrong)) {
      wrongs.add(wrong)
    }
  }
  // Fallback: if we somehow didn't find 3 unique near-wrongs (shouldn't
  // happen now that answer >= 0), pad with offset values guaranteed unique.
  let pad = 1
  while (wrongs.size < 3) {
    const candidate = answer + 3 + pad // always >= 0 since answer >= 0
    if (candidate !== answer && !wrongs.has(candidate)) wrongs.add(candidate)
    pad++
    if (pad > 50) break // ultimate safety
  }

  const options = [answer, ...Array.from(wrongs)].sort(() => Math.random() - 0.5)
  return { question: `What is ${a} ${op} ${b}?`, answer, options }
}

// Email validation
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function AuthTabs({ onAuthenticated, initialTab, pendingPurchase, onContact }: {
  onAuthenticated: (u: User) => void
  initialTab?: 'login' | 'register'
  pendingPurchase?: PendingPurchase
  onContact: () => void
}) {
  // Signup is Google-only now, so there is no tab toggle. `mode` is driven by
  // whichever entry point opened the modal (the header's "Sign in" vs "Sign up"
  // button) and can be flipped by the inline links below.
  const [mode, setMode] = useState<'login' | 'signup'>(initialTab === 'register' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [captcha, setCaptcha] = useState(() => generateCaptcha())
  const [captchaSelected, setCaptchaSelected] = useState<number | null>(null)
  const [captchaError, setCaptchaError] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Surface an error when Google sign-in bounces back (?auth_error=...).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const err = params.get('auth_error')
    if (err) {
      setError('Google sign-in could not be completed. Please try again or contact support.')
      params.delete('auth_error')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  // Fresh captcha whenever we switch between sign-in and the signup panel.
  useEffect(() => {
    setCaptcha(generateCaptcha())
    setCaptchaSelected(null)
    setCaptchaError(false)
  }, [mode])

  function refreshCaptcha() {
    setCaptcha(generateCaptcha())
    setCaptchaSelected(null)
    setCaptchaError(false)
  }

  function handleCaptchaClick(option: number) {
    setCaptchaSelected(option)
    setCaptchaError(false)
  }

  const captchaSolved = captchaSelected === captcha.answer

  async function submit() {
    if (!captchaSolved) {
      setCaptchaError(true)
      refreshCaptcha()
      return
    }
    setError('')
    setLoading(true)
    try {
      const user = await api.login(email, password, rememberMe)
      onAuthenticated(user)
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  function handleGoogle() {
    setGoogleLoading(true)
    // Full-page redirect to the OAuth consent screen. On failure Google (or
    // our callback) sends the user back with ?auth_error=...
    window.location.href = '/api/auth/google'
  }

  async function handleForgotPassword() {
    if (!isValidEmail(email)) {
      toast.error('Please enter a valid email first')
      return
    }
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        toast.success('Check your email for a reset link.')
        setForgotOpen(false)
      } else {
        toast.error('Failed to send reset link')
      }
    } catch {
      toast.error('Failed to send reset link')
    }
  }

  const headerTitle = pendingPurchase
    ? 'Complete your purchase'
    : mode === 'login'
      ? 'Welcome back'
      : 'Create your account'
  const headerDesc = pendingPurchase
    ? 'Sign in or create an account to continue.'
    : mode === 'login'
      ? 'Sign in to your account to continue.'
      : 'Join thousands of buyers on AccsPoint.'

  return (
    <div>
      <DialogHeader>
        <DialogTitle className="text-xl">{headerTitle}</DialogTitle>
        <DialogDescription>{headerDesc}</DialogDescription>
      </DialogHeader>

      {mode === 'login' ? (
        /* Sign-in form */
        <form className="space-y-3 mt-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
          {/* Email or username */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email or username</Label>
            <Input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoFocus
              autoComplete="username"
            />
          </div>

          {/* Password with toggle */}
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember me + Forgot password */}
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              <span className="text-zinc-600 dark:text-zinc-400">Remember me</span>
            </label>
            <button type="button" onClick={() => setForgotOpen(true)} className="text-emerald-600 hover:underline">
              Forgot password?
            </button>
          </div>

          {/* Math CAPTCHA */}
          <div className="space-y-2">
            <Label className="text-sm">{captcha.question}</Label>
            <div className="grid grid-cols-4 gap-2">
              {captcha.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleCaptchaClick(opt)}
                  className={`py-2 rounded-md text-sm font-medium border-2 transition-all ${
                    captchaSelected === opt
                      ? opt === captcha.answer
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                        : 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-emerald-300 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {captchaError && <p className="text-xs text-red-500">Wrong answer — try the new question</p>}
            {captchaSolved && <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Verified</p>}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading || !captchaSolved}>
            {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Signing in…</> : 'Sign in'}
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">or</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          </div>

          {/* Google sign-in */}
          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={googleLoading}>
            {googleLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <GoogleIcon className="w-4 h-4 mr-2" />}
            Continue with Google
          </Button>

          {/* Switch to the Google-only signup panel */}
          <p className="text-center text-xs text-zinc-500 pt-1">
            New here? <button type="button" onClick={() => { setError(''); setMode('signup') }} className="text-emerald-600 hover:underline font-medium">Sign up with Google →</button>
          </p>

          {/* Contact for signup issues */}
          <p className="text-center text-xs text-zinc-500">
            Having trouble signing up? <button type="button" onClick={onContact} className="text-emerald-600 hover:underline font-medium">Contact →</button>
          </p>
        </form>
      ) : (
        /* Google-only signup */
        <div className="space-y-3 mt-4">
          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={googleLoading}>
            {googleLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <GoogleIcon className="w-4 h-4 mr-2" />}
            Continue with Google
          </Button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">or</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          </div>

          <p className="text-center text-xs text-zinc-500">
            Already have an account? <button type="button" onClick={() => { setError(''); setMode('login') }} className="text-emerald-600 hover:underline font-medium">Sign in →</button>
          </p>

          <p className="text-center text-xs text-zinc-500">
            Having trouble signing up? <button type="button" onClick={onContact} className="text-emerald-600 hover:underline font-medium">Contact →</button>
          </p>
        </div>
      )}

      {/* Forgot password modal */}
      {forgotOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setForgotOpen(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-1">Reset password</h3>
            <p className="text-sm text-zinc-500 mb-4">Enter your email and we'll send you a reset link.</p>
            <div className="space-y-3">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <Button onClick={handleForgotPassword} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                Send reset link
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setForgotOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Google icon SVG
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
