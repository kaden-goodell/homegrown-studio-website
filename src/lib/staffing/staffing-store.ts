/**
 * Who is on each event, who asked, how many are needed (stage 3). kv
 * `staffing`, one record per event key (`evt-{key}` with the `:` written as
 * `_`), written compare-and-set with 3 attempts. Times are never stored as
 * the truth: `seen` only remembers what an owner screen or a feed last saw,
 * to spot a move.
 *
 * updateEntry runs `fn` on the freshest copy each attempt, so two owners
 * putting different people on at the same moment both stay. Passing
 * `expectedUpdatedAt` (what a screen loaded) refuses the write when someone
 * else saved since (409, with the latest). Every write is refused on a test
 * site that shares the live stores (R41). Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import type { By } from '@lib/staff-auth'
import { BUSY_SAVING, StaffingError, STALE_ENTRY, StaleError } from './errors'
import { isEventKey } from './rules'
import type { EventKey, StaffingEntry } from './types'

const kv = makeKvStore('staffing', 'staffing')
const ATTEMPTS = 3
const PARALLEL = 8
export const ENTRY_HISTORY_CAP = 100

/** `ses:ses_1` → `evt-ses_ses_1`. The kinds have no `_`, so the first `_` is always the `:`. */
const storeKey = (key: EventKey) => `evt-${key.replace(':', '_')}`
function keyFromStore(k: string): EventKey | null {
  if (!k.startsWith('evt-')) return null
  const rest = k.slice(4)
  const i = rest.indexOf('_')
  if (i < 0) return null
  const key = `${rest.slice(0, i)}:${rest.slice(i + 1)}`
  return isEventKey(key) ? key : null
}

export function emptyEntry(key: EventKey): StaffingEntry {
  return { key, needed: null, assigned: [], asks: [], seen: null, sequence: 0, updatedAt: null, history: [] }
}

function parse(key: EventKey, json: string | null): StaffingEntry | null {
  if (!json) return null
  const e = JSON.parse(json) as StaffingEntry | null
  if (!e) return null
  return { ...emptyEntry(key), ...e, key, assigned: e.assigned ?? [], asks: e.asks ?? [], history: e.history ?? [] }
}

/** The entries that exist for these keys. Reads 8 at a time; throws when the store fails. */
export async function getEntries(keys: EventKey[]): Promise<Map<EventKey, StaffingEntry>> {
  const wanted = [...new Set(keys.filter(isEventKey))]
  const out = new Map<EventKey, StaffingEntry>()
  for (let i = 0; i < wanted.length; i += PARALLEL) {
    const batch = wanted.slice(i, i + PARALLEL)
    const got = await Promise.all(batch.map(async (k) => parse(k, await kv.get(storeKey(k)))))
    got.forEach((e, j) => { if (e) out.set(batch[j], e) })
  }
  return out
}

export async function listAllEntryKeys(): Promise<EventKey[]> {
  return (await kv.list()).map(keyFromStore).filter((k): k is EventKey => k !== null)
}

/** One person once in each list (the first one stays), the key fixed. */
function tidy(key: EventKey, e: StaffingEntry): StaffingEntry {
  const once = <T extends { staffId: string }>(list: T[]) => list.filter((x, i) => list.findIndex((y) => y.staffId === x.staffId) === i)
  return { ...e, key, assigned: once(e.assigned ?? []), asks: once(e.asks ?? []) }
}

/**
 * Changes one event's staffing: `fn` gets the freshest copy (an empty one
 * when there is none yet) and returns the next. `change` is the history line.
 * `expectedUpdatedAt` (optional): refuse as stale unless the saved copy is
 * still the one the screen loaded (null = nothing saved yet).
 */
export async function updateEntry(
  key: EventKey,
  fn: (e: StaffingEntry) => StaffingEntry,
  change: string,
  by: By,
  expectedUpdatedAt?: string | null,
): Promise<StaffingEntry> {
  if (!isEventKey(key)) throw new StaffingError(400, "We couldn't find that class or party.")
  assertClassWritesAllowed() // R41
  const k = storeKey(key)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const cur = parse(key, value)
    if (expectedUpdatedAt !== undefined && (cur?.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) {
      throw new StaleError(STALE_ENTRY, cur ?? emptyEntry(key))
    }
    const base = cur ?? emptyEntry(key)
    const next = tidy(key, fn(structuredClone(base)))
    const now = new Date()
    const stamp = base.updatedAt && now.toISOString() <= base.updatedAt ? new Date(Date.parse(base.updatedAt) + 1).toISOString() : now.toISOString()
    const saved: StaffingEntry = {
      ...next,
      updatedAt: stamp,
      history: [{ at: stamp, by, change }, ...base.history].slice(0, ENTRY_HISTORY_CAP),
    }
    if (await kv.setIfMatch(k, JSON.stringify(saved), etag, value !== null)) return saved
  }
  throw new StaffingError(503, BUSY_SAVING)
}
