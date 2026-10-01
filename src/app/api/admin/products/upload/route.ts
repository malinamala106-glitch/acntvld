import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { rateLimit, clientIp, rateLimitResponse } from '@/lib/rate-limit'
import { sanitizeHtml } from '@/lib/sanitize'
import { revalidatePath } from 'next/cache'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// POST /api/admin/products/upload — admin-only product image upload.
//
// Accepts multipart/form-data with a `file` field (JPG/PNG/WebP/SVG, max 2MB)
// and stores it under public/uploads with a random, user-input-free filename.
// Returns { url: "/uploads/<name>" } — the shape ImageUploader expects to put
// straight into product.image (existing renderers treat a leading "/" as a URL).
//
// Security, in order of what actually stops what:
//   - requireAdmin(): only admins can write files at all (403 otherwise).
//   - Rate limited: 20 uploads / 10 min per IP — bounds abuse of a stolen session.
//   - Size cap (2MB): enforced on the received buffer, not the client's claim.
//   - Type validation in TWO layers: the declared MIME type AND the file's
//     magic bytes. A renamed .exe reporting image/png is caught by the bytes.
//   - SVG is sanitized with DOMPurify before storage — SVG can carry <script>,
//     event handlers and javascript: links, and it renders in the browser like
//     any page, so an unsanitized SVG upload is a stored-XSS vector.
//   - Random filenames (crypto.randomUUID): no path traversal, no overwriting
//     other uploads, no user-controlled bytes ever touch the filesystem path.
//   - Only the extension comes from the validated content type.

const MAX_BYTES = 2 * 1024 * 1024 // 2MB, mirrors the client-side cap

// Map the allowed declared MIME types to a safe file extension.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

// Magic-byte signatures for the binary formats (checked against the buffer so
// a mislabeled payload can't sneak through as an image).
const MAGIC: { ext: string; bytes: number[]; offset?: number }[] = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // "WEBP" at offset 8 (RIFF....WEBP)
]

function detectImageType(buf: Buffer): string | null {
  for (const sig of MAGIC) {
    const offset = sig.offset ?? 0
    if (buf.length >= offset + sig.bytes.length && sig.bytes.every((b, i) => buf[offset + i] === b)) {
      return sig.ext
    }
  }
  return null // SVG is XML text — checked by content, not magic bytes
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 1024).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<?xml') ? head.includes('<svg') : head.startsWith('<svg')
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const limit = rateLimit({
      scope: 'admin:upload',
      identifier: clientIp(req),
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!limit.ok) return rateLimitResponse(limit)

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided (expected a "file" field).' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 2MB).' }, { status: 413 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const declaredMime = (file.type || '').toLowerCase()
    const ext = MIME_TO_EXT[declaredMime]

    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported type "${declaredMime || 'unknown'}". Allowed: JPG, PNG, WebP, SVG.` },
        { status: 415 }
      )
    }

    // Binary formats: magic bytes must agree with the declared type.
    if (ext !== 'svg') {
      const detected = detectImageType(buf)
      if (detected !== ext) {
        return NextResponse.json(
          { error: 'File content does not match its declared image type.' },
          { status: 415 }
        )
      }
    } else if (!looksLikeSvg(buf)) {
      return NextResponse.json({ error: 'File content is not valid SVG.' }, { status: 415 })
    }

    // SVG is active content — strip scripts/handlers/javascript: URLs before
    // it is ever served from our origin.
    const outBuf = ext === 'svg' ? Buffer.from(sanitizeHtml(buf.toString('utf8'))) : buf

    // Random, content-free filename: no traversal, no collisions, no overwrite.
    const name = `${Date.now().toString(36)}-${crypto.randomUUID()}.${ext}`

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadsDir, { recursive: true })
    await writeFile(path.join(uploadsDir, name), outBuf)

    // The production build is `output: "standalone"` — Next copies public/ at
    // build time only. Mirror the file into the standalone copy so uploads
    // made after a build are still served without a rebuild. Best-effort: dev
    // and non-standalone deployments don't have that directory.
    try {
      const standaloneDir = path.join(process.cwd(), '.next', 'standalone', 'public', 'uploads')
      await mkdir(standaloneDir, { recursive: true })
      await writeFile(path.join(standaloneDir, name), outBuf)
    } catch {}

    // New file — make sure /uploads/<name> serves on the first request.
    try {
      revalidatePath('/uploads')
    } catch {}

    return NextResponse.json({ url: `/uploads/${name}` })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
