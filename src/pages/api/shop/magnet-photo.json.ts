// src/pages/api/shop/magnet-photo.json.ts
import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { shopConfig } from '@config/shop.config'
import { isDraftId, savePhoto, draftPhotoIds } from '@lib/magnet-orders'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:shop:magnet-photo')
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** POST { draftId, image: data:image/jpeg;base64,… } → { data: { photoId } }. One finished 600×600 magnet photo. */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`magnet-photo:${clientAddress}`, 80, 10 * 60_000)) return json(429, { error: 'Too many photos at once. Give it a minute.' })
  const body = await request.json().catch(() => null)
  if (!isDraftId(body?.draftId)) return json(400, { error: 'Missing order draft.' })
  const m = typeof body?.image === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null
  if (!m) return json(400, { error: 'That photo did not come through. Try again.' })
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > shopConfig.maxPhotoBytes) return json(413, { error: 'That photo is too large.' })
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return json(400, { error: 'That photo did not come through. Try again.' })
  try {
    if ((await draftPhotoIds(body.draftId)).length >= shopConfig.maxPhotosPerDraft) return json(400, { error: 'That is the most photos one order can hold.' })
    const photoId = await savePhoto(body.draftId, buf)
    return json(200, { data: { photoId } })
  } catch (err) {
    logger.error('photo save failed', { error: err instanceof Error ? err.message : String(err) })
    return json(500, { error: 'We could not save that photo. Try again.' })
  }
}
