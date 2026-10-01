// Shared client helpers for the emoji-or-image-URL media fields used across
// products, auctions, and blog covers.

/** True when the value is a renderable image URL (local /uploads or absolute http(s)). */
export function isImageUrlValue(src: string | null | undefined): boolean {
  return !!src && (src.startsWith('/') || src.startsWith('http://') || src.startsWith('https://'))
}

/**
 * next/image needs width/height (or fill) to optimize. Media here lives in
 * aspect-ratio boxes, so `fill` + a sized parent is the right shape. Remote
 * hosts (any https origin admins paste) would need remotePatterns config per
 * host, so arbitrary external URLs render with next/image's `unoptimized`
 * mode instead — same DOM, no optimizer domain allowlist to maintain.
 */
export const smartImageProps = { fill: true as const, sizes: '(max-width: 768px) 100vw, 50vw' }
