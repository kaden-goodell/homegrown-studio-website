/**
 * Photos sent with a public form (/teach, /private-events). The phone shrinks
 * each one to a ~1600px JPEG before it is sent, so anything bigger than
 * MAX_PHOTO_BYTES is refused rather than stored.
 */

/** Per photo, after the phone has shrunk it. */
export const MAX_PHOTO_BYTES = 1_200_000

export type DecodedPhotos = { ok: true; photos: Buffer[] } | { ok: false; error: string }

/** Read `data:image/...;base64,` strings. `required` asks for at least one. */
export function decodePhotos(raw: unknown, max: number, { required = false } = {}): DecodedPhotos {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  if (required && list.length === 0) return { ok: false, error: 'Add at least one photo of your work.' }
  if (list.length > max) return { ok: false, error: `Up to ${max} photos.` }
  const photos: Buffer[] = []
  for (const p of list) {
    const m = typeof p === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p) : null
    if (!m) return { ok: false, error: 'One of the photos couldn’t be read. Try a different one.' }
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'One of the photos is too large. Try a different one.' }
    photos.push(bytes)
  }
  return { ok: true, photos }
}

/** Email attachments for the owners' copy. */
export function photoAttachments(photos: Buffer[]) {
  return photos.map((p, n) => ({ filename: `photo-${n + 1}.jpg`, content: p.toString('base64'), contentType: 'image/jpeg', encoding: 'base64' }))
}
