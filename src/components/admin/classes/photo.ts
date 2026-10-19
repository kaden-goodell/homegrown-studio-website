/**
 * Class photos are cropped to 4:3 in the browser (the card's shape), scaled so
 * the longest side is at most 1600px, and sent as a JPEG under 4 MB.
 */
import { adminHeaders, PHOTO } from './api'

export const MAX_SIDE = 1600
export const MAX_BYTES = 4 * 1024 * 1024

/** The centred 4:3 crop of a w×h picture, and the size to draw it at. Pure. */
export function cropRect(w: number, h: number, maxSide = MAX_SIDE) {
  let sw = w, sh = Math.round((w * 3) / 4)
  if (sh > h) { sh = h; sw = Math.round((h * 4) / 3) }
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  return { sx: Math.round((w - sw) / 2), sy: Math.round((h - sh) / 2), sw, sh, dw: Math.round(sw * scale), dh: Math.round(sh * scale) }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo we can read.')) }
    img.src = url
  })
}

export async function cropToJpeg(file: File): Promise<Blob> {
  const img = await loadImage(file)
  const r = cropRect(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = r.dw
  canvas.height = r.dh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser can’t prepare the photo. Try another browser.')
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh)
  for (const q of [0.85, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q))
    if (blob && blob.size < MAX_BYTES) return blob
  }
  throw new Error('The photo is too large. Try a smaller one.')
}

/** Crop, then upload; the URL to use as the class's imageUrl, or the reason it failed. */
export async function uploadPhoto(file: File): Promise<{ url: string } | { error: string }> {
  let blob: Blob
  try {
    blob = await cropToJpeg(file)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'That photo didn’t work. Try another.' }
  }
  const form = new FormData()
  form.append('file', new File([blob], 'class.jpg', { type: 'image/jpeg' }))
  try {
    const res = await fetch(PHOTO, { method: 'POST', headers: adminHeaders(), body: form })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json?.data?.url) return { url: json.data.url }
    return { error: json?.error || 'The photo didn’t upload. Try again.' }
  } catch {
    return { error: 'The photo didn’t upload. Check the connection and try again.' }
  }
}
