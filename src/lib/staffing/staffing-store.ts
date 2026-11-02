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
 * else saved since (409, with the latest). A change that changes nothing is
 * not written (no history line, no new updatedAt, no new record).
 *
 * `seen` (and the calendar SEQUENCE) is bookkeeping, not a change anyone
 * made: noteSeen and the `event` option write it with no history line and
 * without moving updatedAt, so a feed being read never makes an owner's open
 * sheet look stale, and never creates a record.
 *
 * Party index (`idx-parties`): `{ "party:pty_…": startIso }` for our parties
 * with someone on or asked, so the board finds a cancelled party in its
 * range without reading every party ever staffed. Best effort: the daily
 * warnings read every entry, so a missed index line is still caught there.
 *
 * Every write is refused on a test site that shares the live stores (R41).
 * Nothing is stored under a fallback id ('kaden'/'catherine'). Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import type { By } from '@lib/staff-auth'
import { createLogger } from '@lib/logger'
import { BUSY_SAVING, NOT_A_PERSON, StaffingError, STALE_ENTRY, StaleError } from './errors'
import { storableStaffId } from './ids'
import { isEventKey, withSeen } from './rules'
import type { EventKey, StaffingEntry } from './types'

const logger = createLogger('staffing-store')
const kv = makeKvStore('staffing', 'staffing')
const INDEX_KEY = 'idx-parties'
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

/**
 * One person once in each list (the first one stays), the key fixed. A
 * person who can't be stored (a fallback id while Square is down, or a
 * malformed id) is refused, so one person's staffing never splits in two.
 */
function tidy(key: EventKey, e: StaffingEntry): StaffingEntry {
  const once = <T extends { staffId: string }>(list: T[]) => list.filter((x, i) => list.findIndex((y) => y.staffId === x.staffId) === i)
  const assigned = once(e.assigned ?? []), asks = once(e.asks ?? [])
  if ([...assigned, ...asks].some((p) => !storableStaffId(p.staffId))) throw new StaffingError(400, NOT_A_PERSON)
  return { ...e, key, assigned, asks }
}

/** What people did to an entry (who's on, who asked, how many needed), not when it was last seen. */
const content = (e: StaffingEntry) => JSON.stringify([e.needed, e.assigned, e.asks])
const seenPart = (e: StaffingEntry) => JSON.stringify([e.seen, e.sequence])

type SeenEvent = { startIso: string; endIso: string; title: string; cancelled?: boolean }

/**
 * Changes one event's staffing: `fn` gets the freshest copy (an empty one
 * when there is none yet) and returns the next. `change` is the history line.
 * `expectedUpdatedAt` (optional): refuse as stale unless the saved copy is
 * still the one the screen loaded (null = nothing saved yet).
 * `opts.event`: the event as the caller sees it now; remembered as `seen`
 * (and in the party index) in the same write.
 * Nothing changed → nothing written; the saved copy (or an empty one) comes back.
 */
export async function updateEntry(
  key: EventKey,
  fn: (e: StaffingEntry) => StaffingEntry,
  change: string,
  by: By,
  expectedUpdatedAt?: string | null,
  opts: { event?: SeenEvent } = {},
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
    let next = tidy(key, fn(structuredClone(base)))
    if (opts.event) next = withSeen(next, opts.event)
    const changed = content(next) !== content(base)
    if (!changed && (!cur || seenPart(next) === seenPart(base))) return base // nothing to write (and never a record just for `seen`)
    let saved: StaffingEntry
    if (changed) {
      const now = new Date()
      const stamp = base.updatedAt && now.toISOString() <= base.updatedAt ? new Date(Date.parse(base.updatedAt) + 1).toISOString() : now.toISOString()
      saved = { ...next, updatedAt: stamp, history: [{ at: stamp, by, change }, ...base.history].slice(0, ENTRY_HISTORY_CAP) }
    } else {
      saved = { ...base, seen: next.seen, sequence: next.sequence }
    }
    if (await kv.setIfMatch(k, JSON.stringify(saved), etag, value !== null)) {
      await indexParty(saved)
      return saved
    }
  }
  throw new StaffingError(503, BUSY_SAVING)
}

/**
 * Remembers when an event was seen (feeds, owner screens): no history line,
 * updatedAt unchanged, SEQUENCE up when the times moved. Only for an entry
 * that exists, and only when something differs. Returns the entry as saved,
 * or null when there is none.
 */
export async function noteSeen(key: EventKey, ev: SeenEvent): Promise<StaffingEntry | null> {
  if (!isEventKey(key)) return null
  assertClassWritesAllowed() // R41
  const k = storeKey(key)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const cur = parse(key, value)
    if (!cur) return null
    const next = withSeen(cur, ev)
    if (seenPart(next) === seenPart(cur)) return cur
    const saved = { ...cur, seen: next.seen, sequence: next.sequence }
    if (await kv.setIfMatch(k, JSON.stringify(saved), etag, true)) {
      await indexParty(saved)
      return saved
    }
  }
  throw new StaffingError(503, BUSY_SAVING)
}

// ---------------------------------------------------------------- party index

type PartyIndex = Record<string, string>

/** Our parties with someone on or asked, and when they were last seen to start. Throws when the store fails. */
export async function readPartyIndex(): Promise<PartyIndex> {
  const json = await kv.get(INDEX_KEY)
  const doc = json ? (JSON.parse(json) as PartyIndex | null) : null
  return doc && typeof doc === 'object' ? doc : {}
}

/** Keeps the index line for one of our parties up to date. Never throws (the daily warnings read everything). */
async function indexParty(e: StaffingEntry): Promise<void> {
  if (!e.key.startsWith('party:pty_')) return
  const want = e.assigned.length + e.asks.length > 0 ? (e.seen?.startIso ?? null) : null
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const { value, etag } = await kv.getWithMeta(INDEX_KEY)
      const doc: PartyIndex = (value ? (JSON.parse(value) as PartyIndex | null) : null) ?? {}
      if ((doc[e.key] ?? null) === want) return
      if (want) doc[e.key] = want
      else delete doc[e.key]
      if (await kv.setIfMatch(INDEX_KEY, JSON.stringify(doc), etag, value !== null)) return
    }
    logger.warn('Party staffing index busy; the daily warnings still check every party', { key: e.key })
  } catch (err) {
    logger.warn('Could not update the party staffing index', { key: e.key, error: err instanceof Error ? err.message : String(err) })
  }
}
