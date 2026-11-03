/**
 * Craft Café walk-in presence (the code keeps its old "open studio" name): a
 * day-keyed list of who came, not a custody ledger. Craft Café is pay-per-craft,
 * no booking, no drop-off — so unlike `@lib/checkin-store` there's no
 * expected/presence/pickup-code machinery, just "this household showed up
 * today", who came with them and who logged it.
 *
 * Two documents per studio-local day, both bounded reads by date:
 *   open-studio-YYYY-MM-DD          recordId (waiver id) → entry
 *   open-studio-waiting-YYYY-MM-DD  new families the crew started on a waiver
 *                                   (on the iPad, by text or by QR) who aren't
 *                                   checked in yet: "Waiting on a waiver"
 *
 * Netlify Blobs in prod, `.data/open-studio/` on disk in dev. The whole store
 * is in the records download (archive-stores.ts).
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('open-studio-store')
const kv = makeKvStore('open-studio', 'open-studio')

export interface OpenStudioEntry {
  personIds: string[]
  at: string // ISO — last time this household was logged in today
  by: By
  /** Newer entries: the family's name when they were checked in ("Jane Doe"). */
  name?: string
  /** Newer entries: who came, by name ("Jane Doe", "Mia"), in personIds order. */
  people?: string[]
}

/** recordId (waiver id) → entry, for one studio-local calendar day. */
export type OpenStudioDay = Record<string, OpenStudioEntry>

/** A new family the crew started on a waiver at Craft Café, not checked in yet. */
export interface CafeWaiting {
  id: string
  /** What the crew typed ("Kim", "Jane Doe"); "New family" when they typed nothing. */
  name: string
  how: 'ipad' | 'text' | 'qr'
  at: string
  by: By
  /** Digits only, texted families: finds their waiver once signed. Never sent to the browser. */
  phone?: string
  /** Texted families: whether the last text went (false: it didn't, so a retry sends again). */
  sent?: boolean
  /** Signed on this iPad: their waiver, so the list finds them even when the check-in didn't go through. */
  recordId?: string
}

/** "Waiting on a waiver" already holds WAITING_CAP families today: nobody new is added (or texted). */
export class CafeWaitingFullError extends Error {
  constructor() {
    super('Craft Café waiting list is full')
    this.name = 'CafeWaitingFullError'
  }
}

export interface CafeTotals {
  households: number
  people: number
  adults: number
  kids: number
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** At most this many families wait on a waiver in a day (a runaway loop can't grow the document). */
export const WAITING_CAP = 40

function key(date: string): string {
  return `open-studio-${date}`
}
function waitingKey(date: string): string {
  return `open-studio-waiting-${date}`
}

export async function getOpenStudioDay(date: string): Promise<OpenStudioDay> {
  const json = await kv.get(key(date))
  return json ? JSON.parse(json) : {}
}

/**
 * One CAS read-modify-write of a day's document. `change` returns null to
 * write nothing (and get null), or a `result` with no `next` to write nothing
 * but still answer (read from the same document it looked at: no second read
 * another iPad could change in between).
 */
async function changeDoc<T, R>(k: string, empty: T, change: (cur: T) => { next?: T; result: R } | null): Promise<R | null> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(k)
    const cur: T = value ? JSON.parse(value) : empty
    const out = change(cur)
    if (!out) return null
    if (out.next === undefined) return out.result
    if (await kv.setIfMatch(k, JSON.stringify(out.next), etag, value !== null)) return out.result
    // Lost the CAS race — retry
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * Log a household as present today. Idempotent — checking in the same
 * recordId again just updates `personIds`/`at`/`by`, it doesn't add a
 * second entry. CAS retry so two devices checking in different households
 * at once don't clobber each other. `snapshot` keeps the family's name and
 * who came, so the day's list and the owners' reports read the same later.
 */
export async function checkInOpenStudio(
  date: string,
  recordId: string,
  personIds: string[],
  by: By,
  snapshot?: { name: string; people: string[] },
): Promise<OpenStudioDay> {
  const day = await changeDoc<OpenStudioDay, OpenStudioDay>(key(date), {}, (cur) => {
    const next = { ...cur, [recordId]: { personIds, at: new Date().toISOString(), by, ...(snapshot ? { name: snapshot.name, people: snapshot.people } : {}) } }
    return { next, result: next }
  })
  logger.info('Craft Café check-in', { date, recordId, count: personIds.length })
  return day!
}

/** Take a household off a day's list (Undo). The removed entry, or null when it wasn't there. */
export async function undoOpenStudio(date: string, recordId: string): Promise<OpenStudioEntry | null> {
  return changeDoc<OpenStudioDay, OpenStudioEntry>(key(date), {}, (cur) => {
    const gone = cur[recordId]
    if (!gone) return null
    const next = { ...cur }
    delete next[recordId]
    return { next, result: gone }
  })
}

/** Adults and kids in one entry: 'adult' is the signer; every 'child:N' is one of their kids. */
export function entryCounts(e: Pick<OpenStudioEntry, 'personIds'>): { people: number; adults: number; kids: number } {
  const adults = e.personIds.filter((p) => p === 'adult').length
  const kids = e.personIds.filter((p) => p.startsWith('child:')).length
  return { people: e.personIds.length, adults, kids }
}

/** A day's totals: families, people, adults, kids. */
export function dayTotals(day: OpenStudioDay): CafeTotals {
  const t: CafeTotals = { households: 0, people: 0, adults: 0, kids: 0 }
  for (const e of Object.values(day)) {
    const c = entryCounts(e)
    t.households += 1
    t.people += c.people
    t.adults += c.adults
    t.kids += c.kids
  }
  return t
}

/** Total people logged in for the day (summed across households) — the
 *  "n here" on the Craft Café row. */
export async function hereNowCount(date: string): Promise<number> {
  return dayTotals(await getOpenStudioDay(date)).people
}

// ---- Waiting on a waiver ----

export async function getCafeWaiting(date: string): Promise<CafeWaiting[]> {
  const json = await kv.get(waitingKey(date))
  return json ? JSON.parse(json) : []
}

/**
 * Add a family to "Waiting on a waiver". A texted family already waiting
 * (same phone) isn't added twice: the existing entry comes back with
 * `existing: true` (its `sent` says whether their text went, so a failed one
 * can be sent again). Throws CafeWaitingFullError once WAITING_CAP families
 * wait: nobody is dropped to make room.
 */
export async function addCafeWaiting(
  date: string,
  w: Omit<CafeWaiting, 'id' | 'at'>,
  now: Date = new Date(),
): Promise<{ entry: CafeWaiting; existing: boolean }> {
  const out = await changeDoc<CafeWaiting[], { entry: CafeWaiting; existing: boolean }>(waitingKey(date), [], (cur) => {
    const same = w.phone ? cur.find((x) => x.phone === w.phone) : undefined
    if (same) return { result: { entry: same, existing: true } }
    if (cur.length >= WAITING_CAP) throw new CafeWaitingFullError()
    const entry: CafeWaiting = { id: `cw_${randomUUID().slice(0, 8)}`, at: now.toISOString(), ...w }
    return { next: [...cur, entry], result: { entry, existing: false } }
  })
  return out!
}

/** Save whether a waiting family's text went. Nothing when they're gone from the list. */
export async function markCafeWaitingSent(date: string, id: string, sent: boolean): Promise<void> {
  await changeDoc<CafeWaiting[], true>(waitingKey(date), [], (cur) => {
    const i = cur.findIndex((x) => x.id === id)
    if (i < 0 || cur[i].sent === sent) return null
    const next = cur.slice()
    next[i] = { ...cur[i], sent }
    return { next, result: true }
  })
}

/**
 * A family signed on this iPad: remember their waiver on their waiting entry,
 * and their name when the crew typed none ("New family" → "Jane Doe"), so the
 * row turns "✓ Signed" even when the iPad's check-in didn't go through.
 */
export async function setCafeWaitingSigned(date: string, id: string, signed: { recordId: string; name: string }): Promise<boolean> {
  const out = await changeDoc<CafeWaiting[], true>(waitingKey(date), [], (cur) => {
    const i = cur.findIndex((x) => x.id === id)
    if (i < 0) return null
    const unnamed = !cur[i].name.trim() || cur[i].name.trim().toLowerCase() === 'new family'
    const next = cur.slice()
    next[i] = { ...cur[i], recordId: signed.recordId, ...(unnamed && signed.name.trim() ? { name: signed.name.trim() } : {}) }
    return { next, result: true }
  })
  return out === true
}

/** Take families off "Waiting on a waiver" (checked in, or the crew tapped Remove). The ones removed. */
export async function removeCafeWaiting(date: string, ids: string[]): Promise<CafeWaiting[]> {
  if (!ids.length) return []
  const out = await changeDoc<CafeWaiting[], CafeWaiting[]>(waitingKey(date), [], (cur) => {
    const gone = cur.filter((x) => ids.includes(x.id))
    if (!gone.length) return null
    return { next: cur.filter((x) => !ids.includes(x.id)), result: gone }
  })
  return out ?? []
}

/**
 * Does a signed waiver belong to a waiting family? Signed after they were
 * started (a few minutes' slack for clocks), and the same phone, or the same
 * name typed by the crew (full name, or just the last name when that's all
 * they typed; `lastNameOnly: false` leaves that out, for clearing the list on
 * a check-in). An entry with no name typed only matches by its id.
 */
export function waitingMatches(
  w: Pick<CafeWaiting, 'name' | 'phone' | 'at'>,
  signed: { firstName: string; lastName: string; phone: string; signedAt: string },
  opts: { lastNameOnly?: boolean } = {},
): boolean {
  if (Date.parse(signed.signedAt) < Date.parse(w.at) - 10 * 60_000) return false
  const digits = signed.phone.replace(/\D/g, '').slice(-10)
  if (w.phone && digits && w.phone.slice(-10) === digits) return true
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const typed = norm(w.name)
  if (!typed || typed === 'new family') return false
  const full = norm(`${signed.firstName} ${signed.lastName}`)
  return typed === full || (opts.lastNameOnly !== false && typed === norm(signed.lastName))
}
