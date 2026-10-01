'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CopyButton } from '@/components/shared/CopyButton'
import { formatMoney } from '@/lib/format'
import { toast } from 'sonner'
import {
  ArrowRight, Clock, Bitcoin, Send, MessageCircle, CheckCircle2, XCircle, Loader2,
} from 'lucide-react'

interface Deposit {
  id: string
  network: string
  amount: number
  txHash: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  walletAddress: string | null
}

interface Props {
  deposit: Deposit
  siteName?: string
  telegramUrl?: string | null
  supportEmail?: string | null
}

// 10-minute countdown — the user expects admin verification within this window.
const COUNTDOWN_MS = 10 * 60 * 1000 // 10 minutes

export function DepositPendingPage({ deposit, siteName = 'DigitalVault', telegramUrl, supportEmail }: Props) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState(deposit.status)

  // Tick every second for the countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Poll for status updates every 10 seconds (in case admin approves/rejects)
  useEffect(() => {
    if (status !== 'PENDING') return
    let mounted = true
    const poll = async () => {
      try {
        const res = await fetch('/api/deposits')
        const data = await res.json()
        if (mounted && data.deposits) {
          const fresh = data.deposits.find((d: any) => d.id === deposit.id)
          if (fresh && fresh.status !== status) {
            setStatus(fresh.status)
            if (fresh.status === 'APPROVED') {
              toast.success('Your deposit was approved! Balance credited.')
            } else if (fresh.status === 'REJECTED') {
              toast.error('Your deposit was rejected. Please contact support.')
            }
          }
        }
      } catch {}
    }
    const interval = setInterval(poll, 10000)
    return () => { mounted = false; clearInterval(interval) }
  }, [deposit.id, status])

  // Countdown math
  const startTime = new Date(deposit.createdAt).getTime()
  const endTime = startTime + COUNTDOWN_MS
  const remainingMs = Math.max(0, endTime - now)
  const isExpired = remainingMs === 0

  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  // Progress percent (for the ring)
  const progress = Math.min(100, ((now - startTime) / COUNTDOWN_MS) * 100)

  // Status badge + message
  const isApproved = status === 'APPROVED'
  const isRejected = status === 'REJECTED'

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white" aria-hidden="true">D</div>
            <span className="font-bold hidden sm:inline">{siteName}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push('/')}>
            <ArrowRight className="w-4 h-4 rotate-180" />
            <span className="hidden sm:inline ml-1">Back to marketplace</span>
            <span className="sm:hidden">Back</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-3 sm:px-6 py-6 sm:py-10">
        {/* Status banner */}
        {isApproved ? (
          <Card className="mb-6 border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-5 sm:p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-emerald-800 dark:text-emerald-200">Deposit approved!</h2>
                <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">Your balance has been credited. You can now shop the marketplace.</p>
              </div>
            </CardContent>
          </Card>
        ) : isRejected ? (
          <Card className="mb-6 border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
            <CardContent className="p-5 sm:p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-red-800 dark:text-red-200">Deposit rejected</h2>
                <p className="text-sm text-red-700/80 dark:text-red-400/80">Your deposit was not approved. Please contact support via Telegram or chat below.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 text-emerald-600" /> Waiting for verification
              </CardTitle>
              <CardDescription>
                Your deposit has been submitted. An admin will verify it shortly.
                The countdown below is an estimated wait window — your balance will be credited automatically once approved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Countdown stopwatch */}
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-200 dark:text-zinc-800" />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      strokeLinecap="round"
                      className={isExpired ? 'text-red-500' : 'text-emerald-600'}
                      strokeDasharray={2 * Math.PI * 45}
                      strokeDashoffset={2 * Math.PI * 45 * (1 - progress / 100)}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className={`text-3xl font-bold tabular-nums ${isExpired ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {isExpired ? '00:00' : formatted}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1">
                      {isExpired ? 'Time elapsed' : 'minutes : seconds'}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 text-center max-w-sm">
                  {isExpired
                    ? "The estimated window has passed. Don't worry — your deposit is still being reviewed. Use the contact buttons below to reach support."
                    : 'Please wait while the admin verifies your transaction. This usually takes a few minutes.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deposit details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Deposit details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              <InfoRow label="Status" value={statusLabel(status)} />
              <InfoRow label="Currency" value="USDT" icon={<Bitcoin className="w-4 h-4 text-emerald-600" />} />
              <InfoRow label="Amount" value={`$${deposit.amount.toFixed(2)} USD`} copyValue={deposit.amount.toFixed(2)} />
              <InfoRow label="Network" value={deposit.network} />
              {deposit.walletAddress && (
                <InfoRow label="Address" value={deposit.walletAddress} copyValue={deposit.walletAddress} mono />
              )}
              {deposit.txHash && (
                <InfoRow label="TRX ID" value={truncate(deposit.txHash, 24)} copyValue={deposit.txHash} mono />
              )}
              <InfoRow label="Submitted" value={new Date(deposit.createdAt).toLocaleString()} />
              <InfoRow label="Reference" value={deposit.id.slice(0, 12)} copyValue={deposit.id} mono />
            </div>
          </CardContent>
        </Card>

        {/* Contact buttons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Need help with this deposit?</CardTitle>
            <CardDescription>Reach out to our support team — we usually reply quickly.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Contact via Telegram */}
            <Button
              asChild
              className="bg-sky-500 hover:bg-sky-600 text-white h-auto py-3"
              disabled={!telegramUrl}
            >
              <a href={telegramUrl || '#'} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2">
                <Send className="w-5 h-5" />
                <span className="font-medium">Contact via Telegram</span>
              </a>
            </Button>

            {/* Direct Chat — opens the floating chat widget by triggering its session */}
            <Button
              variant="outline"
              className="h-auto py-3 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              onClick={() => {
                // Dispatch a global event that the ChatWidget listens for to open itself
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('open-chat-widget'))
                  // Scroll to top so user sees the chat widget appear
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }
              }}
            >
              <MessageCircle className="w-5 h-5" />
              <span className="font-medium">Direct Chat</span>
            </Button>
          </CardContent>
          {supportEmail && (
            <CardContent className="pt-0 text-xs text-zinc-500 text-center">
              Or email us at <a href={`mailto:${supportEmail}`} className="text-emerald-600 hover:underline">{supportEmail}</a>
            </CardContent>
          )}
        </Card>

        {/* Footer actions */}
        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={() => router.push('/deposit')}>
            Submit another deposit
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1" onClick={() => router.push('/')}>
            Back to marketplace
          </Button>
        </div>
      </main>
    </div>
  )
}

function statusLabel(status: 'PENDING' | 'APPROVED' | 'REJECTED'): string {
  if (status === 'APPROVED') return 'Approved'
  if (status === 'REJECTED') return 'Rejected'
  return 'Pending review'
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}

function InfoRow({ label, value, copyValue, icon, mono }: { label: string; value: string; copyValue?: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate ${mono ? 'font-mono' : ''}`} title={value}>
          {value}
        </span>
        {copyValue && copyValue.length > 0 && (
          <CopyButton value={copyValue} />
        )}
      </div>
    </div>
  )
}
