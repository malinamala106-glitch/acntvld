'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, ShieldCheck, Wallet, Key, Bitcoin } from 'lucide-react'

interface Props {
  onLogin: (u: User) => void
}

export function AuthScreen({ onLogin }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  async function submit(mode: 'login' | 'register') {
    setError('')
    setLoading(true)
    try {
      const user = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, name)
      onLogin(user)
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function fillDemo(kind: 'admin' | 'buyer') {
    if (kind === 'admin') {
      setEmail('admin@asset.shop')
      setPassword('admin123')
    } else {
      setEmail('demo@buyer.shop')
      setPassword('demo123')
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left: hero / brand */}
      <div className="lg:w-1/2 bg-gradient-to-br from-emerald-950 via-zinc-950 to-zinc-950 text-white p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-emerald-500/30 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full bg-teal-400/20 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 mb-12">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center font-bold text-zinc-950">
              D
            </div>
            <span className="text-xl font-bold tracking-tight">DigitalVault</span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-4">
            Sell license keys &amp; digital goods at scale.
          </h1>
          <p className="text-zinc-300 text-lg mb-8 max-w-md">
            A lightweight storefront for software keys, product licenses, and other digital assets — with crypto deposits and instant delivery.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Feature icon={<Key className="w-5 h-5" />} title="Instant delivery" desc="Keys delivered on payment" />
            <Feature icon={<Bitcoin className="w-5 h-5" />} title="Crypto deposits" desc="Multiple wallets &amp; networks" />
            <Feature icon={<ShieldCheck className="w-5 h-5" />} title="Admin controls" desc="Full product &amp; order control" />
            <Feature icon={<Wallet className="w-5 h-5" />} title="Wallet balance" desc="Buyer pre-paid balance" />
          </div>
        </div>
        <div className="relative text-xs text-zinc-400 mt-12">
          © {new Date().getFullYear()} DigitalVault. Demo marketplace. Not for production use without proper audit.
        </div>
      </div>

      {/* Right: auth form */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-12 bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-md">
          <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">Welcome</CardTitle>
              <CardDescription>Sign in or create an account to start trading.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Sign in</TabsTrigger>
                  <TabsTrigger value="register">Create account</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submit('login')
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="••••••••"
                      />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign in'}
                    </Button>
                  </form>
                  <div className="flex gap-2 mt-4">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => fillDemo('admin')}>
                      Try Admin
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => fillDemo('buyer')}>
                      Try Buyer
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="register">
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submit('register')
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="name">Display name</Label>
                      <Input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="remail">Email</Label>
                      <Input
                        id="remail"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rpassword">Password</Label>
                      <Input
                        id="rpassword"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="min 6 characters"
                      />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create account'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
                <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">Demo accounts</p>
                <p>Admin: admin@asset.shop / admin123</p>
                <p>Buyer: demo@buyer.shop / demo123 (balance $100)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-zinc-400">{desc}</div>
      </div>
    </div>
  )
}
