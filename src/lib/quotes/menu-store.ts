/**
 * The quote menu (kv `quote-menu`): the items packages are built from, the
 * owners' saved packages, and quote settings. Owner-only writes, each
 * compare-and-set. Server only.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { casRetry } from '@lib/cas-retry'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import { DEFAULT_SETTINGS, type MenuItem, type QuoteSettings, type SavedPackage } from './types'

const kv = makeKvStore('quote-menu', 'quote-menu')

export class QuoteStoreError extends Error {
  constructor(public why: string, message = why) { super(message) }
}

export interface MenuDoc { items: MenuItem[]; syncedAt: string | null }

async function readJson<T>(key: string, empty: T): Promise<{ value: T; etag: string | null; exists: boolean }> {
  const { value, etag } = await kv.getWithMeta(key)
  return { value: value ? (JSON.parse(value) as T) : empty, etag, exists: value != null }
}

/** Read-modify-write one document; `fn` returning null writes nothing. */
async function update<T>(key: string, empty: T, fn: (cur: T) => T | null): Promise<T> {
  assertClassWritesAllowed()
  return casRetry<T>(async () => {
    const cur = await readJson(key, empty)
    const next = fn(cur.value)
    if (next === null) return { done: true, value: cur.value }
    const ok = await kv.setIfMatch(key, JSON.stringify(next), cur.etag, cur.exists)
    return ok ? { done: true, value: next } : { done: false }
  })
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`

export async function getMenu(): Promise<MenuDoc> {
  return (await readJson<MenuDoc>('menu', { items: [], syncedAt: null })).value
}

export function saveMenuItems(fn: (items: MenuItem[]) => MenuItem[], syncedAt?: string): Promise<MenuDoc> {
  return update<MenuDoc>('menu', { items: [], syncedAt: null }, (cur) => ({
    items: fn(cur.items),
    syncedAt: syncedAt ?? cur.syncedAt,
  }))
}

export async function listPackages(): Promise<SavedPackage[]> {
  return (await readJson<{ list: SavedPackage[] }>('packages', { list: [] })).value.list
}

export async function savePackage(p: SavedPackage): Promise<SavedPackage[]> {
  const doc = await update<{ list: SavedPackage[] }>('packages', { list: [] }, (cur) => ({
    list: [...cur.list.filter((x) => x.id !== p.id), p],
  }))
  return doc.list
}

export async function deletePackage(id: string): Promise<SavedPackage[]> {
  const doc = await update<{ list: SavedPackage[] }>('packages', { list: [] }, (cur) =>
    cur.list.some((x) => x.id === id) ? { list: cur.list.filter((x) => x.id !== id) } : null)
  return doc.list
}

/** Saved settings over the defaults (25% cap, yellow from 20%, 50% deposit, 14 days). */
export async function getSettings(): Promise<QuoteSettings> {
  const { value } = await readJson<Partial<QuoteSettings>>('settings', {})
  return { ...DEFAULT_SETTINGS, ...value }
}

const pctOk = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

export async function saveSettings(patch: Partial<QuoteSettings>, expectedUpdatedAt: string, now = new Date()): Promise<QuoteSettings> {
  const next = { ...(await getSettings()), ...patch }
  if (!pctOk(next.capPct, 0, 90) || !pctOk(next.yellowFromPct, 0, 90) || !pctOk(next.depositPct, 1, 100) || !pctOk(next.expiryDays, 1, 120)) {
    throw new QuoteStoreError('invalid', 'Check the numbers: percents 0–90, deposit 1–100, days 1–120.')
  }
  if (next.yellowFromPct > next.capPct) throw new QuoteStoreError('invalid', 'Yellow has to start at or below the cap.')
  const saved = await update<Partial<QuoteSettings>>('settings', {}, (cur) => {
    if ((cur.updatedAt ?? '') !== expectedUpdatedAt) throw new QuoteStoreError('stale', 'Someone saved these settings a moment ago. Reopen them and try again.')
    return { ...next, updatedAt: now.toISOString() }
  })
  return { ...DEFAULT_SETTINGS, ...saved }
}
