'use client'

import { useEffect, useState } from 'react'
import type { SiteContent } from '@/lib/types'

/**
 * Resolve the admin-editable site content for client components that render it
 * without receiving it from a server page. Returns `provided` untouched when
 * given, otherwise fetches `/api/settings` once on mount (null until it lands —
 * consumers fall back to built-in defaults in the meantime).
 */
export function useSiteContent(provided?: SiteContent | null): SiteContent | null {
  const [fetched, setFetched] = useState<SiteContent | null>(null)

  useEffect(() => {
    if (provided) return
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/settings')
        if (!res.ok) return
        const data = await res.json()
        if (mounted && data.content) setFetched(data.content)
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [provided])

  return provided ?? fetched
}
