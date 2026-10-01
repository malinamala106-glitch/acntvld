'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Eye, EyeOff, CheckCircle2, X } from 'lucide-react'

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

interface Props {
  user: User
  onDone: (u: User) => void
  onSignOut: () => void
}

// One-time setup shown after a first Google signup (and for any account that
// still has profileCompleted = false). The account is already authenticated;
// this step just adds a unique username + password so the user can also sign
// in without Google. There is no dismiss — the only exit is completing it or
// signing out.
export function ProfileSetup({ user, onDone, onSignOut }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')

  // Debounced availability probe so the user gets feedback before submitting.
  // The authoritative uniqueness check still runs on submit.
  useEffect(() => {
    const value = username.trim().toLowerCase()
    if (!value) {
      setUsernameStatus('idle')
      return
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$/.test(value)) {
      setUsernameStatus('invalid')
      return
    }
    setUsernameStatus('checking')
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await api.checkUsername(value)
        if (cancelled) return
        setUsernameStatus(res.available ? 'available' : 'taken')
      } catch {
        if (!cancelled) setUsernameStatus('idle')
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [username])

  const passwordsMatch = confirm.length > 0 && password === confirm
  const canSubmit =
    usernameStatus === 'available' &&
    password.length >= 6 &&
    passwordsMatch &&
    !loading

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (usernameStatus !== 'available') {
      setError('Please choose an available username')
      return
    }
    setLoading(true)
    try {
      const updated = await api.completeProfile(username.trim().toLowerCase(), password)
      onDone(updated)
    } catch (err: any) {
      setError(err.message || 'Failed to save your profile')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm">
          <CardHeader className="relative">
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="w-4 h-4" />
            </button>
            <CardTitle className="text-xl pr-6">Welcome! Finish setting up your account</CardTitle>
            <CardDescription>Add a username and password so you can sign in without Google.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              {/* Email (from Google) — read-only */}
              <div className="space-y-1.5">
                <Label>Email</Label>
                <div className="text-sm px-3 py-2 rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
                  {user.email} <span className="text-xs text-zinc-400">(from Google)</span>
                </div>
              </div>

              {/* Username */}
              <div className="space-y-1.5">
                <Label htmlFor="setup-username">Choose a username</Label>
                <Input
                  id="setup-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="demo_buyer"
                  autoComplete="username"
                  autoFocus
                  className={
                    usernameStatus === 'available' ? 'border-emerald-400'
                      : usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'border-red-400'
                        : ''
                  }
                />
                {usernameStatus === 'checking' && (
                  <p className="text-xs text-zinc-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking availability…</p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Available</p>
                )}
                {usernameStatus === 'taken' && <p className="text-xs text-red-500">That username is already taken</p>}
                {usernameStatus === 'invalid' && (
                  <p className="text-xs text-red-500">3–30 characters: letters, numbers, dot, underscore or hyphen</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">Set a password</Label>
                <div className="relative">
                  <Input
                    id="setup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="min 6 characters"
                    autoComplete="new-password"
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
                {password.length > 0 && password.length < 6 && (
                  <p className="text-xs text-red-500">Password must be at least 6 characters</p>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <Label htmlFor="setup-confirm">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="setup-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirm.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!canSubmit}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Saving…</> : 'Save and continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
