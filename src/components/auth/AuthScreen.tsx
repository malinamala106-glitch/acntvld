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
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  async function submit(mode: 'login' | 'register') {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (mode === 'login') {
        onLogin(await api.login(email, password))
        return
      }
      // The register route answers the same way whether or not the address was
      // already taken — it must not confirm that, or the form becomes an
      // account-enumeration oracle. So the ambiguous case surfaces here as a
      // neutral notice rather than an error.
      const { user, notice: alreadyKnown } = await api.register(email, password, name)
      if (user) {
        onLogin(user)
      } else {
        setNotice(alreadyKnown || 'Check your inbox to confirm the account, then sign in.')
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
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
                    {notice && <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p>}
                    <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create account'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
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
