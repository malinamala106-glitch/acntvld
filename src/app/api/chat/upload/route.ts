import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resolveBuyerIdentity, ATTACHMENT_MAX_BYTES, sanitizeAttachmentName } from '@/lib/support-chat'

// POST /api/chat/upload — multipart upload of a chat attachment (form field
// "file") plus optional guestSession form field for guests.
//
// Rules from the spec:
//   - max 5MB
//   - JPG / PNG / PDF only — SVG is rejected outright (SVG can carry scripts
//     and is served inline by browsers)
//   - MIME validated from the Content-Type AND the magic bytes (never trust
//     the file extension)
//   - max 3 uploads per minute per user/guest
//   - stored under public/uploads/chat/ with a random name; the extension is
//     derived from the *validated* MIME type, never from the filename
//
// The response url is what the caller passes to /api/chat/send. Ownership is
// re-verified at send time (the conversation is resolved from the caller's
// identity), so an orphaned upload can't be injected into someone else's
// thread.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const identity = await resolveBuyerIdentity(form.get('guestSession'))
    if (!identity) {
      return NextResponse.json({ error: 'Authentication or valid guest session required' }, { status: 401 })
    }

    const up = rateLimit({
      scope: 'chat:upload',
      identifier: identity.userId ?? `guest_${identity.guestSessionId}`,
      limit: 3,
      windowMs: 60 * 1000,
    })
    if (!up.ok) return rateLimitResponse(up, 'Too many uploads. Please wait a moment.')

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File required' }, { status: 400 })
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 413 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 })
    }

    const mime = (file.type || '').toLowerCase()
    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'application/zip': 'zip',
    }
    if (!extByMime[mime]) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, PDF, or ZIP files are allowed' }, { status: 415 })
    }

    const buf = Buffer.from(await file.arrayBuffer())

    // Magic-byte validation — extensions and client Content-Type are both
    // untrustworthy.
    const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    const isPng =
      buf.length > 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    const isWebp =
      buf.length > 12 &&
      buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP'
    const isPdf = buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF'
    const isZip =
      buf.length > 4 &&
      buf[0] === 0x50 && buf[1] === 0x4b &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
      (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
    const magicMime = isJpeg
      ? 'image/jpeg'
      : isPng
        ? 'image/png'
        : isWebp
          ? 'image/webp'
          : isPdf
            ? 'application/pdf'
            : isZip
              ? 'application/zip'
              : null
    if (!magicMime || magicMime !== mime) {
      return NextResponse.json({ error: 'File content does not match its type' }, { status: 415 })
    }

    const ext = extByMime[magicMime]
    const name = `${randomBytes(12).toString('hex')}.${ext}`
    const dir = path.join(process.cwd(), 'public', 'uploads', 'chat')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, name), buf)
    // Best-effort mirror for standalone production builds.
    const standaloneDir = path.join(process.cwd(), '.next', 'standalone', 'public', 'uploads', 'chat')
    fs.mkdir(standaloneDir, { recursive: true })
      .then(() => fs.writeFile(path.join(standaloneDir, name), buf))
      .catch(() => {})

    return NextResponse.json({
      url: `/uploads/chat/${name}`,
      // Original (sanitized) filename for display; the stored file uses a
      // random name so a hostile filename can never hit the filesystem.
      name: sanitizeAttachmentName(file.name),
      size: buf.length,
      mime: magicMime,
    })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
