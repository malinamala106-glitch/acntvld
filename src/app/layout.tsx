import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ChatWidgetLazy } from '@/components/shared/ChatWidgetLazy'
import { TrackingScripts } from '@/components/TrackingScripts'
import { GoogleTagManager } from '@/components/GoogleTagManager'
import { jsonLdHtml } from '@/lib/json-ld'
import { serverSiteUrl } from '@/lib/site-url'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

/**
 * Every route renders per request.
 *
 * Two reasons, both about deploys:
 *
 * 1. Prerendering used to make `next build` query the database for the pages
 *    it generated at build time (about, contact, terms, privacy, the blog
 *    list). A deploy with no DATABASE_URL — or one whose URL doesn't match the
 *    Prisma datasource — failed the whole build (`Failed to collect page data`)
 *    instead of coming up. The database is a RUN time dependency, never a
 *    build-time one.
 * 2. Anything baked in at build time is stale the moment the operator adds the
 *    database, or an admin edits site copy, with no redeploy to refresh it.
 *
 * Declaring it on the root layout covers every page in one place, including
 * pages that don't read the database themselves. Cheap reads stay cached
 * through the tag cache in @/lib/cache, so this is not a per-request-cost
 * decision — it only moves WHERE the render happens.
 */
export const dynamic = 'force-dynamic'

const baseUrl = serverSiteUrl()
const siteName = 'DigitalVault'
const title = 'DigitalVault — License Key & Digital Asset Marketplace'
const description =
  'Buy and sell license keys, product keys, VPN subscriptions, software licenses, and other digital assets. Crypto deposits, instant key delivery, bulk uploads, and admin-managed orders.'
const keywords = [
  'license keys',
  'product keys',
  'digital assets marketplace',
  'software keys',
  'VPN subscriptions',
  'buy software keys',
  'crypto marketplace',
  'Windows 11 key',
  'Office 2021 key',
  'NordVPN',
  'ChatGPT Plus',
  'Steam gift card',
]

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: title,
    template: `%s · ${siteName}`,
  },
  description,
  keywords,
  authors: [{ name: 'DigitalVault' }],
  creator: 'DigitalVault',
  publisher: 'DigitalVault',
  applicationName: siteName,
  category: 'shopping',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    url: baseUrl,
    title,
    description,
    siteName,
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'DigitalVault — License keys & digital assets marketplace',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/opengraph-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.webmanifest',
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#059669',
  colorScheme: 'light dark',
}

// JSON-LD structured data for the marketplace website.
// Helps Google understand what the site is and what it offers.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  '@id': `${baseUrl}#store`,
  name: siteName,
  url: baseUrl,
  description,
  image: `${baseUrl}/opengraph-image.png`,
  logo: `${baseUrl}/icon.svg`,
  currenciesAccepted: 'USD',
  paymentAccepted: 'Cryptocurrency',
  areaServed: 'Worldwide',
  knowsAbout: [
    'License keys',
    'Software keys',
    'Digital asset marketplace',
    'Crypto payments',
    'Instant digital delivery',
  ],
  potentialAction: {
    '@type': 'ViewAction',
    target: baseUrl,
    name: 'Browse marketplace',
  },
}

const orgLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${baseUrl}#org`,
  name: siteName,
  url: baseUrl,
  logo: `${baseUrl}/icon.svg`,
  description,
  sameAs: [] as string[],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tracking scripts injected into <head> (GTM, GA4, Meta Pixel, etc.) */}
        <TrackingScripts position="head" />
        {/* GTM loader from NEXT_PUBLIC_GTM_ID (deployment-time container) */}
        <GoogleTagManager position="head" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        {/* Tracking scripts injected before </body> (noscript tags, etc.) */}
        <TrackingScripts position="body" />
        {/* GTM <noscript> iframe — only valid at the start of <body> */}
        <GoogleTagManager position="body" />
        {/* Floating chat support widget — client-only, lazy-loaded after hydration */}
        <ChatWidgetLazy />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(orgLd) }}
        />
      </body>
    </html>
  )
}
