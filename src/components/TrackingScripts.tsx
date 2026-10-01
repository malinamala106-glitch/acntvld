import { headers } from 'next/headers'
import { getTrackingSettings } from '@/lib/tracking'
import { getCurrentUser } from '@/lib/auth'

// Server component that injects raw tracking scripts into the page.
// Used in two positions: <head> and before </body>.
//
// Skips injection when:
//   - tracking is disabled (master toggle off)
//   - prodOnly is true and we're in development mode
//   - the current user is an admin (admin activity should never pollute analytics)
//
// Uses dangerouslySetInnerHTML — this is the correct approach for raw <script> tags
// provided by Google/Meta/etc. Do NOT use Next.js <Script> component for this.
export async function TrackingScripts({ position }: { position: 'head' | 'body' }) {
  const settings = await getTrackingSettings()

  // Master toggle
  if (!settings.enabled) return null

  // Production-only check
  if (settings.prodOnly && process.env.NODE_ENV !== 'production') return null

  // Skip tracking for admin users — check auth cookie server-side.
  // Admin activity should never pollute analytics.
  const user = await getCurrentUser()
  if (user?.role === 'ADMIN') return null

  // Also check pathname from headers (covers /admin/* if route groups are added later)
  const headerList = await headers()
  const pathname = headerList.get('x-pathname') || headerList.get('x-invoke-path') || ''
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    return null
  }

  const raw = position === 'head' ? settings.headScripts : settings.bodyScripts
  if (!raw || !raw.trim()) return null

  return <div dangerouslySetInnerHTML={{ __html: raw }} />
}
