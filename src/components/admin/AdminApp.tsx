'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { api } from '@/lib/api'
import type { User, Product, LicenseKey, CryptoWallet, Deposit, Order, AdminStats, PublicSettings, SiteContent, BlogPost } from '@/lib/types'
import {
  CONTENT_SECTIONS, defaultContent, navLinksForEditing, serializeNavLinks, resolveNavLinks,
  NAV_LINKS_FIELD, NAV_LINKS_MAX, type NavLinkInput,
  FOOTER_CONFIG_FIELD, FOOTER_LEGAL_MAX, defaultFooterConfig, resolveFooterConfig, serializeFooterConfig,
  type FooterConfig, type FooterLinkItem,
} from '@/lib/site-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CopyButton } from '@/components/shared/CopyButton'
import { ActivityLog } from '@/components/shared/ActivityLog'
import { RichTextEditor } from '@/components/admin/RichTextEditor'
import { ImageUploader } from '@/components/admin/ImageUploader'
import { EntriesModal } from '@/components/admin/EntriesModal'
import { UserProfileModal } from '@/components/admin/UserProfileModal'
import { SupportConsoleView } from '@/components/admin/SupportConsoleView'
import { ProductOrderList, useProductOrder, useSortableRow } from '@/components/admin/ProductOrderList'
import { formatMoney, formatDate, shortId, statusBadgeClass } from '@/lib/format'
import { toast } from 'sonner'
import {
  Wallet, Package, Bitcoin, LogOut, Loader2, Plus, Trash2, Pencil, Key, CheckCircle2, XCircle, Clock,
  TrendingUp, Users, ShoppingBag, AlertCircle, Copy, Search, FileText, Settings, ArrowUpCircle, ArrowDownCircle,
  Gavel, Tag, Link2, Upload, ChevronLeft, ChevronRight, MoreHorizontal, Download, MessageCircle, Type, Newspaper,
  GripVertical, ChevronUp, ChevronDown, Eye, EyeOff, UserPlus, Pin, PinOff,
} from 'lucide-react'

interface Props {
  user: User
  onUserChange: (u: User) => void
  onLogout: () => void
}

type View = 'dashboard' | 'products' | 'wallets' | 'deposits' | 'orders' | 'users' | 'support' | 'settings' | 'auctions' | 'blog' | 'coupons' | 'bidcancellations' | 'sociallinks' | 'audittrail' | 'content'

const VALID_VIEWS: View[] = ['dashboard', 'products', 'wallets', 'deposits', 'orders', 'users', 'support', 'settings', 'auctions', 'blog', 'coupons', 'bidcancellations', 'sociallinks', 'audittrail', 'content']

// Read the current view from the URL hash (e.g. #products) so it survives page reload.
// Falls back to 'dashboard' if no valid hash is present.
function getInitialView(): View {
  if (typeof window === 'undefined') return 'dashboard'
  const hash = window.location.hash.replace('#', '') as View
  return VALID_VIEWS.includes(hash) ? hash : 'dashboard'
}

export function AdminApp({ user, onUserChange, onLogout }: Props) {
  const [view, setViewRaw] = useState<View>(getInitialView)

  // Wrapper that also updates the URL hash so the view survives page reload.
  const setView = useCallback((v: View) => {
    setViewRaw(v)
    if (typeof window !== 'undefined') {
      window.location.hash = v
    }
  }, [])

  // When a user-profile modal's "Message" button is clicked, it dispatches
  // a window event with the target user's id. We switch to the Support
  // view and forward the selected user via state so the SupportConsoleView
  // can auto-open that conversation.
  const [supportInitialUserId, setSupportInitialUserId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onOpenChatWithUser(e: Event) {
      const detail = (e as CustomEvent).detail || {}
      if (detail?.userId) {
        setSupportInitialUserId(detail.userId)
        setView('support')
      }
    }
    window.addEventListener('open-chat-with-user', onOpenChatWithUser)
    return () => window.removeEventListener('open-chat-with-user', onOpenChatWithUser)
  }, [setView])
  // Support Console → "open user profile" link: switches to the Users view
  // and opens that user's profile modal (dispatched from SupportConsoleView).
  const [supportOpenUserId, setSupportOpenUserId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onOpenUserProfile(e: Event) {
      const detail = (e as CustomEvent).detail || {}
      if (detail?.userId) {
        setSupportOpenUserId(detail.userId)
        setView('users')
      }
    }
    window.addEventListener('open-user-profile', onOpenUserProfile)
    return () => window.removeEventListener('open-user-profile', onOpenUserProfile)
  }, [setView])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [wallets, setWallets] = useState<CryptoWallet[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [supportUnread, setSupportUnread] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, w, d, o, u, st] = await Promise.all([
        api.adminStats(),
        api.listProducts(true),
        api.listWallets(true),
        api.listDeposits(true),
        api.listOrders(true),
        api.adminListUsers(),
        api.getSettings(),
      ])
      setStats(s)
      setProducts(p)
      setWallets(w)
      setDeposits(d)
      setOrders(o)
      setUsers(u)
      setSettings(st)
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

  // Poll admin's total chat unread count every 30s so the sidebar badge
  // stays fresh even when the Support view isn't open. The SupportConsoleView
  // has its own faster poller while it's mounted; this is just for the
  // sidebar badge.
  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch('/api/admin/chat/conversations?filter=unread')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setSupportUnread(data?.totalUnread ?? 0)
        }
      } catch {}
    }
    tick()
    const t = setInterval(tick, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white">D</div>
          <div>
            <div className="text-sm font-bold leading-tight">DigitalVault</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Admin</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <SideButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<TrendingUp className="w-4 h-4" />} label="Dashboard" />
          <SideButton active={view === 'products'} onClick={() => setView('products')} icon={<Package className="w-4 h-4" />} label="Products" badge={products.length} />
          <SideButton active={view === 'auctions'} onClick={() => setView('auctions')} icon={<Gavel className="w-4 h-4" />} label="Special Deals" />
          <SideButton active={view === 'blog'} onClick={() => setView('blog')} icon={<Newspaper className="w-4 h-4" />} label="Blog" />
          <SideButton active={view === 'coupons'} onClick={() => setView('coupons')} icon={<Tag className="w-4 h-4" />} label="Coupons" />
          <SideButton active={view === 'wallets'} onClick={() => setView('wallets')} icon={<Bitcoin className="w-4 h-4" />} label="Crypto Wallets" badge={wallets.length} />
          <SideButton active={view === 'deposits'} onClick={() => setView('deposits')} icon={<Wallet className="w-4 h-4" />} label="Deposits" badge={stats?.pendingDeposits || undefined} />
          <SideButton active={view === 'orders'} onClick={() => setView('orders')} icon={<ShoppingBag className="w-4 h-4" />} label="Orders" badge={orders.length} />
          <SideButton active={view === 'bidcancellations'} onClick={() => setView('bidcancellations')} icon={<XCircle className="w-4 h-4" />} label="Bid Cancellations" />

          {/* SUPPORT section — chat console */}
          <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Support</div>
          <SideButton active={view === 'support'} onClick={() => setView('support')} icon={<MessageCircle className="w-4 h-4" />} label="Support" badge={supportUnread || undefined} />

          {/* SYSTEM section */}
          <div className="pt-3 pb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">System</div>
          <SideButton active={view === 'users'} onClick={() => setView('users')} icon={<Users className="w-4 h-4" />} label="Users" badge={users.length} />
          <SideButton active={view === 'sociallinks'} onClick={() => setView('sociallinks')} icon={<Link2 className="w-4 h-4" />} label="Social Links" />
          <SideButton active={view === 'audittrail'} onClick={() => setView('audittrail')} icon={<FileText className="w-4 h-4" />} label="Audit Trail" />
          <SideButton active={view === 'content'} onClick={() => setView('content')} icon={<Type className="w-4 h-4" />} label="Site Content" />
          <SideButton active={view === 'settings'} onClick={() => setView('settings')} icon={<Settings className="w-4 h-4" />} label="Settings" />
        </nav>
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 text-xs">
          <div className="text-zinc-500 mb-2">Logged in as</div>
          <div className="font-medium truncate">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full mt-3 justify-start text-zinc-500" onClick={onLogout}>
            <LogOut className="w-4 h-4 mr-2" /> Logout
          </Button>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white">D</div>
              <span className="font-bold">DigitalVault Admin</span>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout}><LogOut className="w-4 h-4" /></Button>
          </div>
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            <SideButton compact active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<TrendingUp className="w-4 h-4" />} label="Dash" />
            <SideButton compact active={view === 'products'} onClick={() => setView('products')} icon={<Package className="w-4 h-4" />} label="Products" />
            <SideButton compact active={view === 'auctions'} onClick={() => setView('auctions')} icon={<Gavel className="w-4 h-4" />} label="Deals" />
            <SideButton compact active={view === 'blog'} onClick={() => setView('blog')} icon={<Newspaper className="w-4 h-4" />} label="Blog" />
            <SideButton compact active={view === 'coupons'} onClick={() => setView('coupons')} icon={<Tag className="w-4 h-4" />} label="Coupons" />
            <SideButton compact active={view === 'wallets'} onClick={() => setView('wallets')} icon={<Bitcoin className="w-4 h-4" />} label="Wallets" />
            <SideButton compact active={view === 'deposits'} onClick={() => setView('deposits')} icon={<Wallet className="w-4 h-4" />} label="Deposits" />
            <SideButton compact active={view === 'orders'} onClick={() => setView('orders')} icon={<ShoppingBag className="w-4 h-4" />} label="Orders" />
            <SideButton compact active={view === 'bidcancellations'} onClick={() => setView('bidcancellations')} icon={<XCircle className="w-4 h-4" />} label="Cancels" />
            <SideButton compact active={view === 'support'} onClick={() => setView('support')} icon={<MessageCircle className="w-4 h-4" />} label="Support" badge={supportUnread || undefined} />
            <SideButton compact active={view === 'users'} onClick={() => setView('users')} icon={<Users className="w-4 h-4" />} label="Users" />
            <SideButton compact active={view === 'sociallinks'} onClick={() => setView('sociallinks')} icon={<Link2 className="w-4 h-4" />} label="Social" />
            <SideButton compact active={view === 'audittrail'} onClick={() => setView('audittrail')} icon={<FileText className="w-4 h-4" />} label="Logs" />
            <SideButton compact active={view === 'content'} onClick={() => setView('content')} icon={<Type className="w-4 h-4" />} label="Content" />
            <SideButton compact active={view === 'settings'} onClick={() => setView('settings')} icon={<Settings className="w-4 h-4" />} label="Settings" />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {loading && stats === null && view === 'dashboard' ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
          ) : (
            <>
              {view === 'dashboard' && <DashboardView stats={stats} deposits={deposits} orders={orders} products={products} />}
              {view === 'products' && <ProductsView products={products} loading={loading} onRefresh={refresh} />}
              {view === 'auctions' && <AuctionsView onRefresh={refresh} />}
              {view === 'blog' && <BlogView />}
              {view === 'coupons' && <CouponsView />}
              {view === 'wallets' && <WalletsView wallets={wallets} loading={loading} onRefresh={refresh} />}
              {view === 'deposits' && <AdminDepositsView deposits={deposits} loading={loading} onRefresh={refresh} />}
              {view === 'orders' && <AdminOrdersView orders={orders} loading={loading} />}
              {view === 'bidcancellations' && <BidCancellationsView />}
              {view === 'users' && <UsersView users={users} onRefresh={refresh} currentAdminId={user.id} />}
              {view === 'support' && (
                <SupportConsoleView
                  initialUserId={supportInitialUserId}
                  onConsumeInitial={() => setSupportInitialUserId(null)}
                  onUnreadChange={setSupportUnread}
                  openUserId={supportOpenUserId}
                  onConsumeOpenUser={() => setSupportOpenUserId(null)}
                />
              )}
              {view === 'sociallinks' && <SocialLinksView />}
              {view === 'audittrail' && <ActivityLog admin />}
              {view === 'content' && <SiteContentView settings={settings} onSaved={refresh} />}
              {view === 'settings' && <SettingsView settings={settings} onSaved={refresh} />}
            </>
          )}
        </main>
      </div>

      {/* Floating Support Console button — replaces the buyer chat widget for
          admins (the widget renders null for ADMIN sessions). Opens the
          Support Console view with an unread badge. */}
      {view !== 'support' && (
        <button
          onClick={() => setView('support')}
          className="fixed bottom-12 sm:bottom-14 right-5 sm:right-6 z-50 group flex items-center justify-center w-[3.6rem] h-[3.6rem] sm:w-[4.2rem] sm:h-[4.2rem] rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl ring-2 ring-emerald-600/20 transition-all hover:scale-105 hover:shadow-2xl"
          aria-label="Open chat support"
        >
          <MessageCircle className="w-6 h-6 sm:w-7 sm:h-7" />
          {supportUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1.4rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
              {supportUnread > 99 ? '99+' : supportUnread}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

function SideButton({ active, onClick, icon, label, badge, compact }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full inline-flex items-center gap-2 px-3 ${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} rounded-md font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="ml-auto inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[10px] font-bold">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function DashboardView({ stats, deposits, orders, products }: { stats: AdminStats | null; deposits: Deposit[]; orders: Order[]; products: Product[] }) {
  if (!stats) return null
  const pendingDeposits = deposits.filter((d) => d.status === 'PENDING')
  const recentOrders = orders.slice(0, 5)
  const lowStock = products.filter((p) => p.stock <= 2 && p.isActive)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-zinc-500">Overview of your marketplace activity.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Total sales" value={formatMoney(stats.totalSales)} accent="emerald" />
        <StatCard icon={<ShoppingBag className="w-5 h-5" />} label="Orders" value={stats.orders} accent="zinc" />
        <StatCard icon={<Users className="w-5 h-5" />} label="Users" value={stats.users} accent="zinc" />
        <StatCard icon={<Key className="w-5 h-5" />} label="Available keys" value={stats.availableKeys} accent="zinc" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pending deposits</CardTitle>
              <Badge variant="outline" className={pendingDeposits.length ? 'bg-amber-100 text-amber-800 border-amber-200' : ''}>
                {pendingDeposits.length} pending
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {pendingDeposits.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">No pending deposits. All caught up.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {pendingDeposits.slice(0, 5).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.user?.email}</div>
                      <div className="text-xs text-zinc-500">{d.network} · {formatDate(d.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(d.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent orders</CardTitle>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">No orders yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {recentOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{o.product?.name}</div>
                      <div className="text-xs text-zinc-500">{o.user?.email} · {formatDate(o.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{formatMoney(o.totalAmount)}</div>
                      <div className="text-xs text-zinc-500">Qty {o.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {lowStock.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Low stock alerts
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded-md bg-amber-50 dark:bg-amber-950/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{p.image || '📦'}</span>
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                    {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent: 'emerald' | 'zinc' }) {
  const accentClass = accent === 'emerald'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center mb-3 ${accentClass}`}>
          {icon}
        </div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
      </CardContent>
    </Card>
  )
}

// ----- Products view -----
function ProductsView({ products, loading, onRefresh }: { products: Product[]; loading: boolean; onRefresh: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
  const searching = search.trim().length > 0

  /**
   * Persist a new ordering. The server assigns sortOrder by array index, so it
   * must receive EVERY product id in the new order. That is exactly why the
   * reorder UI is disabled while searching — a filtered subset would renumber
   * the whole catalog around the rows the admin can’t see.
   */
  async function saveOrder(orderedIds: string[]) {
    try {
      await api.reorderProducts(orderedIds)
      toast.success('Order saved')
    } catch (e: any) {
      toast.error(e.message || 'Could not save the new order')
      // Server order is authoritative — pull it back so the card snaps to the
      // order the buyer is actually seeing.
      onRefresh()
    }
  }

  async function savePin(id: string, pinned: boolean) {
    try {
      await api.pinProduct(id, pinned)
      toast.success(pinned ? 'Pinned to top of the storefront' : 'Unpinned')
      onRefresh()
    } catch (e: any) {
      toast.error(e.message || 'Could not update pin')
      // Rethrow so the list rolls its optimistic change back.
      throw e
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-zinc-500">List, edit, and stock your digital assets.</p>
        </div>
        <CreateProductDialog onCreated={onRefresh} />
      </div>
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {searching && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2">
          Searching — clear the box to reorder or pin. Reordering a filtered list
          would renumber the products you can’t see.
        </p>
      )}

      {loading && products.length === 0 ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-zinc-500">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No products yet. Click &quot;New product&quot; to create one.</p>
          </CardContent>
        </Card>
      ) : searching ? (
        // Ordering is off while filtering — see saveOrder() above.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <AdminProductCard key={p.id} product={p} onRefresh={onRefresh} />
          ))}
        </div>
      ) : (
        <ProductOrderList
          products={filtered}
          onReorder={saveOrder}
          onPin={savePin}
          onPinSuccess={onRefresh}
        >
          {(p) => <ProductOrderCard key={p.id} product={p} onRefresh={onRefresh} />}
        </ProductOrderList>
      )}
    </div>
  )
}

function CreateProductDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [useRichText, setUseRichText] = useState(false)
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [image, setImage] = useState('')
  const [keys, setKeys] = useState('')
  const [metadataFields, setMetadataFields] = useState<Array<{ name: string; value: string }>>([])
  const [deliveryFormat, setDeliveryFormat] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName(''); setDescription(''); setUseRichText(false); setCategory(''); setPrice(''); setImage(''); setKeys(''); setMetadataFields([]); setDeliveryFormat('')
  }

  function addMetadataField() {
    setMetadataFields([...metadataFields, { name: '', value: '' }])
  }

  function updateMetadataField(index: number, field: 'name' | 'value', val: string) {
    setMetadataFields(metadataFields.map((f, i) => i === index ? { ...f, [field]: val } : f))
  }

  function removeMetadataField(index: number) {
    setMetadataFields(metadataFields.filter((_, i) => i !== index))
  }

  async function submit() {
    if (!name) { toast.error('Name is required'); return }
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) { toast.error('Enter a valid price'); return }
    // Filter out empty metadata fields
    const cleanMetadata = metadataFields.filter(f => f.name.trim() && f.value.trim())
    setSubmitting(true)
    try {
      await api.createProduct({
        name,
        description,
        renderHtml: useRichText,
        category: category || 'General',
        metadata: cleanMetadata.length > 0 ? cleanMetadata : undefined,
        deliveryFormat: deliveryFormat.trim() || undefined,
        price: p,
        image: image || undefined,
        keys,
      })
      toast.success('Product created')
      setOpen(false)
      reset()
      onCreated()
    } catch (e: any) {
      toast.error(e.message || 'Failed to create product')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4" /> New product
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create product</DialogTitle>
          <DialogDescription>List a new digital asset. You can add license keys now or later.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Product name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Windows 11 Pro License" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Software" />
            </div>
            <div className="space-y-2">
              <Label>Price (USD) *</Label>
              <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="19.99" />
            </div>
          </div>

          {/* Image uploader — replaces the old plain text input */}
          <ImageUploader value={image} onChange={setImage} label="Product image" />

          {/* Custom metadata repeater */}
          <div className="space-y-2">
            <Label>Custom metadata</Label>
            <p className="text-xs text-zinc-500">Add custom fields shown under the product title (e.g. Platform, Delivery type, Region).</p>
            {metadataFields.length > 0 && (
              <div className="space-y-2">
                {metadataFields.map((field, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={field.name}
                      onChange={(e) => updateMetadataField(i, 'name', e.target.value)}
                      placeholder="Key (e.g. Platform)"
                      className="flex-1 h-9 text-sm"
                    />
                    <Input
                      value={field.value}
                      onChange={(e) => updateMetadataField(i, 'value', e.target.value)}
                      placeholder="Value (e.g. Discord)"
                      className="flex-1 h-9 text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeMetadataField(i)}
                      className="h-9 w-9 shrink-0 text-red-600 border-red-300 hover:bg-red-50"
                      aria-label="Remove field"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addMetadataField}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add another
            </Button>
          </div>

          {/* Description — rich text editor (with toggle) or plain textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRichText}
                  onChange={(e) => setUseRichText(e.target.checked)}
                  className="rounded"
                />
                Rich text (HTML)
              </label>
            </div>
            {useRichText ? (
              <RichTextEditor value={description} onChange={setDescription} placeholder="Describe your product with rich formatting…" rows={5} />
            ) : (
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your product..." />
            )}
          </div>

          {/* Delivery format — short text shown to buyer before purchase */}
          <div className="space-y-2">
            <Label>Delivery format</Label>
            <Input
              value={deliveryFormat}
              onChange={(e) => setDeliveryFormat(e.target.value)}
              placeholder="uid:email:pass"
              className="font-mono text-sm"
            />
            <p className="text-xs text-zinc-500">Shown to the buyer before purchase so they know what they'll get.</p>
          </div>

          {/* Delivery entries (one per line = one unit of stock) */}
          <div className="space-y-2">
            <Label>Delivery entries (one per line, optional)</Label>
            <Textarea rows={5} value={keys} onChange={(e) => setKeys(e.target.value)} placeholder={'uid:email:pass\nuid:email:pass'} className="font-mono text-xs" />
            <p className="text-xs text-zinc-500">Paste one delivery entry per line. Example: <code>uid:email:pass</code>. Each line becomes one unit of stock. Use the &quot;Upload&quot; button on the product card later to add more.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Create product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Ordering chrome for one product row: drag handle, pin toggle and the
 * ↑/↓ arrows that replace dragging on touch screens.
 *
 * Separate from AdminProductCard because it is only mounted inside
 * <ProductOrderList> — useSortable() throws outside a DndContext, and the same
 * card is also rendered plain while the search box is active.
 */
function ProductOrderCard({ product, onRefresh }: { product: Product; onRefresh: () => void }) {
  const { setNodeRef, style, dragHandleProps, isDragging } = useSortableRow(product.id)
  const { pinBusyId, togglePin, moveBy, canMoveUp, canMoveDown } = useProductOrder()
  const pinned = !!product.pinned
  const pinBusy = pinBusyId === product.id

  const chrome = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        {...dragHandleProps}
        aria-label={`Reorder ${product.name}`}
        title="Drag to reorder"
        className="rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        onClick={() => togglePin(product.id)}
        disabled={pinBusy}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${product.name}` : `Pin ${product.name} to top`}
        title={pinned ? 'Unpin — returns to its manual position' : 'Pin to top of the storefront'}
        className={
          'rounded p-1 transition-colors disabled:opacity-50 ' +
          (pinned
            ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            : 'text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400')
        }
      >
        {pinned ? <Pin className="w-4 h-4 fill-current" /> : <PinOff className="w-4 h-4" />}
      </button>
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => moveBy(product.id, -1)}
          disabled={!canMoveUp(product.id)}
          aria-label={`Move ${product.name} up`}
          className="rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-400"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => moveBy(product.id, 1)}
          disabled={!canMoveDown(product.id)}
          aria-label={`Move ${product.name} down`}
          className="rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-80' : undefined}>
      <AdminProductCard
        product={product}
        onRefresh={onRefresh}
        pinned={pinned}
        orderChrome={chrome}
      />
    </div>
  )
}

function AdminProductCard({
  product,
  onRefresh,
  pinned,
  orderChrome,
}: {
  product: Product
  onRefresh: () => void
  pinned?: boolean
  orderChrome?: React.ReactNode
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [entriesMode, setEntriesMode] = useState<'all' | 'available' | 'sold' | null>(null)
  const [keyStats, setKeyStats] = useState({ total: 0, available: 0, sold: 0 })

  // Fetch key stats for the stat buttons
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/products/${product.id}/keys?status=all`)
        if (res.ok) {
          const data = await res.json()
          const keys = data.keys || []
          if (mounted) {
            const total = keys.length
            const available = keys.filter((k: any) => k.status === 'AVAILABLE').length
            const sold = keys.filter((k: any) => k.status === 'SOLD').length
            setKeyStats({ total, available, sold })
          }
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [product.id, keysOpen, entriesMode])

  const totalKeys = keyStats.total
  const soldCount = keyStats.sold

  async function toggleActive() {
    try {
      await api.updateProduct(product.id, { isActive: !product.isActive })
      toast.success(`Product ${product.isActive ? 'hidden' : 'shown'}`)
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${product.name}"? This also deletes its keys and cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.deleteProduct(product.id)
      toast.success('Product deleted')
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className={pinned ? 'ring-2 ring-emerald-500 dark:ring-emerald-400' : undefined}>
      <div className="aspect-video bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-950/40 dark:to-zinc-900 flex items-center justify-center text-5xl rounded-t-lg overflow-hidden relative">
        {product.image ? (
          (product.image.startsWith('http://') || product.image.startsWith('https://') || product.image.startsWith('/')) ? (
            <Image
              src={product.image}
              alt={product.name}
              fill
              sizes="360px"
              className="w-full h-full object-cover"
              unoptimized={product.image.startsWith('http')}
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement
                target.style.display = 'none'
                target.parentElement!.innerHTML = '<span>📦</span>'
              }}
            />
          ) : (
            <span>{product.image}</span>
          )
        ) : (
          <span>📦</span>
        )}
      </div>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{product.name}</CardTitle>
            <CardDescription className="text-xs">{product.category}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            {pinned && (
              <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40">
                Pinned
              </Badge>
            )}
            <Badge variant="outline" className={product.isActive ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400' : 'border-zinc-300 text-zinc-500'}>
              {product.isActive ? 'Active' : 'Hidden'}
            </Badge>
          </div>
        </div>
        {orderChrome && (
          <div className="flex items-center justify-end gap-2 -mt-1">{orderChrome}</div>
        )}
      </CardHeader>
      <CardContent className="pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(product.price)}</span>
          <span className="text-xs text-zinc-500">· {product.stock} in stock</span>
        </div>
      </CardContent>

      {/* Stat buttons — clickable to open the entries modal with the right filter */}
      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEntriesMode('all')} className="h-7 text-xs">
            Total Upload <span className="ml-1 font-bold text-zinc-700 dark:text-zinc-300">{totalKeys}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEntriesMode('available')} className="h-7 text-xs">
            Stock <span className="ml-1 font-bold text-emerald-600 dark:text-emerald-400">{product.stock}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEntriesMode('sold')} className="h-7 text-xs">
            Sold <span className="ml-1 font-bold text-zinc-500">{soldCount}</span>
          </Button>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 pt-0">
        <Button variant="outline" size="sm" onClick={() => setKeysOpen(true)}>
          <Upload className="w-3.5 h-3.5 mr-1" /> Upload
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={toggleActive}>
          {product.isActive ? 'Hide' : 'Show'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </CardFooter>

      <EditProductDialog product={product} open={editOpen} setOpen={setEditOpen} onSaved={onRefresh} />
      <KeysDialog product={product} open={keysOpen} setOpen={setKeysOpen} onRefresh={onRefresh} />
      {entriesMode && (
        <EntriesModal
          product={product}
          mode={entriesMode}
          open={!!entriesMode}
          onClose={() => setEntriesMode(null)}
          onRefresh={onRefresh}
        />
      )}
    </Card>
  )
}

function EditProductDialog({ product, open, setOpen, onSaved }: { product: Product; open: boolean; setOpen: (v: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description ?? '')
  const [useRichText, setUseRichText] = useState(!!product.renderHtml)
  const [category, setCategory] = useState(product.category)
  const [price, setPrice] = useState(String(product.price))
  const [image, setImage] = useState(product.image ?? '')
  const [metadataFields, setMetadataFields] = useState<Array<{ name: string; value: string }>>([])
  const [deliveryFormat, setDeliveryFormat] = useState(product.deliveryFormat ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(product.name)
      setDescription(product.description ?? '')
      setUseRichText(!!product.renderHtml)
      setCategory(product.category)
      setPrice(String(product.price))
      setImage(product.image ?? '')
      setDeliveryFormat(product.deliveryFormat ?? '')
      // Parse existing metadata
      try {
        const parsed = product.metadata ? JSON.parse(product.metadata) : []
        setMetadataFields(Array.isArray(parsed) ? parsed : [])
      } catch {
        setMetadataFields([])
      }
    }
  }, [open, product])

  function addMetadataField() {
    setMetadataFields([...metadataFields, { name: '', value: '' }])
  }

  function updateMetadataField(index: number, field: 'name' | 'value', val: string) {
    setMetadataFields(metadataFields.map((f, i) => i === index ? { ...f, [field]: val } : f))
  }

  function removeMetadataField(index: number) {
    setMetadataFields(metadataFields.filter((_, i) => i !== index))
  }

  async function save() {
    const p = parseFloat(price)
    if (!name || isNaN(p)) { toast.error('Name and valid price required'); return }
    const cleanMetadata = metadataFields.filter(f => f.name.trim() && f.value.trim())
    setSubmitting(true)
    try {
      await api.updateProduct(product.id, {
        name,
        description: description || undefined,
        renderHtml: useRichText,
        category: category || 'General',
        metadata: cleanMetadata,
        deliveryFormat: deliveryFormat.trim() || undefined,
        price: p,
        image: image || undefined,
      })
      toast.success('Product updated')
      setOpen(false)
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit product</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Price (USD)</Label>
              <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>

          {/* Image uploader */}
          <ImageUploader value={image} onChange={setImage} label="Product image" />

          {/* Custom metadata repeater */}
          <div className="space-y-2">
            <Label>Custom metadata</Label>
            <p className="text-xs text-zinc-500">Add custom fields shown under the product title (e.g. Platform, Delivery type, Region).</p>
            {metadataFields.length > 0 && (
              <div className="space-y-2">
                {metadataFields.map((field, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={field.name}
                      onChange={(e) => updateMetadataField(i, 'name', e.target.value)}
                      placeholder="Key (e.g. Platform)"
                      className="flex-1 h-9 text-sm"
                    />
                    <Input
                      value={field.value}
                      onChange={(e) => updateMetadataField(i, 'value', e.target.value)}
                      placeholder="Value (e.g. Discord)"
                      className="flex-1 h-9 text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeMetadataField(i)}
                      className="h-9 w-9 shrink-0 text-red-600 border-red-300 hover:bg-red-50"
                      aria-label="Remove field"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addMetadataField}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add another
            </Button>
          </div>

          {/* Delivery format — short text shown to buyer before purchase */}
          <div className="space-y-2">
            <Label>Delivery format</Label>
            <Input
              value={deliveryFormat}
              onChange={(e) => setDeliveryFormat(e.target.value)}
              placeholder="uid:email:pass"
              className="font-mono text-sm"
            />
            <p className="text-xs text-zinc-500">Shown to the buyer before purchase so they know what they'll get.</p>
          </div>

          {/* Description — rich text editor (with toggle) or plain textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRichText}
                  onChange={(e) => setUseRichText(e.target.checked)}
                  className="rounded"
                />
                Rich text (HTML)
              </label>
            </div>
            {useRichText ? (
              <RichTextEditor value={description} onChange={setDescription} placeholder="Describe your product with rich formatting…" rows={5} />
            ) : (
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your product..." />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KeysDialog({ product, open, setOpen, onRefresh }: { product: Product; open: boolean; setOpen: (v: boolean) => void; onRefresh: () => void }) {
  // Mode toggle: 'single' = one textarea + auto-today date; 'multiple' = N
  // batch rows each with their own date/price/textarea.
  const [mode, setMode] = useState<'single' | 'multiple'>('single')
  // Single-batch form state
  const [singleKeys, setSingleKeys] = useState('')
  // Multi-batch form state — array of { label, priceOverride, keys }
  type BatchForm = { label: string; priceOverride: string; keys: string }
  const [batches, setBatches] = useState<BatchForm[]>([{ label: '', priceOverride: '', keys: '' }])
  const [submitting, setSubmitting] = useState(false)

  // Today's date in MM/DD/YY — used as the default for the single-batch mode.
  function todayLabel() {
    const d = new Date()
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
  }

  function reset() {
    setMode('single')
    setSingleKeys('')
    setBatches([{ label: '', priceOverride: '', keys: '' }])
  }

  // When the dialog opens, reset the form to a clean state.
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function addBatchRow() {
    setBatches((b) => [...b, { label: '', priceOverride: '', keys: '' }])
  }

  function removeBatchRow(idx: number) {
    setBatches((b) => b.filter((_, i) => i !== idx))
  }

  function updateBatch(idx: number, patch: Partial<BatchForm>) {
    setBatches((b) => b.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }

  async function upload() {
    setSubmitting(true)
    try {
      let payload: any
      if (mode === 'single') {
        if (!singleKeys.trim()) {
          toast.error('No keys entered')
          setSubmitting(false)
          return
        }
        // Single batch — backwards-compatible payload shape. Server labels
        // it with today's date automatically.
        payload = { keys: singleKeys }
      } else {
        // Multiple batches — normalize the rows before sending.
        const cleaned = batches
          .map((b) => ({
            label: b.label.trim(),
            priceOverride: b.priceOverride === '' ? null : Number(b.priceOverride),
            keys: b.keys,
          }))
          .filter((b) => b.keys.trim().length > 0)

        if (cleaned.length === 0) {
          toast.error('Add at least one batch with keys')
          setSubmitting(false)
          return
        }
        for (const b of cleaned) {
          if (!b.label) {
            toast.error('Each batch needs a date label (MM/DD/YY)')
            setSubmitting(false)
            return
          }
          if (b.priceOverride !== null && (isNaN(b.priceOverride) || b.priceOverride < 0)) {
            toast.error(`Batch "${b.label}" has an invalid price`)
            setSubmitting(false)
            return
          }
        }
        payload = { batches: cleaned }
      }

      const res = await fetch(`/api/admin/products/${product.id}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `${data.added} entries added`)
        reset()
        onRefresh()
        setOpen(false)
      } else {
        toast.error(data?.error || 'Failed to add entries')
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to add entries')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> Delivery entries · {product.name}
          </DialogTitle>
          <DialogDescription>
            Upload delivery entries grouped by date-labeled batches. Each batch can have its own price override.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 rounded-md bg-zinc-100 dark:bg-zinc-800 w-fit">
            <button
              onClick={() => setMode('single')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${mode === 'single' ? 'bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 shadow-sm' : 'text-zinc-500'}`}
            >
              Single batch
            </button>
            <button
              onClick={() => setMode('multiple')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${mode === 'multiple' ? 'bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 shadow-sm' : 'text-zinc-500'}`}
            >
              Multiple batches
            </button>
          </div>

          {mode === 'single' ? (
            <div className="space-y-2">
              <Label>Upload delivery entries (one per line)</Label>
              <Textarea
                rows={6}
                value={singleKeys}
                onChange={(e) => setSingleKeys(e.target.value)}
                placeholder={'uid:email:pass\nuid:email:pass'}
                className="font-mono text-xs"
              />
              <p className="text-xs text-zinc-500">
                Date label will default to today ({todayLabel()}). Price falls back to the product&apos;s price ({formatMoney(product.price)}).
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {batches.map((b, idx) => (
                <div key={idx} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2 bg-zinc-50/50 dark:bg-zinc-900/40">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-500 shrink-0">Batch {idx + 1}</span>
                    {batches.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-6 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-2"
                        onClick={() => removeBatchRow(idx)}
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Date (MM/DD/YY)</Label>
                      <Input
                        type="text"
                        value={b.label}
                        onChange={(e) => updateBatch(idx, { label: e.target.value })}
                        placeholder="10/05/25"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Price override (optional)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={b.priceOverride}
                        onChange={(e) => updateBatch(idx, { priceOverride: e.target.value })}
                        placeholder={`Default: ${formatMoney(product.price)}`}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Entries (one per line)</Label>
                    <Textarea
                      rows={3}
                      value={b.keys}
                      onChange={(e) => updateBatch(idx, { keys: e.target.value })}
                      placeholder={'uid:email:pass\nuid:email:pass'}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBatchRow}
                className="w-full border-dashed"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add another batch
              </Button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={upload} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Upload entries
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ----- Wallets view -----
function WalletsView({ wallets, loading, onRefresh }: { wallets: CryptoWallet[]; loading: boolean; onRefresh: () => void }) {
  const [network, setNetwork] = useState('')
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function add() {
    if (!network || !address) { toast.error('Network and address required'); return }
    setSubmitting(true)
    try {
      await api.createWallet({ network, address, label: label || undefined })
      toast.success('Wallet added')
      setNetwork(''); setAddress(''); setLabel('')
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function toggle(w: CryptoWallet) {
    try {
      await api.updateWallet(w.id, { isActive: !w.isActive })
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function remove(w: CryptoWallet) {
    if (!confirm(`Delete wallet ${w.network} - ${w.address.slice(0, 10)}...?`)) return
    try {
      await api.deleteWallet(w.id)
      toast.success('Wallet removed')
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Crypto Wallets</h1>
        <p className="text-sm text-zinc-500">Add or remove wallets that buyers can send deposits to.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add new wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label>Network</Label>
              <Input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="USDT-TRC20" />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Wallet address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="TJYjsWqz..." className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Primary" />
            </div>
          </div>
          <Button onClick={add} disabled={submitting} className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            Add wallet
          </Button>
        </CardContent>
      </Card>

      {loading && wallets.length === 0 ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : wallets.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-zinc-500">
            <Bitcoin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No wallets yet. Add one above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {wallets.map((w) => (
            <Card key={w.id} className={!w.isActive ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                      <Bitcoin className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold">{w.network}</div>
                      {w.label && <div className="text-xs text-zinc-500">{w.label}</div>}
                    </div>
                  </div>
                  <Badge variant="outline" className={w.isActive ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400' : ''}>
                    {w.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 rounded-md p-2 mb-3">
                  <code className="text-xs font-mono break-all flex-1">{w.address}</code>
                  <CopyButton value={w.address} label="" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggle(w)}>
                    <span className={`inline-block w-3 h-3 rounded-full ${w.isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                    <span className="ml-1">{w.isActive ? 'Disable' : 'Enable'}</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => remove(w)} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ----- Admin deposits view -----
function AdminDepositsView({ deposits, loading, onRefresh }: { deposits: Deposit[]; loading: boolean; onRefresh: () => void }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const filtered = deposits.filter((d) => filter === 'all' || d.status.toLowerCase() === filter)

  async function process(d: Deposit, action: 'approve' | 'reject') {
    const adminNote = action === 'reject'
      ? prompt('Reason for rejection (optional):') ?? ''
      : ''
    try {
      await api.processDeposit(d.id, action, adminNote || undefined)
      toast.success(`Deposit ${action === 'approve' ? 'approved — balance credited' : 'rejected'}`)
      onRefresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Deposits</h1>
          <p className="text-sm text-zinc-500">Review buyer deposit requests and approve / reject them.</p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading && deposits.length === 0 ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-zinc-500">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No deposits to show.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => {
            const isDebit = d.type === 'ADMIN_DEBIT'
            const isAdminAdj = d.type === 'ADMIN_CREDIT' || d.type === 'ADMIN_DEBIT'
            return (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold ${isDebit ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isDebit ? '-' : '+'}{formatMoney(d.amount)}
                      </span>
                      {d.type === 'ADMIN_CREDIT' && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
                          <ArrowUpCircle className="w-3 h-3 mr-1" /> Admin credit
                        </Badge>
                      )}
                      {d.type === 'ADMIN_DEBIT' && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                          <ArrowDownCircle className="w-3 h-3 mr-1" /> Admin debit
                        </Badge>
                      )}
                      {(!d.type || d.type === 'CRYPTO') && (
                        <Badge variant="outline">{d.network}</Badge>
                      )}
                      <Badge variant="outline" className={statusBadgeClass(d.status)}>
                        <span className="inline-flex items-center gap-1">
                          {d.status === 'APPROVED' && <CheckCircle2 className="w-3 h-3" />}
                          {d.status === 'PENDING' && <Clock className="w-3 h-3" />}
                          {d.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                          {d.status}
                        </span>
                      </Badge>
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      From <span className="font-medium">{d.user?.email}</span> {d.user?.name ? `(${d.user.name})` : ''}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {formatDate(d.createdAt)} · Deposit #{shortId(d.id)}
                    </div>
                    {d.wallet && !isAdminAdj && (
                      <div className="text-xs text-zinc-500 mt-1">
                        To wallet: <code className="font-mono">{d.wallet.address.slice(0, 24)}…</code>
                      </div>
                    )}
                    {d.txHash && (
                      <div className="text-xs text-zinc-500 mt-1">
                        Tx: <code className="font-mono">{d.txHash}</code>
                        <CopyButton value={d.txHash} label="Copy" />
                      </div>
                    )}
                    {d.note && (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
                        Note: {d.note}
                      </div>
                    )}
                    {d.adminNote && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                        Admin note: {d.adminNote}
                      </div>
                    )}
                  </div>
                  {d.status === 'PENDING' && !isAdminAdj && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => process(d, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => process(d, 'reject')} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ----- Admin orders view -----
function AdminOrdersView({ orders, loading }: { orders: Order[]; loading: boolean }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize] = useState(50)
  const [ordersData, setOrdersData] = useState<Order[]>(orders)
  const [loadingData, setLoadingData] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const load = useCallback(async () => {
    setLoadingData(true)
    try {
      const params = new URLSearchParams()
      params.set('admin', '1')
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/orders?${params.toString()}`)
      const data = await res.json()
      setOrdersData(data.orders || [])
      setTotal(data.total || 0)
    } catch {
      toast.error('Failed to load orders')
    } finally {
      setLoadingData(false)
    }
  }, [search, statusFilter, page, pageSize])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => { setPage(1) }, [search, statusFilter])

  function exportCSV() {
    const headers = ['Date', 'Buyer Email', 'Buyer Name', 'Product', 'Batch', 'Qty', 'Total', 'Order #', 'Status', 'Keys']
    const lines = [headers.join(',')]
    for (const o of ordersData) {
      const keys = (o.keys || []).map(k => k.key).join('; ')
      lines.push([
        new Date(o.createdAt).toISOString(),
        `"${o.user?.email || ''}"`,
        `"${o.user?.name || ''}"`,
        `"${o.product?.name || ''}"`,
        `"${o.batch?.label || ''}"`,
        o.quantity,
        o.totalAmount,
        o.shortId ? `#${o.shortId}` : o.id.slice(0, 8),
        o.status,
        `"${keys.replace(/"/g, '""')}"`,
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function orderStatusLabel(s: string): { label: string; color: string } {
    switch (s) {
      case 'COMPLETED': return { label: '🟢 Delivered', color: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400' }
      case 'PENDING': return { label: '🟡 Pending', color: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400' }
      case 'REFUNDED': return { label: '🔵 Refunded', color: 'border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400' }
      case 'DISPUTED': return { label: '🔴 Disputed', color: 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400' }
      case 'CANCELLED': return { label: '⚫ Cancelled', color: 'border-zinc-300 text-zinc-500' }
      case 'FAILED': return { label: '🔴 Failed', color: 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400' }
      default: return { label: s, color: 'border-zinc-300 text-zinc-500' }
    }
  }

  const totalPages = Math.ceil(total / pageSize) || 1

  if (loading && orders.length === 0) {
    return <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-zinc-500">All completed purchases and delivered keys.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="w-4 h-4 mr-1" /> CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            placeholder="Search by email, product, or order #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">🟢 Delivered</SelectItem>
            <SelectItem value="pending">🟡 Pending</SelectItem>
            <SelectItem value="refunded">🔵 Refunded</SelectItem>
            <SelectItem value="disputed">🔴 Disputed</SelectItem>
            <SelectItem value="cancelled">⚫ Cancelled</SelectItem>
            <SelectItem value="failed">🔴 Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loadingData ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : ordersData.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-zinc-500">
          <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No orders found.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Buyer</th>
                  <th className="text-left px-4 py-3">Product</th>
                  <th className="text-left px-4 py-3">Batch</th>
                  <th className="text-left px-4 py-3">Qty</th>
                  <th className="text-left px-4 py-3">Total</th>
                  <th className="text-left px-4 py-3">Order #</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Keys</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {ordersData.map((o) => {
                  const st = orderStatusLabel(o.status)
                  return (
                    <tr key={o.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDate(o.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toast.info(`Go to Users → click ${o.user?.email} to view profile`)} className="text-emerald-600 hover:underline text-left">
                          {o.user?.email}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <a href={`/product-details-page?id=${o.productId}`} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 hover:underline">
                          {o.product?.name}
                        </a>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {o.batch?.label ? (
                          <Badge variant="outline" className="text-[10px] border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 font-mono">
                            {o.batch.label}
                          </Badge>
                        ) : (
                          <span className="text-zinc-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{o.quantity}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(o.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <span title={o.id} className="cursor-help">
                          <code className="text-xs font-mono">#{o.shortId ?? o.id.slice(0, 8)}</code>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {o.keys && o.keys.length > 0 ? (
                          <button onClick={() => setSelectedOrder(o)} className="text-emerald-600 hover:underline cursor-pointer text-xs">
                            {o.keys.length} key{o.keys.length > 1 ? 's' : ''}
                          </button>
                        ) : (
                          <span className="text-zinc-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} orders</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loadingData}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-3 py-1.5 text-xs">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingData}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delivered keys modal */}
      {selectedOrder && (
        <Dialog open onOpenChange={(v) => { if (!v) setSelectedOrder(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Order #{selectedOrder.shortId ?? selectedOrder.id.slice(0, 8)} — Delivered Keys</DialogTitle>
              <DialogDescription>
                {selectedOrder.product?.name} · Delivered on {formatDate(selectedOrder.createdAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {selectedOrder.keys?.map((k) => (
                <div key={k.id} className="flex items-center gap-2 p-3 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <Key className="w-4 h-4 text-zinc-400 shrink-0" />
                  <code className="text-xs font-mono flex-1 break-all">{k.key}</code>
                  <CopyButton value={k.key} label="" />
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ----- Users view -----
function UsersView({ users: initialUsers, onRefresh, currentAdminId }: { users: any[]; onRefresh: () => void; currentAdminId: string }) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [usersData, setUsersData] = useState<any[]>(initialUsers)
  const [loadingData, setLoadingData] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Support Console → "open user profile" link. AdminApp switches to the
  // Users view and forwards the user id via this window event.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onOpenUserProfile(e: Event) {
      const detail = (e as CustomEvent).detail || {}
      if (detail?.userId) setProfileUserId(detail.userId)
    }
    window.addEventListener('open-user-profile', onOpenUserProfile)
    return () => window.removeEventListener('open-user-profile', onOpenUserProfile)
  }, [])

  const load = useCallback(async () => {
    setLoadingData(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (roleFilter !== 'all') params.set('role', roleFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (sort) params.set('sort', sort)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/admin/users?${params.toString()}`)
      const data = await res.json()
      setUsersData(data.users || [])
      setTotal(data.total || 0)
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoadingData(false)
    }
  }, [search, roleFilter, statusFilter, sort, page, pageSize])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => { setPage(1) }, [search, roleFilter, statusFilter, sort])

  function toggleSelected(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === usersData.length) setSelected(new Set())
    else setSelected(new Set(usersData.map((u) => u.id)))
  }

  async function bulkStatus(status: string) {
    for (const id of selected) {
      try {
        await fetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id, status }),
        })
      } catch {}
    }
    toast.success(`Updated ${selected.size} user(s) to ${status}`)
    setSelected(new Set())
    await load()
    onRefresh()
  }

  async function changeStatus(userId: string, status: string) {
    try {
      await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status }),
      })
      toast.success(`User status changed to ${status}`)
      await load()
      onRefresh()
    } catch {
      toast.error('Failed to change status')
    }
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    try {
      await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' })
      toast.success('User deleted')
      await load()
      onRefresh()
    } catch {
      toast.error('Failed to delete user')
    }
  }

  function statusBadge(status: string) {
    switch (status) {
      case 'ACTIVE': return <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">🟢 Active</Badge>
      case 'MUTED': return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">🟡 Muted</Badge>
      case 'BANNED': return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 bg-red-50 dark:bg-red-950/30">🔴 Banned</Badge>
      case 'PENDING': return <Badge variant="outline" className="text-[10px] border-zinc-300 text-zinc-500">⚪ Pending</Badge>
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>
    }
  }

  const totalPages = Math.ceil(total / pageSize) || 1

  // The header (and its "New user" action) always renders — even while the
  // users list is still loading or empty — so the action is never hidden by
  // the data fetch. The loading/empty state lives in the table area below.
  //
  // The action lives in its own tinted card with an opaque background and
  // sticks to the top on desktop (md+), so it stays on screen while scrolling
  // a long user list. It is deliberately NOT sticky on mobile: the compact
  // admin nav up there is already sticky, and stacking two sticky rows would
  // hide the button instead of showing it.
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between md:sticky md:top-0 md:z-20 dark:border-emerald-900/60 dark:bg-emerald-950">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            All registered users. Use <span className="font-semibold text-emerald-700 dark:text-emerald-300">New user</span> to create an account manually.
          </p>
        </div>
        <Button
          size="lg"
          className="w-full shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm sm:ml-auto sm:w-auto"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus className="w-4 h-4 mr-1" /> New user
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            placeholder="Search email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-32" aria-label="Filter by role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="buyer">Buyer</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">🟢 Active</SelectItem>
            <SelectItem value="muted">🟡 Muted</SelectItem>
            <SelectItem value="banned">🔴 Banned</SelectItem>
            <SelectItem value="pending">⚪ Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Sort">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="balance">Highest balance</SelectItem>
            <SelectItem value="orders">Most orders</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={() => bulkStatus('MUTED')} className="h-7 text-xs border-amber-300 text-amber-700">Mute</Button>
          <Button variant="outline" size="sm" onClick={() => bulkStatus('BANNED')} className="h-7 text-xs border-red-300 text-red-700">Ban</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="h-7 text-xs ml-auto">✕ Clear</Button>
        </div>
      )}

      {/* Table */}
      {loadingData ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : usersData.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-zinc-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No users found.</p>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white mt-4"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="w-4 h-4 mr-1" /> New user
          </Button>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500 sticky top-0">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={selected.size === usersData.length && usersData.length > 0} onChange={toggleAll} className="w-4 h-4 accent-emerald-600" />
                  </th>
                  <th className="text-left px-3 py-3">Email</th>
                  <th className="text-left px-3 py-3">Name</th>
                  <th className="text-left px-3 py-3">Role</th>
                  <th className="text-left px-3 py-3">Status</th>
                  <th className="text-left px-3 py-3">Balance</th>
                  <th className="text-left px-3 py-3">Orders</th>
                  <th className="text-left px-3 py-3">Joined</th>
                  <th className="text-left px-3 py-3">⋯</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {usersData.map((u) => (
                  <tr key={u.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${selected.has(u.id) ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelected(u.id)} className="w-4 h-4 accent-emerald-600" />
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => setProfileUserId(u.id)} className="text-emerald-600 hover:underline font-medium">{u.email}</button>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => setProfileUserId(u.id)} className="hover:text-emerald-600 hover:underline">{u.name || '—'}</button>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={u.role === 'ADMIN' ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400' : ''}>{u.role}</Badge>
                    </td>
                    <td className="px-3 py-3">{statusBadge(u.status)}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => setProfileUserId(u.id)} className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">{formatMoney(u.balance)}</button>
                    </td>
                    <td className="px-3 py-3">{u._count?.orders ?? 0}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => setProfileUserId(u.id)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="View profile">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} users</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loadingData}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-3 py-1.5 text-xs">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingData}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* User profile modal */}
      {profileUserId && (
        <UserProfileModal userId={profileUserId} currentAdminId={currentAdminId} onClose={() => setProfileUserId(null)} onRefresh={() => { load(); onRefresh() }} />
      )}

      {/* New user modal */}
      {addOpen && (
        <AddMemberModal onClose={() => setAddOpen(false)} onCreated={() => { load(); onRefresh() }} />
      )}
    </div>
  )
}

// ----- New user modal -----
// Manually create a user account. The password is hashed server-side and the
// new account skips the profile-setup gate. When "send welcome email" is
// checked the API returns a one-time set-password link for the admin to share
// (no SMTP is configured, so nothing is sent automatically and the plaintext
// password is never emailed).
function AddMemberModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<'BUYER' | 'VENDOR' | 'ADMIN'>('BUYER')
  const [status, setStatus] = useState<'ACTIVE' | 'PENDING'>('ACTIVE')
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [setupUrl, setSetupUrl] = useState<string | null>(null)

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const passwordsMatch = confirm.length > 0 && password === confirm
  const canSubmit = name.trim().length > 0 && emailOk && password.length >= 6 && passwordsMatch && !submitting

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Display name is required'); return }
    if (!emailOk) { setError('Please enter a valid email'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setSubmitting(true)
    try {
      const res = await api.adminCreateUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        status,
        sendWelcomeEmail,
      })
      toast.success(`User ${res.user?.email ?? email} created`)
      onCreated()
      if (res.setupUrl) {
        setSetupUrl(res.setupUrl)
      } else {
        onClose()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Create a user account manually.</DialogDescription>
        </DialogHeader>

        {setupUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Account created. Share this one-time set-password link with the user so they can choose their own password. It expires in 7 days and can only be used once.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={setupUrl} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={setupUrl} />
            </div>
            <p className="text-xs text-zinc-500">Email delivery isn&apos;t configured, so nothing was sent automatically.</p>
            <div className="flex justify-end">
              <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700 text-white">Done</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="am-name">Display name *</Label>
              <Input id="am-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="am-email">Email *</Label>
              <Input id="am-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="am-password">Password *</Label>
              <div className="relative">
                <Input id="am-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" className="pr-10" />
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
            <div className="space-y-1.5">
              <Label htmlFor="am-confirm">Confirm password *</Label>
              <Input id="am-confirm" type={showPassword ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
              {confirm.length > 0 && !passwordsMatch && <p className="text-xs text-red-500">Passwords do not match</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={role} onValueChange={(v) => setRole(v as 'BUYER' | 'VENDOR' | 'ADMIN')}>
                  <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUYER">Buyer</SelectItem>
                    <SelectItem value="VENDOR">Vendor</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status *</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as 'ACTIVE' | 'PENDING')}>
                  <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={sendWelcomeEmail} onChange={(e) => setSendWelcomeEmail(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              <span className="text-zinc-600 dark:text-zinc-400">Send welcome email to user</span>
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!canSubmit}>
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Creating…</> : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Adjust balance modal — with credit/debit, reason, audit logging
function AdjustBalanceModal({ user, onClose, onAdjusted }: { user: any; onClose: () => void; onAdjusted: () => void }) {
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'credit' | 'debit'>('credit')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('Enter a positive amount'); return }
    if (!reason.trim()) { toast.error('Reason is required for audit trail'); return }
    const signed = type === 'credit' ? amt : -amt
    setSubmitting(true)
    try {
      const result = await api.adminAdjustBalance(user.id, signed, reason.trim())
      toast.success(`${type === 'credit' ? 'Credited' : 'Debited'} ${formatMoney(amt)} · new balance: ${formatMoney(result.user.balance)}`)
      onClose()
      onAdjusted()
    } catch (e: any) {
      toast.error(e.message || 'Failed to adjust balance')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust balance · {user.name || user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 p-3 text-sm flex items-center justify-between">
            <span className="text-zinc-500">Current balance</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(user.balance)}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjAmount">Amount (USD)</Label>
            <Input id="adjAmount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={type === 'credit'} onChange={() => setType('credit')} className="accent-emerald-600" />
                <span className="text-sm">Credit (+)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={type === 'debit'} onChange={() => setType('debit')} className="accent-emerald-600" />
                <span className="text-sm">Debit (−)</span>
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjReason">Reason</Label>
            <Input id="adjReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Refund for order #1024" />
            <p className="text-xs text-zinc-500">Required — logged in the audit trail.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdjustBalanceButton({ user, onAdjusted }: { user: any; onAdjusted: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings className="w-3.5 h-3.5 mr-1" /> Adjust
      </Button>
      {open && <AdjustBalanceModal user={user} onClose={() => setOpen(false)} onAdjusted={onAdjusted} />}
    </>
  )
}

// ----- Site content view -----
//
// Editor for the section headings / hero copy shown on the public pages.
// Values are stored in the Setting table under the `content.` prefix and are
// read by the marketplace, Special Deal and Blog pages on every request, so a
// save shows up on the storefront on the next page load — no redeploy.
function SiteContentView({ settings, onSaved }: { settings: PublicSettings | null; onSaved: () => void }) {
  const [values, setValues] = useState<SiteContent>(() => ({ ...defaultContent(), ...(settings?.content ?? {}) }))
  const [saving, setSaving] = useState(false)

  // The nav links list is edited as structured rows (see NavLinksEditor) but
  // stored inside the same values map as its JSON string.
  const [navLinks, setNavLinks] = useState<NavLinkInput[]>(() =>
    navLinksForEditing({ ...defaultContent(), ...(settings?.content ?? {}) })
  )

  // The footer presentation (brand, layout, zone visibility, bottom bar) is
  // edited with the visual FooterEditor but stored as its JSON string in the
  // same values map, so the one Save button persists everything.
  const [footerConfig, setFooterConfig] = useState<FooterConfig>(() =>
    resolveFooterConfig({ ...defaultContent(), ...(settings?.content ?? {}) })
  )

  // Keep the JSON field in sync so a single Save persists everything.
  function setNavLinksAndSync(next: NavLinkInput[]) {
    setNavLinks(next)
    setValues((prev) => ({ ...prev, [NAV_LINKS_FIELD]: serializeNavLinks(next) }))
  }

  function setFooterConfigAndSync(next: FooterConfig) {
    setFooterConfig(next)
    setValues((prev) => ({ ...prev, [FOOTER_CONFIG_FIELD]: serializeFooterConfig(next) }))
  }

  // Re-sync whenever the parent refetches settings.
  useEffect(() => {
    const merged = { ...defaultContent(), ...(settings?.content ?? {}) }
    setValues(merged)
    setNavLinks(navLinksForEditing(merged))
    setFooterConfig(resolveFooterConfig(merged))
  }, [settings])

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  // Restore one section's copy to the wording that shipped with the app.
  function resetSection(sectionId: string) {
    const section = CONTENT_SECTIONS.find((s) => s.id === sectionId)
    if (!section) return
    setValues((prev) => {
      const next = { ...prev }
      for (const field of section.fields) next[field.key] = field.default
      return next
    })
    if (section.id === 'navigation') {
      // After the generic reset above blanked the JSON field, restore the
      // shipped list (drag order + flags included) into both states.
      setNavLinksAndSync(navLinksForEditing(null))
    }
    if (section.id === 'footer') {
      // Restore the shipped footer layout (centered, bottom bar hidden).
      setFooterConfigAndSync(defaultFooterConfig())
    }
    toast.info(`${section.label} reset to the default copy — press Save to apply.`)
  }

  async function save() {
    setSaving(true)
    try {
      await api.updateSettings({ content: values })
      toast.success('Site content saved')
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save site content')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Site content</h1>
          <p className="text-sm text-zinc-500">
            Headings, hero copy, navigation links and the About / Contact / Terms / Privacy page bodies shown on
            the public pages. Leave an optional field empty to hide it; page bodies use simple Markdown (blank
            line between blocks, ## headings, - bullets, 1. numbered lists, **bold**, [links](/contact)).
            Changes apply to public pages on the next load. The site name itself lives under Settings →
            Marketplace branding.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Save content
        </Button>
      </div>

      {CONTENT_SECTIONS.map((section) => (
        <Card key={section.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">{section.label}</CardTitle>
              {section.description && <CardDescription>{section.description}</CardDescription>}
            </div>
            <Button variant="outline" size="sm" onClick={() => resetSection(section.id)} className="shrink-0">
              Reset
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.id === 'navigation' ? (
              <NavLinksEditor links={navLinks} onChange={setNavLinksAndSync} />
            ) : section.id === 'footer' ? (
              <FooterEditor
                config={footerConfig}
                onChange={setFooterConfigAndSync}
                tagline={values['footer.tagline'] ?? ''}
                onTaglineChange={(v) => setField('footer.tagline', v)}
                navPreview={resolveNavLinks(values)}
              />
            ) : (
              section.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`content-${field.key}`}>{field.label}</Label>
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {(values[field.key] ?? '').length}/{field.maxLength ?? 500}
                  </span>
                </div>
                {field.multiline ? (
                  <Textarea
                    id={`content-${field.key}`}
                    rows={field.rows ?? 3}
                    maxLength={field.maxLength}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className={field.rows && field.rows >= 8 ? 'font-mono text-xs' : undefined}
                  />
                ) : (
                  <Input
                    id={`content-${field.key}`}
                    maxLength={field.maxLength}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  />
                )}
                {field.hint && <p className="text-xs text-zinc-500">{field.hint}</p>}
              </div>
            )))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Save content
        </Button>
      </div>
    </div>
  )
}

// ----- Navigation links editor -----
//
// Rows are edited as structured data and persisted as the nav.links JSON
// string (serializeNavLinks) inside the regular content values map. Reorder
// by dragging the grip handle (HTML5 DnD) or with the up/down buttons — the
// buttons are the accessible/keyboard/touch fallback.
function NavLinksEditor({ links, onChange }: { links: NavLinkInput[]; onChange: (next: NavLinkInput[]) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  function update(index: number, patch: Partial<NavLinkInput>) {
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function remove(index: number) {
    onChange(links.filter((_, i) => i !== index))
  }

  function add() {
    if (links.length >= NAV_LINKS_MAX) {
      toast.error(`Maximum of ${NAV_LINKS_MAX} links reached`)
      return
    }
    onChange([...links, { label: '', href: '', nav: true }])
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= links.length || from === to) return
    const next = [...links]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  // --- HTML5 drag & drop ---
  function onDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox requires some data to start a drag.
    e.dataTransfer.setData('text/plain', String(index))
  }
  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (index !== overIndex) setOverIndex(index)
  }
  function onDrop(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== index) move(dragIndex, index)
    setDragIndex(null)
    setOverIndex(null)
  }
  function onDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
        <span className="w-6" />
        <span>Label</span>
        <span>URL</span>
        <span className="text-center">Nav bar</span>
        <span className="w-16" />
      </div>

      {links.map((link, i) => (
        <div
          key={i}
          draggable
          onDragStart={(e) => onDragStart(e, i)}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={(e) => onDrop(e, i)}
          onDragEnd={onDragEnd}
          className={`grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-2 items-center rounded-lg border p-2 transition-colors ${
            dragIndex === i
              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 opacity-60'
              : overIndex === i && dragIndex !== null && dragIndex !== i
                ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
          }`}
        >
          <span
            className="w-6 h-9 flex items-center justify-center text-zinc-400 cursor-grab active:cursor-grabbing touch-none"
            title="Drag to reorder"
            aria-hidden="true"
          >
            <GripVertical className="w-4 h-4" />
          </span>

          <div className="space-y-1 min-w-0">
            <Input
              aria-label={`Link ${i + 1} label`}
              placeholder="Label (falls back to URL if empty)"
              maxLength={60}
              value={link.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <Input
              aria-label={`Link ${i + 1} URL`}
              placeholder="/path or https://example.com (empty = hidden)"
              maxLength={300}
              value={link.href}
              onChange={(e) => update(i, { href: e.target.value })}
              className="sm:hidden"
            />
          </div>

          <Input
            aria-label={`Link ${i + 1} URL`}
            placeholder="/path or https://example.com (empty = hidden)"
            maxLength={300}
            value={link.href}
            onChange={(e) => update(i, { href: e.target.value })}
            className="hidden sm:block"
          />

          <span className="flex justify-center" title="Show this link in the secondary nav bar (untick = footer only)">
            <input
              type="checkbox"
              aria-label={`Link ${i + 1} show in nav bar`}
              checked={link.nav}
              onChange={(e) => update(i, { nav: e.target.checked })}
              className="w-4 h-4 rounded accent-emerald-600"
            />
          </span>

          <span className="flex items-center gap-0.5 justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => move(i, i - 1)}
              disabled={i === 0}
              aria-label={`Move link ${i + 1} up`}
            >
              <ChevronUp className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => move(i, i + 1)}
              disabled={i === links.length - 1}
              aria-label={`Move link ${i + 1} down`}
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => remove(i)}
              aria-label={`Remove link ${i + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </span>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={add} disabled={links.length >= NAV_LINKS_MAX}>
          <Plus className="w-4 h-4 mr-1" /> Add link
        </Button>
        <span className="text-xs text-zinc-400">
          {links.length} link{links.length === 1 ? '' : 's'} · drag the grip or use the arrows to reorder
        </span>
      </div>
    </div>
  )
}

// ----- Footer editor -----
//
// Visual editor for the public footer's presentation. Brand, layout colors /
// spacing, zone visibility and the optional bottom bar are persisted as the
// `footer.config` JSON string in the content values map. The page links and
// social buttons are NOT duplicated here — they reuse the Navigation links
// list and the Social Links manager, so each has a single source of truth.
function clampPadding(raw: string, fallback: number): number {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(200, Math.max(0, n))
}

function FooterColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-9 shrink-0 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent"
        />
        <Input id={id} maxLength={7} placeholder="#0A0A0A" value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      </div>
    </div>
  )
}

function FooterEditor({
  config,
  onChange,
  tagline,
  onTaglineChange,
  navPreview,
}: {
  config: FooterConfig
  onChange: (next: FooterConfig) => void
  tagline: string
  onTaglineChange: (v: string) => void
  navPreview: { label: string; href: string }[]
}) {
  function patch(part: Partial<FooterConfig>) {
    onChange({ ...config, ...part })
  }
  function patchBrand(part: Partial<FooterConfig['brand']>) {
    onChange({ ...config, brand: { ...config.brand, ...part } })
  }
  function patchLayout(part: Partial<FooterConfig['layout']>) {
    onChange({ ...config, layout: { ...config.layout, ...part } })
  }

  function updateLegal(index: number, p: Partial<FooterLinkItem>) {
    patch({ legal: config.legal.map((l, i) => (i === index ? { ...l, ...p } : l)) })
  }
  function removeLegal(index: number) {
    patch({ legal: config.legal.filter((_, i) => i !== index) })
  }
  function addLegal() {
    if (config.legal.length >= FOOTER_LEGAL_MAX) {
      toast.error(`Maximum of ${FOOTER_LEGAL_MAX} links reached`)
      return
    }
    patch({ legal: [...config.legal, { label: '', url: '', visible: true }] })
  }
  function moveLegal(from: number, to: number) {
    if (to < 0 || to >= config.legal.length || from === to) return
    const next = [...config.legal]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    patch({ legal: next })
  }

  const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-zinc-400'

  return (
    <div className="space-y-6">
      {/* Brand */}
      <div className="space-y-3">
        <h4 className={sectionTitle}>Brand</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="footer-logo-text">Logo text</Label>
            <Input
              id="footer-logo-text"
              maxLength={60}
              placeholder="DigitalVault"
              value={config.brand.logo_text}
              onChange={(e) => patchBrand({ logo_text: e.target.value })}
            />
            <p className="text-xs text-zinc-500">Falls back to the site name when empty.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="footer-logo-url">Logo URL</Label>
            <Input
              id="footer-logo-url"
              maxLength={300}
              placeholder="/"
              value={config.brand.logo_url}
              onChange={(e) => patchBrand({ logo_url: e.target.value })}
            />
            <p className="text-xs text-zinc-500">Where clicking the logo/brand goes.</p>
          </div>
        </div>
        <ImageUploader
          label="Logo image (optional)"
          value={config.brand.logo_image ?? ''}
          onChange={(v) => patchBrand({ logo_image: v || null })}
        />
        <p className="text-xs text-zinc-500">When set, the image replaces the letter shown inside the logo circle.</p>
      </div>

      {/* Navigation */}
      <div className="space-y-3">
        <h4 className={sectionTitle}>Navigation</h4>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={config.nav_visible}
            onChange={(e) => patch({ nav_visible: e.target.checked })}
            className="w-4 h-4 accent-emerald-600"
          />
          Show navigation zone
        </label>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
          {navPreview.length === 0 ? (
            <p className="text-xs text-zinc-500">No links yet — add them under Navigation links above.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {navPreview.map((l) => (
                <span key={`${l.href}-${l.label}`} className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300">
                  {l.label}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-500 mt-2">
            These are the same links edited under&nbsp;
            <span className="font-medium">Navigation links</span> above — rename, reorder or clear a URL (to hide a link) there.
          </p>
        </div>
      </div>

      {/* Social */}
      <div className="space-y-3">
        <h4 className={sectionTitle}>Social</h4>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={config.social_visible}
            onChange={(e) => patch({ social_visible: e.target.checked })}
            className="w-4 h-4 accent-emerald-600"
          />
          Show social zone
        </label>
        <p className="text-xs text-zinc-500">
          The circular buttons come from&nbsp;<span className="font-medium">Social Links</span> in the sidebar — add, reorder or hide them there.
        </p>
      </div>

      {/* Layout */}
      <div className="space-y-3">
        <h4 className={sectionTitle}>Layout</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FooterColorField id="footer-bg" label="Background" value={config.layout.bg_color} onChange={(v) => patchLayout({ bg_color: v })} />
          <FooterColorField id="footer-text" label="Text" value={config.layout.text_color} onChange={(v) => patchLayout({ text_color: v })} />
          <FooterColorField id="footer-muted" label="Muted" value={config.layout.muted_color} onChange={(v) => patchLayout({ muted_color: v })} />
        </div>
        <p className="text-xs text-zinc-500">Invalid hex values fall back to the defaults (#0A0A0A / #FFFFFF / #9CA3AF).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="footer-pt">Padding top (px)</Label>
            <Input
              id="footer-pt"
              type="number"
              min={0}
              max={200}
              value={config.layout.padding_top}
              onChange={(e) => patchLayout({ padding_top: clampPadding(e.target.value, config.layout.padding_top) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="footer-pb">Padding bottom (px)</Label>
            <Input
              id="footer-pb"
              type="number"
              min={0}
              max={200}
              value={config.layout.padding_bottom}
              onChange={(e) => patchLayout({ padding_bottom: clampPadding(e.target.value, config.layout.padding_bottom) })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Alignment</Label>
          <Select value={config.layout.align} onValueChange={(v) => patchLayout({ align: v as 'center' | 'left' })}>
            <SelectTrigger aria-label="Footer alignment" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="left">Left</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="space-y-3">
        <h4 className={sectionTitle}>Bottom bar</h4>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={config.bottom_bar_visible}
            onChange={(e) => patch({ bottom_bar_visible: e.target.checked })}
            className="w-4 h-4 accent-emerald-600"
          />
          Show bottom bar
        </label>
        {config.bottom_bar_visible && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="footer-copyright">Copyright text</Label>
              <Input
                id="footer-copyright"
                maxLength={200}
                placeholder={`© ${new Date().getFullYear()} DigitalVault · All rights reserved`}
                value={config.copyright}
                onChange={(e) => patch({ copyright: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Legal links</Label>
                <Button variant="outline" size="sm" onClick={addLegal} disabled={config.legal.length >= FOOTER_LEGAL_MAX}>
                  <Plus className="w-4 h-4 mr-1" /> Add link
                </Button>
              </div>
              {config.legal.length === 0 && <p className="text-xs text-zinc-500">No legal links yet.</p>}
              {config.legal.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                  <Input
                    aria-label={`Legal link ${i + 1} label`}
                    placeholder="Terms"
                    maxLength={60}
                    value={l.label}
                    onChange={(e) => updateLegal(i, { label: e.target.value })}
                  />
                  <Input
                    aria-label={`Legal link ${i + 1} URL`}
                    placeholder="/terms"
                    maxLength={300}
                    value={l.url}
                    onChange={(e) => updateLegal(i, { url: e.target.value })}
                  />
                  <span className="flex justify-center" title="Visible">
                    <input
                      type="checkbox"
                      aria-label={`Legal link ${i + 1} visible`}
                      checked={l.visible}
                      onChange={(e) => updateLegal(i, { visible: e.target.checked })}
                      className="w-4 h-4 accent-emerald-600"
                    />
                  </span>
                  <span className="flex items-center gap-0.5 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveLegal(i, i - 1)} disabled={i === 0} aria-label="Move up">
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveLegal(i, i + 1)} disabled={i === config.legal.length - 1} aria-label="Move down">
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => removeLegal(i)}
                      aria-label="Remove legal link"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tagline (kept as its own field for backwards compatibility) */}
      <div className="space-y-1.5">
        <Label htmlFor="footer-tagline">Footer tagline (optional)</Label>
        <Input
          id="footer-tagline"
          maxLength={200}
          placeholder="Leave empty to hide"
          value={tagline}
          onChange={(e) => onTaglineChange(e.target.value)}
        />
      </div>
    </div>
  )
}

// ----- Settings view -----
// ----- Settings: Support → Canned Responses manager -----
function CannedResponsesCard() {
  const [items, setItems] = useState<{ id: string; shortcut: string; body: string }[]>([])
  const [shortcut, setShortcut] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/chat/canned')
      if (res.ok) {
        const data = await res.json()
        setItems(data.items || [])
      }
    } catch {}
    if (!loaded) setLoaded(true)
  }, [loaded])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!shortcut.trim() || !body.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/chat/canned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcut: shortcut.trim(), body: body.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'Failed to save')
        return
      }
      toast.success('Canned response saved')
      setShortcut('')
      setBody('')
      load()
    } catch {
      toast.error('Failed to save')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch('/api/admin/chat/canned', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        toast.success('Deleted')
        load()
      }
    } catch {}
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">💬 Support — Canned Responses</CardTitle>
        <CardDescription>
          Quick replies for the Support Console. Admins type / in the message box to pick one — e.g. /refund_sent or /deposit_pending.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loaded && items.length === 0 && (
          <p className="text-sm text-zinc-400">No canned responses yet. Add the first one below.</p>
        )}
        {items.length > 0 && (
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 pt-0.5">{it.shortcut}</span>
                <span className="flex-1 min-w-0 text-zinc-600 dark:text-zinc-300 break-words">{it.body}</span>
                <button
                  onClick={() => remove(it.id)}
                  className="shrink-0 text-xs text-zinc-400 hover:text-red-500"
                  aria-label={`Delete ${it.shortcut}`}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 items-start">
          <div className="space-y-1">
            <Label htmlFor="cannedShortcut">Shortcut</Label>
            <Input
              id="cannedShortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="/refund_sent"
              maxLength={41}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cannedBody">Reply text</Label>
            <Textarea
              id="cannedBody"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Your refund has been processed and should arrive shortly."
              maxLength={2000}
              rows={2}
              className="text-sm"
            />
          </div>
          <Button onClick={save} disabled={busy || !shortcut.trim() || !body.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white sm:mt-6">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SettingsView({ settings, onSaved }: { settings: PublicSettings | null; onSaved: () => void }) {
  const [minDeposit, setMinDeposit] = useState('')
  const [siteName, setSiteName] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [saving, setSaving] = useState(false)

  // Tracking settings state
  const [trackingEnabled, setTrackingEnabled] = useState(false)
  const [trackingProdOnly, setTrackingProdOnly] = useState(false)
  const [trackingAllowInline, setTrackingAllowInline] = useState(false)
  const [trackingHeadScripts, setTrackingHeadScripts] = useState('')
  const [trackingBodyScripts, setTrackingBodyScripts] = useState('')
  const [trackingSaving, setTrackingSaving] = useState(false)
  const [trackingLoaded, setTrackingLoaded] = useState(false)

  useEffect(() => {
    if (settings) {
      setMinDeposit(String(settings.minDepositAmount))
      setSiteName(settings.siteName)
      setSupportEmail(settings.supportEmail)
    }
  }, [settings])

  // Fetch tracking settings (admin-only endpoint)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/tracking')
        if (res.ok) {
          const data = await res.json()
          if (mounted) {
            setTrackingEnabled(data.enabled)
            setTrackingProdOnly(data.prodOnly)
            setTrackingAllowInline(!!data.allowInline)
            setTrackingHeadScripts(data.headScripts || '')
            setTrackingBodyScripts(data.bodyScripts || '')
            setTrackingLoaded(true)
          }
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  async function saveTracking() {
    setTrackingSaving(true)
    try {
      const res = await fetch('/api/admin/tracking', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: trackingEnabled,
          prodOnly: trackingProdOnly,
          allowInline: trackingAllowInline,
          headScripts: trackingHeadScripts,
          bodyScripts: trackingBodyScripts,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Tracking settings saved — applied immediately')
      } else {
        toast.error(data?.error || 'Failed to save tracking settings')
      }
    } catch {
      toast.error('Failed to save tracking settings')
    } finally {
      setTrackingSaving(false)
    }
  }

  async function save() {
    const amt = parseFloat(minDeposit)
    if (isNaN(amt) || amt < 0) {
      toast.error('Min deposit must be a non-negative number')
      return
    }
    setSaving(true)
    try {
      await api.updateSettings({
        minDepositAmount: amt,
        siteName: siteName.trim() || 'DigitalVault',
        supportEmail: supportEmail.trim(),
      })
      toast.success('Settings saved')
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-zinc-500">Global marketplace configuration. Changes apply immediately to all buyers.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deposit rules</CardTitle>
          <CardDescription>Minimum deposit amount enforced on every new crypto deposit request.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="minDeposit">Minimum deposit amount (USD)</Label>
            <Input
              id="minDeposit"
              type="number"
              min="0"
              step="0.01"
              value={minDeposit}
              onChange={(e) => setMinDeposit(e.target.value)}
            />
            <p className="text-xs text-zinc-500">Set to <code>0</code> to disable the minimum. Buyer sees this in their deposit dialog.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketplace branding</CardTitle>
          <CardDescription>Shown in the buyer header, footer, and emails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="siteName">Site name</Label>
            <Input
              id="siteName"
              maxLength={64}
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supportEmail">Support email</Label>
            <Input
              id="supportEmail"
              type="email"
              maxLength={128}
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@example.com"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Save settings
        </Button>
      </div>

      {/* Support — Canned Responses (spec 6.1) */}
      <CannedResponsesCard />

      {/* Tracking & Analytics Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            📊 Tracking &amp; Analytics
          </CardTitle>
          <CardDescription>
            Paste raw tracking scripts (GTM, GA4, Meta Pixel, Search Console, etc.). Scripts are auto-injected into every public page — no redeploy needed.
            <strong className="text-zinc-700 dark:text-zinc-300"> Never loaded on admin pages.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!trackingLoaded ? (
            <div className="text-center py-4"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-400" /></div>
          ) : (
            <>
              {/* Toggles */}
              <div className="flex flex-col sm:flex-row gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trackingEnabled}
                    onChange={(e) => setTrackingEnabled(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-600"
                  />
                  <span className="text-sm font-medium">Enable tracking</span>
                  <span className="text-xs text-zinc-400">— Master on/off</span>
                </label>                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trackingProdOnly}
                    onChange={(e) => setTrackingProdOnly(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-600"
                  />
                  <span className="text-sm font-medium">Production only</span>
                  <span className="text-xs text-zinc-400">— Skip in dev/staging</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title="Allow snippets without a whitelisted src (pure inline JS). Off = only vendor snippets loading from whitelisted analytics domains.">
                  <input
                    type="checkbox"
                    checked={trackingAllowInline}
                    onChange={(e) => setTrackingAllowInline(e.target.checked)}
                    className="w-4 h-4 rounded accent-amber-600"
                  />
                  <span className="text-sm font-medium">Allow inline scripts</span>
                  <span className="text-xs text-zinc-400">— For vendors without a hosted snippet</span>
                </label>
              </div>

              {/* Head scripts */}
              <div className="space-y-2">
                <Label htmlFor="trackingHead" className="flex items-center gap-1.5">
                  Head scripts <span className="text-[10px] text-zinc-400 font-normal">(injected into &lt;head&gt;)</span>
                </Label>
                <textarea
                  id="trackingHead"
                  rows={6}
                  value={trackingHeadScripts}
                  onChange={(e) => setTrackingHeadScripts(e.target.value)}
                  placeholder={`<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>`}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y"
                />
                <p className="text-xs text-zinc-500">
                  Paste the full script tag(s) exactly as provided by Google / Meta. Do not include surrounding <code>&lt;head&gt;</code> tags.
                </p>
              </div>

              {/* Body scripts */}
              <div className="space-y-2">
                <Label htmlFor="trackingBody" className="flex items-center gap-1.5">
                  Body scripts <span className="text-[10px] text-zinc-400 font-normal">(injected before &lt;/body&gt;)</span>
                </Label>
                <textarea
                  id="trackingBody"
                  rows={4}
                  value={trackingBodyScripts}
                  onChange={(e) => setTrackingBodyScripts(e.target.value)}
                  placeholder={`<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y"
                />
                <p className="text-xs text-zinc-500">
                  Paste noscript tags or other scripts that go before <code>&lt;/body&gt;</code>.
                </p>
              </div>

              {/* Security note */}
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold mb-1">🔒 Security — what this field can and cannot do</p>
                <p className="mb-1.5">
                  Anything pasted here <strong>runs as JavaScript on every public page</strong> for every visitor. Script <code>src</code> domains are
                  validated against an analytics whitelist (googletagmanager.com, google-analytics.com, connect.facebook.net, and other common CDNs);
                  iframes, event handlers, cookie/storage access, and fetch/XHR are rejected. Wrapper <code>&lt;html&gt;/&lt;head&gt;/&lt;body&gt;</code> tags are stripped automatically.
                </p>
                <p>
                  Because the code itself must run raw, <strong>the real protection is this admin account</strong>: anyone with admin access can change what
                  runs here. Use a strong, unique password and sign out on shared machines. Every change to these fields is written to the audit log (Logs).
                </p>
              </div>

              {/* Save button for tracking */}
              <div className="flex justify-end">
                <Button onClick={saveTracking} disabled={trackingSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {trackingSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Save tracking settings
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ----- Auctions (Special Deals) View -----
function AuctionsView({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [auctions, setAuctions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '', description: '', category: 'General',
    askingPrice: '', image: '', deliveryFormat: '',
    endsAtDays: '1', endsAtHours: '0',
  })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auctions?admin=1')
      const data = await res.json()
      setAuctions(data.auctions || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load auctions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createAuction() {
    if (!createForm.title.trim() || !createForm.askingPrice) {
      toast.error('Title and asking price are required')
      return
    }
    const askingPrice = parseFloat(createForm.askingPrice)
    if (isNaN(askingPrice) || askingPrice < 0) {
      toast.error('Asking price must be a non-negative number')
      return
    }
    const days = parseInt(createForm.endsAtDays) || 0
    const hours = parseInt(createForm.endsAtHours) || 0
    if (days === 0 && hours === 0) {
      toast.error('End time must be at least 1 hour')
      return
    }
    const endsAt = new Date(Date.now() + days * 86400000 + hours * 3600000)
    setCreating(true)
    try {
      const res = await fetch('/api/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createForm.title.trim(),
          description: createForm.description || undefined,
          category: createForm.category,
          askingPrice,
          image: createForm.image || undefined,
          deliveryFormat: createForm.deliveryFormat || undefined,
          endsAt: endsAt.toISOString(),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Auction created')
        setCreateOpen(false)
        setCreateForm({ title: '', description: '', category: 'General', askingPrice: '', image: '', deliveryFormat: '', endsAtDays: '1', endsAtHours: '0' })
        await load()
        await onRefresh()
      } else {
        toast.error(data?.error || 'Failed to create auction')
      }
    } catch {
      toast.error('Failed to create auction')
    } finally {
      setCreating(false)
    }
  }

  async function unlockBids(auctionId: string) {
    if (!confirm('Unlock all locked bids for this auction? This refunds all bidders.')) return
    try {
      const res = await fetch(`/api/admin/auctions/${auctionId}/unlock`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || 'Bids unlocked')
        await load()
      } else {
        toast.error(data?.error || 'Failed to unlock bids')
      }
    } catch {
      toast.error('Failed to unlock bids')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Special Deals</h1>
          <p className="text-sm text-zinc-500">Create + manage auction deals. Users bid on these; highest bidder wins.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> New Deal
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : auctions.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-zinc-500">No auctions yet. Create one to get started.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {auctions.map((a) => {
            const ended = new Date(a.endsAt).getTime() <= Date.now() || a.status !== 'ACTIVE'
            return (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <a href={`/special-deal/${a.slug}`} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600">
                      <CardTitle className="text-base">{a.title}</CardTitle>
                    </a>
                    <Badge variant="outline" className={ended ? 'border-zinc-300 text-zinc-500 text-[10px]' : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 text-[10px]'}>
                      {ended ? 'Ended' : 'Live'}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">{a.category}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-500">Asking:</span><span className="font-medium">{formatMoney(a.askingPrice)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Current bid:</span><span className="font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(a.currentBid)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Bids:</span><span className="font-medium">{a._count?.bids ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Ends:</span><span className="font-medium">{formatDate(a.endsAt)}</span></div>
                </CardContent>
                <CardFooter className="pt-2 gap-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <a href={`/special-deal/${a.slug}`} target="_blank" rel="noopener noreferrer">View</a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => unlockBids(a.id)} className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400">
                    Unlock bids
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create new special deal</DialogTitle>
            <DialogDescription>Set up a new auction for users to bid on.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-title">Title *</Label>
              <Input id="a-title" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="e.g. Netflix Premium 4K — 1 month" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-desc">Description</Label>
              <Textarea id="a-desc" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={2} placeholder="Optional — shown on the deal page" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="a-cat">Category</Label>
                <Input id="a-cat" value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-price">Asking price (USD) *</Label>
                <Input id="a-price" type="number" min="0" step="0.01" value={createForm.askingPrice} onChange={(e) => setCreateForm({ ...createForm, askingPrice: e.target.value })} placeholder="e.g. 5" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-img">Image (emoji or URL)</Label>
              <Input id="a-img" value={createForm.image} onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })} placeholder="e.g. 🎬 or https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-delivery">Delivery format</Label>
              <Input id="a-delivery" value={createForm.deliveryFormat} onChange={(e) => setCreateForm({ ...createForm, deliveryFormat: e.target.value })} placeholder="e.g. Email + password" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="a-days">Ends in (days)</Label>
                <Input id="a-days" type="number" min="0" value={createForm.endsAtDays} onChange={(e) => setCreateForm({ ...createForm, endsAtDays: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-hours">Ends in (hours)</Label>
                <Input id="a-hours" type="number" min="0" max="23" value={createForm.endsAtHours} onChange={(e) => setCreateForm({ ...createForm, endsAtHours: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createAuction} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Create deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ----- Blog View -----
//
// Create / edit / publish / delete blog posts. Posts live in the BlogPost
// table and are read by the public /blogs pages — no redeploy needed. The
// content field is markdown, matching the renderer used on the post page.
function BlogView() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BlogPost | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/blogs?admin=1')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load posts')
      setPosts(data.posts || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load posts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(post: BlogPost) {
    setEditing(post)
    setDialogOpen(true)
  }

  async function togglePublished(post: BlogPost) {
    try {
      const res = await fetch(`/api/blogs/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !post.isPublished }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to update post')
      toast.success(data.post?.isPublished ? 'Post published' : 'Post moved to draft')
      await load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update post')
    }
  }

  async function remove(post: BlogPost) {
    if (!confirm(`Delete “${post.title}”? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/blogs/${post.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to delete post')
      toast.success('Post deleted')
      await load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete post')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Blog</h1>
          <p className="text-sm text-zinc-500">Write + manage blog posts. Published posts appear on /blogs immediately.</p>
        </div>
        <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> New Post
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : posts.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-zinc-500">No posts yet. Write your first one to get started.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{post.title}</h3>
                      <Badge
                        variant="outline"
                        className={post.isPublished
                          ? 'text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'
                          : 'text-[10px] border-zinc-300 text-zinc-500'}
                      >
                        {post.isPublished ? 'Published' : 'Draft'}
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500">
                      /blogs/{post.slug} · {formatDate(post.createdAt)}
                      {post.tags ? ` · ${post.tags}` : ''}
                    </p>
                    {post.excerpt && <p className="text-xs text-zinc-400 line-clamp-2">{post.excerpt}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Button asChild variant="outline" size="sm">
                      <a href={`/blogs/${post.slug}`} target="_blank" rel="noopener noreferrer">View</a>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(post)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => togglePublished(post)}>
                      {post.isPublished ? 'Unpublish' : 'Publish'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => remove(post)}
                      className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BlogPostDialog
        post={editing}
        open={dialogOpen}
        setOpen={setDialogOpen}
        onSaved={load}
      />
    </div>
  )
}

// Create + edit share one dialog: `post` null means "new post".
function BlogPostDialog({ post, open, setOpen, onSaved }: { post: BlogPost | null; open: boolean; setOpen: (v: boolean) => void; onSaved: () => void }) {
  const isEdit = !!post
  const [form, setForm] = useState({
    title: '', slug: '', excerpt: '', content: '', coverImage: '', tags: '', isPublished: true,
  })
  const [saving, setSaving] = useState(false)

  // Re-seed the form each time the dialog opens so a cancelled edit never leaks
  // into the next post.
  useEffect(() => {
    if (!open) return
    setForm({
      title: post?.title ?? '',
      slug: post?.slug ?? '',
      excerpt: post?.excerpt ?? '',
      content: post?.content ?? '',
      coverImage: post?.coverImage ?? '',
      tags: post?.tags ?? '',
      isPublished: post?.isPublished ?? true,
    })
  }, [open, post])

  async function save() {
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    if (!form.content.trim()) {
      toast.error('Post content is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(isEdit ? `/api/blogs/${post!.id}` : '/api/blogs', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          // Blank slug → the API derives one from the title.
          slug: form.slug.trim() || undefined,
          excerpt: form.excerpt,
          content: form.content,
          coverImage: form.coverImage,
          tags: form.tags,
          isPublished: form.isPublished,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to save post')
      toast.success(isEdit ? 'Post updated' : 'Post created')
      setOpen(false)
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save post')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit post' : 'New blog post'}</DialogTitle>
          <DialogDescription>
            Shown on the public blog. The content field accepts markdown (# heading, **bold**, - list).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-title">Title *</Label>
            <Input
              id="b-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. How to buy digital accounts safely"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-slug">URL slug</Label>
              <Input
                id="b-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="auto-generated from the title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-cover">Cover (emoji or URL)</Label>
              <Input
                id="b-cover"
                value={form.coverImage}
                onChange={(e) => setForm({ ...form, coverImage: e.target.value })}
                placeholder="e.g. 🛡️ or https://…"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-excerpt">Excerpt</Label>
            <Textarea
              id="b-excerpt"
              rows={2}
              maxLength={300}
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              placeholder="One or two lines shown on the blog cards"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-tags">Tags</Label>
            <Input
              id="b-tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="e.g. safety, buyer-guide, security"
            />
            <p className="text-xs text-zinc-500">
              Comma-separated. The first tag becomes the category label on the blog card and the filter pills.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-content">Content *</Label>
            <Textarea
              id="b-content"
              rows={12}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={'## Section heading\n\nSome paragraph text.\n\n- first point\n- second point'}
              className="font-mono text-xs"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              className="w-4 h-4 rounded accent-emerald-600"
            />
            <span className="text-sm font-medium">Published</span>
            <span className="text-xs text-zinc-400">— uncheck to save as a draft</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {isEdit ? 'Save changes' : 'Create post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----- Coupons View -----
function CouponsView() {
  const [coupons, setCoupons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    code: '', description: '', discountPercent: '', discountAmount: '', maxUses: '', expiresAt: '',
  })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/coupons')
      const data = await res.json()
      setCoupons(data.coupons || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load coupons')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createCoupon() {
    if (!createForm.code.trim()) {
      toast.error('Coupon code is required')
      return
    }
    const pct = parseFloat(createForm.discountPercent) || 0
    const amt = parseFloat(createForm.discountAmount) || 0
    if (pct <= 0 && amt <= 0) {
      toast.error('Either discount % or discount $ must be > 0')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: createForm.code.trim().toUpperCase(),
          description: createForm.description || undefined,
          discountPercent: pct,
          discountAmount: amt,
          maxUses: parseInt(createForm.maxUses) || 0,
          expiresAt: createForm.expiresAt ? new Date(createForm.expiresAt).toISOString() : undefined,
          isActive: true,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Coupon created')
        setCreateOpen(false)
        setCreateForm({ code: '', description: '', discountPercent: '', discountAmount: '', maxUses: '', expiresAt: '' })
        await load()
      } else {
        toast.error(data?.error || 'Failed to create coupon')
      }
    } catch {
      toast.error('Failed to create coupon')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(coupon: any) {
    try {
      const res = await fetch(`/api/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !coupon.isActive }),
      })
      if (res.ok) {
        toast.success(coupon.isActive ? 'Coupon deactivated' : 'Coupon activated')
        await load()
      } else {
        toast.error('Failed to toggle coupon')
      }
    } catch {
      toast.error('Failed to toggle coupon')
    }
  }

  async function deleteCoupon(coupon: any) {
    if (!confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/coupons/${coupon.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Coupon deleted')
        await load()
      } else {
        toast.error('Failed to delete coupon')
      }
    } catch {
      toast.error('Failed to delete coupon')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Coupons</h1>
          <p className="text-sm text-zinc-500">Create discount codes users can apply at checkout.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> New Coupon
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : coupons.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-zinc-500">No coupons yet. Create one to offer discounts.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Discount</th>
                  <th className="text-left px-4 py-3">Used / Max</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {coupons.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                    <td className="px-4 py-3">
                      {c.discountPercent > 0 ? `${c.discountPercent}%` : `$${Number(c.discountAmount).toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{c.usedCount} / {c.maxUses === 0 ? '∞' : c.maxUses}</td>
                    <td className="px-4 py-3 text-zinc-500">{c.expiresAt ? formatDate(c.expiresAt) : 'Never'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={c.isActive ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 text-[10px]' : 'border-zinc-300 text-zinc-500 text-[10px]'}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => toggleActive(c)} className="h-7 text-xs">
                          {c.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => deleteCoupon(c)} className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create new coupon</DialogTitle>
            <DialogDescription>Users can apply this code at checkout for a discount.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-code">Code *</Label>
              <Input id="c-code" value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })} placeholder="e.g. SAVE10" className="uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc">Description (optional)</Label>
              <Input id="c-desc" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="e.g. 10% off all products" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-pct">Discount %</Label>
                <Input id="c-pct" type="number" min="0" max="100" step="0.1" value={createForm.discountPercent} onChange={(e) => setCreateForm({ ...createForm, discountPercent: e.target.value })} placeholder="e.g. 10" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-amt">Discount $</Label>
                <Input id="c-amt" type="number" min="0" step="0.01" value={createForm.discountAmount} onChange={(e) => setCreateForm({ ...createForm, discountAmount: e.target.value })} placeholder="e.g. 5" />
              </div>
            </div>
            <p className="text-xs text-zinc-500">Set either discount % or $ (not both). If both are set, the % is used.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-max">Max uses (0 = unlimited)</Label>
                <Input id="c-max" type="number" min="0" value={createForm.maxUses} onChange={(e) => setCreateForm({ ...createForm, maxUses: e.target.value })} placeholder="e.g. 100" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-exp">Expires at (optional)</Label>
                <Input id="c-exp" type="datetime-local" value={createForm.expiresAt} onChange={(e) => setCreateForm({ ...createForm, expiresAt: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createCoupon} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Create coupon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ----- Bid Cancellations View -----
function BidCancellationsView() {
  const [bids, setBids] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = filter === 'PENDING' ? '/api/admin/bids?status=PENDING' : '/api/admin/bids'
      const res = await fetch(url)
      const data = await res.json()
      setBids(data.bids || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load bids')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function decide(bidId: string, action: 'approve' | 'reject') {
    if (action === 'approve' && !confirm('Approve this cancellation? The user\'s locked funds will be refunded and they can place a new bid.')) return
    try {
      const res = await fetch(`/api/admin/bids/${bidId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `Cancellation ${action}d`)
        await load()
      } else {
        toast.error(data?.error || 'Failed to process')
      }
    } catch {
      toast.error('Failed to process')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bid Cancellations</h1>
          <p className="text-sm text-zinc-500">Approve or reject user requests to cancel their bids. Approving refunds their locked funds.</p>
        </div>
        <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-md p-1">
          <button onClick={() => setFilter('PENDING')} className={`px-3 py-1 rounded text-xs font-medium ${filter === 'PENDING' ? 'bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}>Pending</button>
          <button onClick={() => setFilter('ALL')} className={`px-3 py-1 rounded text-xs font-medium ${filter === 'ALL' ? 'bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-zinc-500'}`}>All</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : bids.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-zinc-500">No bids to show.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {bids.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">
                      {b.auction?.title || 'Auction'}
                      <a href={b.auction?.slug ? `/special-deal/${b.auction.slug}` : '/special-deal'} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-emerald-600 hover:underline">view</a>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Bid: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatMoney(b.amount)}</span> · by {b.user?.email || 'Unknown'}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      Placed {new Date(b.createdAt).toLocaleString()}
                      {b.cancelRequestedAt && ` · Cancel requested ${new Date(b.cancelRequestedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {b.cancelStatus === 'NONE' && <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 text-[10px]">Active</Badge>}
                    {b.cancelStatus === 'PENDING' && <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400 text-[10px]">Cancel pending</Badge>}
                    {b.cancelStatus === 'APPROVED' && <Badge variant="outline" className="border-zinc-300 text-zinc-500 text-[10px]">Cancelled</Badge>}
                    {b.cancelStatus === 'REJECTED' && <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 text-[10px]">Cancel rejected</Badge>}
                  </div>
                </div>
                {b.cancelStatus === 'PENDING' ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide(b.id, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve (refund)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(b.id, 'reject')} className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400">
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                ) : b.cancelStatus === 'REJECTED' && b.cancelAdminNote ? (
                  <p className="text-[11px] text-red-600 dark:text-red-400">Admin note: {b.cancelAdminNote}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ----- Social Links View -----
function SocialLinksView() {
  const [links, setLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ platform: '', url: '', label: '', order: '0' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social-links')
      const data = await res.json()
      setLinks(data.links || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load social links')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createLink() {
    if (!createForm.platform.trim() || !createForm.url.trim()) {
      toast.error('Platform and URL are required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/social-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: createForm.platform.trim(),
          url: createForm.url.trim(),
          label: createForm.label || undefined,
          order: parseInt(createForm.order) || 0,
          isActive: true,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Social link added')
        setCreateOpen(false)
        setCreateForm({ platform: '', url: '', label: '', order: '0' })
        await load()
      } else {
        toast.error(data?.error || 'Failed to add link')
      }
    } catch {
      toast.error('Failed to add link')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(link: any) {
    try {
      const res = await fetch(`/api/admin/social-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !link.isActive }),
      })
      if (res.ok) {
        toast.success(link.isActive ? 'Hidden' : 'Shown')
        await load()
      }
    } catch {
      toast.error('Failed to toggle')
    }
  }

  async function deleteLink(link: any) {
    if (!confirm(`Delete "${link.platform}" link?`)) return
    try {
      const res = await fetch(`/api/admin/social-links/${link.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Link deleted')
        await load()
      }
    } catch {
      toast.error('Failed to delete')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Social Links</h1>
          <p className="text-sm text-zinc-500">Manage contact buttons shown in the footer + top nav. Add Telegram, Facebook, Instagram, Reddit, Email, etc.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-1" /> Add Link
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" /></div>
      ) : links.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-zinc-500">No social links yet. Add one to show contact buttons in the footer.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Platform</th>
                  <th className="text-left px-4 py-3">URL</th>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {links.map((l) => (
                  <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium capitalize">{l.label || l.platform}</td>
                    <td className="px-4 py-3 text-zinc-500 truncate max-w-xs" title={l.url}>{l.url}</td>
                    <td className="px-4 py-3 text-zinc-500">{l.order}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={l.isActive ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 text-[10px]' : 'border-zinc-300 text-zinc-500 text-[10px]'}>
                        {l.isActive ? 'Active' : 'Hidden'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => toggleActive(l)} className="h-7 text-xs">
                          {l.isActive ? 'Hide' : 'Show'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => deleteLink(l)} className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add social link</DialogTitle>
            <DialogDescription>Add a contact button. Common platforms: telegram, facebook, instagram, reddit, email, twitter, discord, youtube, whatsapp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-platform">Platform *</Label>
              <Input id="s-platform" value={createForm.platform} onChange={(e) => setCreateForm({ ...createForm, platform: e.target.value })} placeholder="e.g. telegram, facebook, email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-url">URL *</Label>
              <Input id="s-url" value={createForm.url} onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })} placeholder="https://t.me/yourchannel or mailto:you@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-label">Label (optional)</Label>
                <Input id="s-label" value={createForm.label} onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })} placeholder="e.g. Telegram Support" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-order">Order</Label>
                <Input id="s-order" type="number" min="0" value={createForm.order} onChange={(e) => setCreateForm({ ...createForm, order: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createLink} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Add link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
