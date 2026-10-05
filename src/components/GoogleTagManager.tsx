import Script from 'next/script'
import { getCurrentUser } from '@/lib/auth'

/**
 * Google Tag Manager, driven by the NEXT_PUBLIC_GTM_ID env var.
 *
 * Why this exists alongside the DB-backed snippet injector
 * (src/components/TrackingScripts.tsx): that one stores raw pasted markup so
 * analytics can be changed from the admin panel with no redeploy. This one is
 * the deployment-time path — the container ID arrives with the build, so it is
 * versioned in .env and cannot be changed by anyone who is not already
 * deploying. Both feed the same site; the noscript iframe and loader here are
 * additive to whatever the admin panel has stored.
 *
 * CSP: googletagmanager.com is already allowed in both `script-src` and
 * `frame-src` (src/proxy.ts), so no Content-Security-Policy change is needed.
 *
 * Placement note: GTM's loader belongs in <head>, but its <noscript> iframe is
 * only valid markup at the very start of <body> — browsers drop a noscript
 * element that appears in <head>. Hence the two positions, mirroring
 * TrackingScripts.
 *
 * NEXT_PUBLIC_* values are INLINED AT BUILD TIME, so changing the container ID
 * requires a rebuild/redeploy, not just a restart.
 */
export async function GoogleTagManager({ position }: { position: 'head' | 'body' }) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID?.trim()

  // Unset is the normal case for local development — render nothing.
  if (!gtmId) return null

  // Only accept a real container ID. This value reaches the page source, so a
  // malformed paste must not be interpolated into a script tag.
  if (!/^GTM-[A-Za-z0-9]{4,}$/.test(gtmId)) {
    console.warn(
      '[gtm] NEXT_PUBLIC_GTM_ID does not look like a container ID (expected GTM-XXXXXX). Not loading.',
    )
    return null
  }

  // Admin activity should never pollute analytics — same rule the DB-backed
  // injector follows. Checked once, on the head pass, so the decision is made
  // in a single place per request.
  if (position === 'head') {
    const user = await getCurrentUser()
    if (user?.role === 'ADMIN') return null
  }

  if (position === 'body') {
    return (
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    )
  }

  return (
    // beforeInteractive, not afterInteractive: a tag manager should run as
    // early as possible so it can capture the initial page view. Next's
    // afterInteractive defers the tag to after hydration and places it in
    // <body>, which measurably loses early interactions.
    <Script id="gtm-loader" strategy="beforeInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
    </Script>
  )
}