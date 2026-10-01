// Generate PNG icons (192x192, 512x512) and an OG image (1200x630) from an SVG base.
// Run: bun run /home/z/my-project/scripts/generate-images.ts
import sharp from 'sharp'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const PUBLIC = '/home/z/my-project/public'
const SCRIPTS = '/home/z/my-project/scripts'
await mkdir(PUBLIC, { recursive: true })

// ---- 1. App icon SVG ----
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#059669"/>
  <text x="256" y="340" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="280" font-weight="900" text-anchor="middle" fill="#ffffff">D</text>
</svg>`

await writeFile(path.join(PUBLIC, 'icon.svg'), iconSvg)
await sharp(Buffer.from(iconSvg)).resize(192, 192).png().toFile(path.join(PUBLIC, 'icon-192.png'))
await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile(path.join(PUBLIC, 'icon-512.png'))
await sharp(Buffer.from(iconSvg)).resize(32, 32).png().toFile(path.join(PUBLIC, 'favicon-32.png'))
await sharp(Buffer.from(iconSvg)).resize(16, 16).png().toFile(path.join(PUBLIC, 'favicon-16.png'))
await sharp(Buffer.from(iconSvg)).resize(180, 180).png().toFile(path.join(PUBLIC, 'apple-touch-icon.png'))
console.log('Icons generated')

// ---- 2. OG image SVG (1200x630) ----
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#022c22"/>
      <stop offset="50%" stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <radialGradient id="glow" cx="20%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="80%" cy="100%" r="60%">
      <stop offset="0%" stop-color="#2dd4bf" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#2dd4bf" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <!-- Logo block -->
  <g transform="translate(80, 80)">
    <rect width="80" height="80" rx="16" fill="#10b981"/>
    <text x="40" y="62" font-family="Inter, sans-serif" font-size="48" font-weight="900" text-anchor="middle" fill="#0a0a0a">D</text>
    <text x="100" y="55" font-family="Inter, sans-serif" font-size="32" font-weight="700" fill="#ffffff">DigitalVault</text>
  </g>

  <!-- Main headline -->
  <text x="80" y="280" font-family="Inter, sans-serif" font-size="72" font-weight="800" fill="#ffffff">License keys &amp; digital</text>
  <text x="80" y="360" font-family="Inter, sans-serif" font-size="72" font-weight="800" fill="#10b981">assets marketplace.</text>

  <!-- Subtitle -->
  <text x="80" y="430" font-family="Inter, sans-serif" font-size="28" font-weight="400" fill="#a1a1aa">Crypto deposits · Instant key delivery · Admin-managed</text>

  <!-- Feature badges -->
  <g transform="translate(80, 480)" font-family="Inter, sans-serif" font-size="20" font-weight="600">
    <g>
      <rect width="220" height="56" rx="28" fill="#10b981" fill-opacity="0.15" stroke="#10b981" stroke-opacity="0.4"/>
      <circle cx="32" cy="28" r="8" fill="#10b981"/>
      <text x="52" y="35" fill="#d1fae5">Instant delivery</text>
    </g>
    <g transform="translate(240, 0)">
      <rect width="180" height="56" rx="28" fill="#10b981" fill-opacity="0.15" stroke="#10b981" stroke-opacity="0.4"/>
      <circle cx="32" cy="28" r="8" fill="#10b981"/>
      <text x="52" y="35" fill="#d1fae5">Crypto deposits</text>
    </g>
    <g transform="translate(440, 0)">
      <rect width="220" height="56" rx="28" fill="#10b981" fill-opacity="0.15" stroke="#10b981" stroke-opacity="0.4"/>
      <circle cx="32" cy="28" r="8" fill="#10b981"/>
      <text x="52" y="35" fill="#d1fae5">Bulk license keys</text>
    </g>
  </g>

  <!-- Decorative bottom bar -->
  <rect x="0" y="620" width="1200" height="10" fill="#10b981"/>
</svg>`

await writeFile(path.join(SCRIPTS, 'og-image.svg'), ogSvg)
await sharp(Buffer.from(ogSvg)).png().toFile(path.join(PUBLIC, 'opengraph-image.png'))
await sharp(Buffer.from(ogSvg)).resize(1200, 630).jpeg({ quality: 90 }).toFile(path.join(PUBLIC, 'opengraph-image.jpg'))
console.log('OG image generated (PNG + JPG)')

console.log('All images generated successfully.')
