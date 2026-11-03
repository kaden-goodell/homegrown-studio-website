/**
 * Read a photo uploaded through /admin (the class photo store, also used for
 * craft photos) by its id, on the server, without fetching any address.
 */
import { makeKvStore } from '@lib/blob-store'

const kv = makeKvStore('class-photos', 'class-photos')
const ID_RE = /^[a-f0-9]{24}$/

export async function readClassPhoto(id: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!ID_RE.test(id)) return null
  const raw = await kv.get(`photo-${id}`).catch(() => null)
  if (!raw) return null
  try {
    const { type, data } = JSON.parse(raw) as { type: string; data: string }
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null
    return { bytes: Buffer.from(data, 'base64'), type }
  } catch {
    return null
  }
}
