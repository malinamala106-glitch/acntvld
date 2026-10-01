'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import type { User, Product, PublicSettings } from '@/lib/types'
import { PublicStorefront } from '@/components/public/PublicStorefront'
import { ProfileSetup } from '@/components/auth/ProfileSetup'
import { Toaster } from '@/components/ui/sonner'

// The authenticated shells are by far the heaviest client code in the app
// (AdminApp alone is ~3.4k lines and pulls in most of the Radix/UI surface),
// but a guest never renders either of them. Importing them statically meant
// every anonymous visitor downloaded the whole admin panel. Splitting them out
// keeps both off the public homepage's initial bundle and lets each visitor
// fetch only the shell their role actually uses.
const AdminApp = dynamic(
  () => import('@/components/admin/AdminApp').then((m) => m.AdminApp),
  { ssr: false, loading: () => <ShellFallback /> }
)
const BuyerApp = dynamic(
  () => import('@/components/buyer/BuyerApp').then((m) => m.BuyerApp),
  { ssr: false, loading: () => <ShellFallback /> }
)

// Shown for the moment it takes to fetch the authenticated shell's chunk.
function ShellFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
      <div className="h-8 w-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" role="status" aria-label="Loading" />
    </div>
  )
}

interface PendingPurchase {
  productId: string
  quantity: number
}

interface Props {
  initialUser: User | null
  initialProducts?: Product[]
  initialSettings?: PublicSettings
}

export function AppShell({ initialUser, initialProducts, initialSettings }: Props) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(initialUser)
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | undefined>()
  const [authOpen, setAuthOpen] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const [settings, setSettings] = useState<PublicSettings | null>(initialSettings ?? null)

  // Re-fetch on mount to catch any auth changes since SSR
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [fresh, st] = await Promise.all([api.me(), api.getSettings()])
        if (mounted) {
          if (!fresh && initialUser) setUser(null)
          else if (fresh && (!initialUser || fresh.id !== initialUser.id)) setUser(fresh)
          setSettings(st)
        }
      } catch {
        // ignore — keep SSR state
      }
    })()
    return () => { mounted = false }
  }, [initialUser])

  // Check for ?buy=ID or ?signin=1 query params
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const buyId = params.get('buy')
    const signin = params.get('signin')
    if (buyId) {
      // Strip the query param from the URL
      window.history.replaceState({}, '', '/')
      if (user) {
        // Already logged in — go straight to checkout
        router.push(`/checkout-page?id=${buyId}`)
      } else {
        // Guest — open auth modal with pending purchase so we can
        // redirect to checkout after they authenticate.
        // Use setTimeout to avoid setState-in-effect lint warning.
        setTimeout(() => {
          setPendingPurchase({ productId: buyId, quantity: 1 })
          setAuthTab('login')
          setAuthOpen(true)
        }, 0)
      }
    } else if (signin) {
      window.history.replaceState({}, '', '/')
      setTimeout(() => {
        setPendingPurchase(undefined)
        setAuthOpen(true)
      }, 0)
    }
  }, [router, user])

  function handleAuthenticated(u: User, pending?: PendingPurchase) {
    setUser(u)
    if (pending) {
      // Redirect to the standalone checkout page for the pending product
      router.push(`/checkout-page?id=${pending.productId}`)
    }
  }

  async function handleLogout() {
    try { await api.logout() } catch {}
    setUser(null)
    setPendingPurchase(undefined)
  }

  return (
    <>
      <Toaster richColors position="top-right" />
      {!user ? (
        <PublicStorefront
          onAuthenticated={handleAuthenticated}
          initialProducts={initialProducts}
          siteName={settings?.siteName ?? 'DigitalVault'}
          content={settings?.content}
          externalAuthOpen={authOpen}
          externalAuthTab={authTab}
          externalPendingPurchase={pendingPurchase}
          onExternalAuthClose={() => setAuthOpen(false)}
        />
      ) : user.profileCompleted === false ? (
        // One-time gate for Google signups: pick a username + password before
        // reaching the dashboard. Closing it signs the user out, so they land
        // back here on their next login until it's completed.
        <ProfileSetup user={user} onDone={setUser} onSignOut={handleLogout} />
      ) : user.role === 'ADMIN' ? (
        <AdminApp user={user} onUserChange={setUser} onLogout={handleLogout} />
      ) : (
        <BuyerApp user={user} onUserChange={setUser} onLogout={handleLogout} />
      )}
    </>
  )
}
