/**
 * A saved copy of Square's public class list (Kaden, 24 Nov 2026).
 *
 * Square's Classes API often takes more than 8 seconds. Every visitor to
 * /workshops (and the robot customer, around the clock) used to wait for it
 * whenever the 30-second in-memory copy had run out. Now the 5-minute alerts
 * job asks Square and saves the answer here; the public lists read the saved
 * copy while it is under SNAPSHOT_FRESH_MS old and ask Square live otherwise.
 *
 * Seat counts may be a few minutes old. That is display only: booking asks
 * Square again (workshops/book.json.ts lookUp + Square's own seat hold) before
 * anything is held or charged. Never use this where the answer decides a
 * booking or a charge.
 *
 * A failed refresh never replaces a good copy. (Square's provider throws on
 * errors; an empty list is a real "no classes".)
 *
 * Server only.
 */
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import type { Workshop } from '@providers/interfaces/workshop'

const logger = createLogger('workshop-snapshot')
const KEY = 'list'
/** A saved copy older than this is not used: the list asks Square live. */
export const SNAPSHOT_FRESH_MS = 25 * 60_000
/** How long the alerts job waits for Square before giving up on this refresh. */
export const REFRESH_TIMEOUT_MS = 25_000
/** A slow store read gives up and asks Square live instead. */
const READ_TIMEOUT_MS = 3_000

interface Saved { at: string; list: Workshop[] }

interface Deps {
  store: KvStore
  load: () => Promise<Workshop[]>
  now: () => Date
}

const defaults = (): Deps => ({
  store: makeKvStore('workshops-snapshot', 'workshops-snapshot'),
  load: async () => (await import('@config/providers')).providers.workshop.listWorkshops(),
  now: () => new Date(),
})
let deps: Deps | null = null
const d = (): Deps => (deps ??= defaults())

/** Test seam. null puts the real store and Square back. */
export function _setSnapshotDeps(next: Partial<Deps> | null): void {
  deps = next ? { ...defaults(), ...next } : null
}

const within = <T,>(p: Promise<T>, ms: number, what: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/** Ask Square and save the answer. Never throws; a failure keeps the copy already saved. */
export async function refreshWorkshopSnapshot(timeoutMs = REFRESH_TIMEOUT_MS): Promise<{ saved: boolean; count?: number; error?: string }> {
  const started = Date.now()
  let list: Workshop[]
  try {
    list = await within(d().load(), timeoutMs, 'Square class list')
    if (!Array.isArray(list)) throw new Error('Square answered with no list')
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Class list refresh failed — keeping the saved copy', { error, duration_ms: Date.now() - started })
    return { saved: false, error }
  }
  try {
    const saved: Saved = { at: d().now().toISOString(), list }
    await d().store.set(KEY, JSON.stringify(saved))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Class list copy could not be saved', { error })
    return { saved: false, error }
  }
  logger.info('Class list copy saved', { count: list.length, duration_ms: Date.now() - started })
  return { saved: true, count: list.length }
}

/**
 * The saved list if it is fresh (classes that have started since are dropped),
 * else null. Never throws: an unreadable copy reads as none.
 */
export async function readFreshWorkshopSnapshot(): Promise<Workshop[] | null> {
  try {
    const raw = await within(d().store.get(KEY), READ_TIMEOUT_MS, 'Saved class list')
    if (!raw) return null
    const saved = JSON.parse(raw) as Saved
    const now = d().now().getTime()
    const age = now - Date.parse(saved.at)
    // A copy from the future (another server's clock) is allowed a minute's grace.
    if (!Number.isFinite(age) || age >= SNAPSHOT_FRESH_MS || age < -60_000 || !Array.isArray(saved.list)) return null
    return saved.list.filter((w) => Date.parse(w.startAt) > now)
  } catch (err) {
    logger.error('Saved class list unreadable — asking Square live', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * The public class list: the fresh saved copy, else Square live (as before).
 * Remembered for 30 seconds on this server either way; a failure is not.
 */
export function publicWorkshopList(): Promise<Workshop[]> {
  return remember('workshops:list', 30_000, async () => (await readFreshWorkshopSnapshot()) ?? (await d().load()))
}
