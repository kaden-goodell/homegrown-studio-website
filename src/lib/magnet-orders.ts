// src/lib/magnet-orders.ts
/**
 * Photo magnet orders and their photos (Netlify Blobs; `.data/` on disk in dev).
 *
 * Photos: store `magnet-photos`, key `p-<draftId>-<uploadedMs>-<rand>`, value =
 * JSON string of the base64 JPEG. Upload time lives in the key so cleanup
 * never reads a photo to know its age.
 * Orders: store `magnet-orders`, keys `order-<reference>` and `pending-<draftId>`.
 * Deliberately NOT in the weekly archive (netlify/functions/archive-records.ts):
 * photos would bloat it.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { shopConfig } from '@config/shop.config'
import { DONE_STATUSES, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'

export * from '@lib/magnet-status'

const logger = createLogger('magnet-orders')
const photos = () => makeKvStore('magnet-photos', 'magnet-photos')
const orders = () => makeKvStore('magnet-orders', 'magnet-orders')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PHOTO_ID_RE = /^\d{13}-[0-9a-f]{8}$/
const REF_RE = /^M-[A-Z0-9]{6}$/
export const isDraftId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
export const isPhotoId = (v: unknown): v is string => typeof v === 'string' && PHOTO_ID_RE.test(v)
export const isReference = (v: unknown): v is string => typeof v === 'string' && REF_RE.test(v)

export function newReference(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return `M-${Array.from(randomBytes(6), (b) => abc[b % abc.length]).join('')}`
}

const photoKey = (draftId: string, photoId: string) => `p-${draftId}-${photoId}`
function parsePhotoKey(key: string): { draftId: string; photoId: string; at: number } | null {
  const m = /^p-([0-9a-f-]{36})-((\d{13})-[0-9a-f]{8})$/.exec(key)
  return m ? { draftId: m[1], photoId: m[2], at: Number(m[3]) } : null
}
const parse = <T>(raw: string | null, key: string): T | null => {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { logger.error('corrupt magnet record skipped', { key }); return null }
}

// --- photos ---
export async function savePhoto(draftId: string, jpeg: Buffer, now = new Date()): Promise<string> {
  const photoId = `${String(now.getTime()).padStart(13, '0')}-${randomBytes(4).toString('hex')}`
  await photos().set(photoKey(draftId, photoId), JSON.stringify(jpeg.toString('base64')))
  return photoId
}

export async function getPhoto(draftId: string, photoId: string): Promise<Buffer | null> {
  if (!isDraftId(draftId) || !isPhotoId(photoId)) return null
  const raw = await photos().get(photoKey(draftId, photoId))
  return raw ? Buffer.from(JSON.parse(raw) as string, 'base64') : null
}

export async function draftPhotoIds(draftId: string): Promise<string[]> {
  return (await photos().list(`p-${draftId}-`)).map(parsePhotoKey).filter((p) => p?.draftId === draftId).map((p) => p!.photoId).sort()
}

async function deleteDraft(draftId: string): Promise<void> {
  const kv = photos()
  for (const photoId of await draftPhotoIds(draftId)) await kv.delete(photoKey(draftId, photoId))
}

// --- pending markers (paid-or-maybe-paid, order not yet saved) ---
export async function markPending(draftId: string, info: { attemptId: string; email: string; squareOrderId?: string }, now = new Date()): Promise<void> {
  await orders().set(`pending-${draftId}`, JSON.stringify({ ...info, at: now.toISOString() }))
}
export async function getPending(draftId: string): Promise<{ attemptId: string; email: string; squareOrderId?: string; at: string } | null> {
  return parse(await orders().get(`pending-${draftId}`), `pending-${draftId}`)
}
export async function clearPending(draftId: string): Promise<void> {
  await orders().delete(`pending-${draftId}`)
}

// --- orders ---
export async function saveOrder(order: MagnetOrder): Promise<void> {
  await orders().set(`order-${order.id}`, JSON.stringify(order))
}

export async function getOrder(id: string): Promise<MagnetOrder | null> {
  if (!isReference(id)) return null
  return parse<MagnetOrder>(await orders().get(`order-${id}`), id)
}

export async function listOrders({ includeSimulated = false } = {}): Promise<MagnetOrder[]> {
  const kv = orders()
  const keys = await kv.list('order-')
  const all = await Promise.all(keys.map(async (k) => parse<MagnetOrder>(await kv.get(k), k)))
  return all
    .filter((o): o is MagnetOrder => !!o && (includeSimulated || !o.simulated))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function orderForDraft(draftId: string): Promise<MagnetOrder | null> {
  return (await listOrders({ includeSimulated: true })).find((o) => o.draftId === draftId) ?? null
}

export type StatusResult = { order: MagnetOrder; changed: boolean } | 'not_found' | 'wrong_delivery' | 'photos_deleted'

/** Last write wins between two owners; the second tap simply re-applies. */
export async function setOrderStatus(id: string, status: MagnetStatus, now = new Date()): Promise<StatusResult> {
  const order = await getOrder(id)
  if (!order) return 'not_found'
  if (order.status === status) return { order, changed: false }
  if ((status === 'ready' || status === 'picked_up') && order.delivery !== 'pickup') return 'wrong_delivery'
  if (status === 'shipped' && order.delivery !== 'ship') return 'wrong_delivery'
  if (order.photosDeletedAt && !DONE_STATUSES.includes(status)) return 'photos_deleted'
  const updated: MagnetOrder = { ...order, status, doneAt: DONE_STATUSES.includes(status) ? (order.doneAt ?? now.toISOString()) : null }
  await saveOrder(updated)
  return { order: updated, changed: true }
}

/** True the first time; false if that email was already sent. */
export async function markEmailed(id: string, kind: 'ready' | 'shipped', now = new Date()): Promise<boolean> {
  const order = await getOrder(id)
  if (!order || order.emailed?.[kind]) return false
  await saveOrder({ ...order, emailed: { ...order.emailed, [kind]: now.toISOString() } })
  return true
}

// --- cleanup ---
export interface CleanupResult { draftsDeleted: number; ordersCleared: number; dryRun: boolean; drafts: string[]; orders: string[] }

/** Drafts nobody paid for (> 24 h, no order, no pending marker) and finished orders' photos (> 30 days after done). */
export async function cleanup(now = new Date(), { dryRun = false } = {}): Promise<CleanupResult> {
  const kv = orders()
  const all = await listOrders({ includeSimulated: true })
  const keep = new Set(all.map((o) => o.draftId))
  const pendingCutoff = now.getTime() - shopConfig.photoRetentionDays * 86_400_000
  for (const key of await kv.list('pending-')) {
    const p = parse<{ at: string }>(await kv.get(key), key)
    const draftId = key.slice('pending-'.length)
    if (p && Date.parse(p.at) > pendingCutoff) keep.add(draftId)
    else if (!dryRun) await kv.delete(key)
  }

  const draftCutoff = now.getTime() - shopConfig.draftRetentionHours * 3_600_000
  const newest = new Map<string, number>()
  for (const p of (await photos().list('p-')).map(parsePhotoKey)) if (p) newest.set(p.draftId, Math.max(newest.get(p.draftId) ?? 0, p.at))
  const drafts = [...newest].filter(([d, at]) => !keep.has(d) && at <= draftCutoff).map(([d]) => d)

  const doneCutoff = now.getTime() - shopConfig.photoRetentionDays * 86_400_000
  const done = all.filter((o) => !o.photosDeletedAt && o.doneAt && Date.parse(o.doneAt) <= doneCutoff).map((o) => o.id)

  if (!dryRun) {
    for (const d of drafts) await deleteDraft(d)
    for (const id of done) {
      const fresh = await getOrder(id) // re-read: an owner may have changed it during the run
      if (!fresh || fresh.photosDeletedAt || !fresh.doneAt || Date.parse(fresh.doneAt) > doneCutoff) continue
      await deleteDraft(fresh.draftId)
      await saveOrder({ ...fresh, photosDeletedAt: now.toISOString() })
    }
  }
  return { draftsDeleted: drafts.length, ordersCleared: done.length, dryRun, drafts, orders: done }
}
