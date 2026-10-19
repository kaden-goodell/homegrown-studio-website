import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { makeKvStore } from '@lib/blob-store'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'

export const prerender = false

/**
 * Class photos. POST (owners only): multipart `file`, a JPEG, PNG or WebP up
 * to 4 MB; returns `{ data: { url } }`, a stable URL to use as the class's
 * imageUrl. GET ?id= serves it, to anyone: it's the picture on a public card
 * and Square reads it from here when the class goes on the POS.
 *
 * Stored like the form photos (base64 in the kv store, Blobs in prod,
 * .data/ in dev), with the type beside it.
 */
const kv = makeKvStore('class-photos', 'class-photos')
// Netlify functions take about 6 MB of request body; leave room for the form.
const MAX_BYTES = 4 * 1024 * 1024
const ID_RE = /^[a-f0-9]{24}$/
const TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
}

export const POST: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return json(400, { error: 'Pick a photo to upload.' })
  const type = file.type
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!TYPES[type] || !TYPES[type](bytes)) return json(400, { error: 'The photo has to be a JPEG, PNG or WebP.' })
  if (bytes.length > MAX_BYTES) return json(400, { error: 'The photo is too large. It can be up to 4 MB.' })
  const id = randomUUID().replace(/-/g, '').slice(0, 24)
  try {
    await kv.set(`photo-${id}`, JSON.stringify({ type, data: bytes.toString('base64') }))
  } catch {
    return json(503, { error: "The photo couldn't be saved. Try again." })
  }
  await recordAudit({ by: { ...adminActor(request), role: 'owner' }, action: 'class-photo-upload', target: { kind: 'class-photo', id }, details: { bytes: bytes.length, type } })
  return json(200, { data: { url: `${url.origin}/api/admin/classes/photo.json?id=${id}` } })
}

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id') ?? ''
  if (!ID_RE.test(id)) return new Response('Not found', { status: 404 })
  const raw = await kv.get(`photo-${id}`).catch(() => null)
  if (!raw) return new Response('Not found', { status: 404 })
  const { type, data } = JSON.parse(raw) as { type: string; data: string }
  return new Response(new Uint8Array(Buffer.from(data, 'base64')), {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
}
