// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DigitalVault — License Key & Digital Asset Marketplace',
    short_name: 'DigitalVault',
    description:
      'Buy and sell license keys, product keys, VPN subscriptions, and other digital assets. Crypto deposits, instant delivery, bulk keys.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#059669',
    orientation: 'portrait-primary',
    categories: ['shopping', 'business', 'productivity'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}
