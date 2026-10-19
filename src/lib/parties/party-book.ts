/**
 * The party book: which party holds which time, the lock that keeps two
 * people from ever booking the same party time once Square bookings are gone.
 *
 * One document per studio-local month (`month-YYYY-MM`, by the party's start),
 * holding every party time in it: a short hold while someone pays (10 min),
 * an open-ended hold for a payment link (no expiry), or booked. Writes are
 * compare-and-swap on that document with 3 attempts, so two servers racing
 * for the same time cannot both win: the loser's write fails, it re-reads,
 * sees the winner and answers "taken".
 *
 * No party or its hour of cleanup crosses midnight (refused here, and by the
 * party-times settings checks), so two parties that could clash always share
 * one month document.
 *
 *   holdTime     checks against this month's other holds and `others` (classes,
 *                café, blocked time, closed days, legacy parties, from
 *                busyBetween) with clashes({ kind: 'party' }), then writes.
 *   confirmTime  held → booked. Never refuses once paid (R6): a lost hold is
 *                written back as booked, and `overlap` says it now clashes.
 *                Store failures still throw (the caller saves the record anyway).
 *   extendHold   an unknown payment outcome keeps the hold longer (R15).
 *
 * Holds only ever get longer (S2-R5a): a replay, an extension or a confirm
 * never shortens a hold's end or its expiry.
 *   releaseTime  lets the time go (held or booked).
 *   resizeTime   extra time added or removed: the end moves, rechecked.
 *   moveTime     writes the new time (CAS); the caller then updates the party
 *                record and calls releaseTime on the old start. A crash in
 *                between leaves an extra hold the daily warnings name, never a
 *                double booking.
 *
 * Residual race: a class saved in its own store at the same moment as a party
 * hold. Accepted as in stage 1; the daily "class over party" warning catches it.
 */
import { makeKvStore } from '@lib/blob-store'
import { clashes, clashMessage, type Busy } from '@lib/classes/studio-schedule'
import { localDate, PARTY_CLEANUP_MINUTES } from './party-times'

export interface PartyHold {
  partyId: string
  startIso: string
  endIso: string
  state: 'held' | 'booked'
  /** held only; null = held with no expiry (payment link) */
  holdExpiresAt: string | null
  at: string
}
interface MonthDoc { month: string; holds: PartyHold[] }

const kv = makeKvStore('party-book', 'party-book')
const ATTEMPTS = 3
const RETRY = 'Concurrent update — please retry'
const TAKEN = 'That party time was just taken. Please pick another time.'
const MIDNIGHT = 'A party and its hour of cleanup have to finish by midnight.'

const monthOf = (startIso: string) => localDate(startIso).slice(0, 7)
const keyOf = (month: string) => `month-${month}`
const parse = (month: string, json: string | null): MonthDoc => (json ? (JSON.parse(json) as MonthDoc) : { month, holds: [] })

const isExpired = (h: PartyHold, now: Date) =>
  h.state === 'held' && h.holdExpiresAt !== null && Date.parse(h.holdExpiresAt) <= now.getTime()
const sameTime = (h: PartyHold, partyId: string, startIso: string) =>
  h.partyId === partyId && Date.parse(h.startIso) === Date.parse(startIso)

/** A hold as the shared schedule sees it. */
export function holdBusy(h: PartyHold): Busy {
  return { kind: 'party', id: h.partyId, label: 'a party', startIso: h.startIso, endIso: h.endIso, party: { state: h.state, partyId: h.partyId } }
}

function checkSpan(startIso: string, endIso: string): void {
  const s = Date.parse(startIso), e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new Error('A party has to end after it starts.')
}

/** True when the party plus its cleanup ends on its start's studio-local day (ending at midnight exactly is fine). */
function endsByMidnight(startIso: string, endIso: string): boolean {
  const lastMoment = Date.parse(endIso) + PARTY_CLEANUP_MINUTES * 60_000 - 1
  return localDate(new Date(lastMoment).toISOString()) === localDate(startIso)
}

// One server runs a month's read-modify-write one at a time; across servers
// the conditional write (setIfMatch) is what keeps it right.
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(k, tail)
  void tail.then(() => { if (locks.get(k) === tail) locks.delete(k) })
  return run
}

// A store call inside the lock that never answers would hold up every later
// write to that month on this server: give up after this long (throws).
let storeTimeoutMs = 10_000
/** Test-only: shorten the store timeout. */
export function _setStoreTimeoutMs(ms: number): void { storeTimeoutMs = ms }
function timed<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The party book did not answer in time.')), storeTimeoutMs)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/** Read-modify-write with CAS. `fn` sees fresh data each attempt and returns the next doc (or null to write nothing). */
async function mutate<T>(month: string, fn: (cur: MonthDoc) => { next: MonthDoc | null; result: T }, attempts = ATTEMPTS): Promise<T> {
  const k = keyOf(month)
  return withLock(k, async () => {
    for (let i = 0; i < attempts; i++) {
      const { value, etag } = await timed(kv.getWithMeta(k))
      const { next, result } = fn(parse(month, value))
      if (!next) return result
      if (await timed(kv.setIfMatch(k, JSON.stringify(next), etag, value !== null))) return result
    }
    throw new Error(RETRY)
  })
}

/** Studio-local months touched by [fromIso, toIso). */
function monthsBetween(fromIso: string, toIso: string): string[] {
  const first = monthOf(fromIso)
  const last = monthOf(new Date(Math.max(Date.parse(fromIso), Date.parse(toIso) - 1)).toISOString())
  const out: string[] = []
  let [y, m] = first.split('-').map(Number)
  for (let i = 0; i < 400; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    out.push(ym)
    if (ym >= last) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Unexpired held and booked party times overlapping [fromIso, toIso), by start. Throws when the book can't be read. */
export async function holdsBetween(fromIso: string, toIso: string, now: Date): Promise<PartyHold[]> {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const docs = await Promise.all(monthsBetween(fromIso, toIso).map(async (m) => parse(m, await kv.get(keyOf(m)))))
  return docs
    .flatMap((d) => d.holds)
    .filter((h) => !isExpired(h, now) && Date.parse(h.endIso) > from && Date.parse(h.startIso) < to)
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
}

export type HoldResult = { ok: true; replay: boolean } | { ok: false; reason: 'taken' | 'clash'; message: string }
type Changed = { ok: true } | { ok: false; message: string }
type Check = { ok: true } | { ok: false; reason: 'taken' | 'clash'; message: string }

const toIso = (s: string) => new Date(s).toISOString()
const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b)
/** The longer-lasting of two expiries; null (no expiry) wins. */
const laterExpiry = (a: string | null, b: string | null) => (a === null || b === null ? null : later(a, b))

/**
 * The candidate against the month's live holds (taken) and everything else
 * (clash). The locked month doc is the only source for party-book parties:
 * entries in `others` that came from the book (`party` set) are stale copies
 * and are ignored.
 */
function check(span: { startIso: string; endIso: string }, live: PartyHold[], others: Busy[], skip: (h: PartyHold) => boolean, partyId: string): Check {
  if (!endsByMidnight(span.startIso, span.endIso)) return { ok: false, reason: 'clash', message: MIDNIGHT }
  const cand = { kind: 'party' as const, ...span }
  if (clashes(cand, live.filter((h) => !skip(h)).map(holdBusy)).length) return { ok: false, reason: 'taken', message: TAKEN }
  const hit = clashes({ ...cand, ignoreIds: [partyId] }, others.filter((b) => !b.party))
  if (hit.length) return { ok: false, reason: 'clash', message: clashMessage(hit) }
  return { ok: true }
}

/**
 * Holds a party time. A repeat for the same party and start is a replay
 * (ok): holds only grow, so a later end (rechecked) or a longer expiry is
 * kept, never a shorter one.
 */
export async function holdTime(
  input: { partyId: string; startIso: string; endIso: string; ttlMinutes: number | null },
  others: Busy[],
  now: Date,
): Promise<HoldResult> {
  checkSpan(input.startIso, input.endIso)
  const expires = input.ttlMinutes === null ? null : new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString()
  return mutate<HoldResult>(monthOf(input.startIso), (cur) => {
    const live = cur.holds.filter((h) => !isExpired(h, now))
    const mine = live.find((h) => sameTime(h, input.partyId, input.startIso))
    if (mine) {
      const endIso = later(mine.endIso, toIso(input.endIso))
      const holdExpiresAt = mine.state === 'booked' ? null : laterExpiry(mine.holdExpiresAt, expires)
      if (endIso === mine.endIso && holdExpiresAt === mine.holdExpiresAt) return { next: null, result: { ok: true, replay: true } }
      if (endIso !== mine.endIso) {
        const c = check({ startIso: mine.startIso, endIso }, live, others, (h) => h === mine, input.partyId)
        if (!c.ok) return { next: null, result: c }
      }
      const holds = live.map((h) => (h === mine ? { ...h, endIso, holdExpiresAt } : h))
      return { next: { month: cur.month, holds }, result: { ok: true, replay: true } }
    }
    const c = check(input, live, others, () => false, input.partyId)
    if (!c.ok) return { next: null, result: c }
    const hold: PartyHold = {
      partyId: input.partyId,
      startIso: toIso(input.startIso),
      endIso: toIso(input.endIso),
      state: 'held',
      holdExpiresAt: expires,
      at: now.toISOString(),
    }
    // Housekeeping: expired holds (this party's own expired one included) leave the stored doc.
    return { next: { month: cur.month, holds: [...live, hold] }, result: { ok: true, replay: false } }
  })
}

/**
 * Held → booked, once paid. Never refuses a paid party (R6): a hold that ran
 * out, or was swept, is written back as booked from `endIso`, and `overlap`
 * reports that it now clashes with another party (owners sort it out; nothing
 * is refunded). It still THROWS when the store can't be read or written (down,
 * timed out, or 9 lost write races): the caller (Task 7) must catch that and
 * still save the party record, with an owner alert.
 */
export async function confirmTime(partyId: string, startIso: string, endIso: string, now: Date = new Date()): Promise<{ overlap: boolean }> {
  checkSpan(startIso, endIso)
  return mutate(monthOf(startIso), (cur) => {
    const mine = cur.holds.find((h) => sameTime(h, partyId, startIso))
    const rest = cur.holds.filter((h) => !sameTime(h, partyId, startIso) && !isExpired(h, now))
    const end = mine ? later(mine.endIso, toIso(endIso)) : toIso(endIso)
    const overlap = clashes({ kind: 'party', startIso, endIso: end }, rest.map(holdBusy)).length > 0
    if (mine?.state === 'booked' && mine.endIso === end) return { next: null, result: { overlap } }
    const booked: PartyHold = {
      partyId,
      startIso: toIso(startIso),
      endIso: end,
      state: 'booked',
      holdExpiresAt: null,
      at: mine?.at ?? now.toISOString(),
    }
    return { next: { month: cur.month, holds: [...rest, booked] }, result: { overlap } }
  }, ATTEMPTS * 3)
}

/**
 * Keeps a held time longer (an unclear payment outcome, R15). Holds only
 * grow: `untilIso` null = no expiry; an earlier time never shortens a hold,
 * and a never-expiring payment-link hold stays as it is. A booked time is
 * already kept. A hold that ran out, or is gone, is put back from `endIso`
 * when nothing in the book clashes; otherwise `held: false` and `clash`
 * says why, so the owners can be told the time was not kept.
 */
export async function extendHold(
  partyId: string, startIso: string, untilIso: string | null, endIso: string, now: Date = new Date(),
): Promise<{ held: boolean; clash?: string }> {
  checkSpan(startIso, endIso)
  return mutate<{ held: boolean; clash?: string }>(monthOf(startIso), (cur) => {
    const mine = cur.holds.find((h) => sameTime(h, partyId, startIso))
    if (mine?.state === 'booked') return { next: null, result: { held: true } }
    const live = cur.holds.filter((h) => !isExpired(h, now))
    if (mine && !isExpired(mine, now)) {
      const holdExpiresAt = laterExpiry(mine.holdExpiresAt, untilIso)
      if (holdExpiresAt === mine.holdExpiresAt) return { next: null, result: { held: true } }
      return { next: { ...cur, holds: live.map((h) => (h === mine ? { ...h, holdExpiresAt } : h)) }, result: { held: true } }
    }
    if (untilIso !== null && Date.parse(untilIso) <= now.getTime()) return { next: null, result: { held: false } }
    // Ran out or gone: put it back if the time is still free in the book.
    const end = mine ? later(mine.endIso, toIso(endIso)) : toIso(endIso)
    const c = check({ startIso, endIso: end }, live, [], () => false, partyId)
    if (!c.ok) return { next: null, result: { held: false, clash: c.message } }
    const hold: PartyHold = { partyId, startIso: toIso(startIso), endIso: end, state: 'held', holdExpiresAt: untilIso, at: mine?.at ?? now.toISOString() }
    return { next: { month: cur.month, holds: [...live, hold] }, result: { held: true } }
  })
}

/** Lets the time go, held or booked. */
export async function releaseTime(partyId: string, startIso: string): Promise<void> {
  await mutate(monthOf(startIso), (cur) => {
    if (!cur.holds.some((h) => sameTime(h, partyId, startIso))) return { next: null, result: undefined }
    return { next: { ...cur, holds: cur.holds.filter((h) => !sameTime(h, partyId, startIso)) }, result: undefined }
  })
}

/** Moves the end of a party's time (extra time added or removed), rechecked against everything. */
export async function resizeTime(
  partyId: string, startIso: string, newEndIso: string, others: Busy[], now: Date,
): Promise<Changed> {
  checkSpan(startIso, newEndIso)
  return mutate<Changed>(monthOf(startIso), (cur) => {
    const mine = cur.holds.find((h) => sameTime(h, partyId, startIso) && !isExpired(h, now))
    if (!mine) return { next: null, result: { ok: false, message: 'That party has no time held to change.' } }
    const live = cur.holds.filter((h) => !isExpired(h, now))
    const c = check({ startIso, endIso: newEndIso }, live, others, (h) => h.partyId === partyId, partyId)
    if (!c.ok) return { next: null, result: { ok: false, message: c.message } }
    const holds = live.map((h) => (h === mine ? { ...h, endIso: toIso(newEndIso) } : h))
    return { next: { ...cur, holds }, result: { ok: true } }
  })
}

const NO_HOLD = 'That party has no time held to move.'
const SAME_START = "That's already this party's time."

/**
 * Writes the party's new time (CAS), keeping its state and expiry. The old
 * time stays held: the caller updates the party record, then calls
 * releaseTime(partyId, from.startIso). A move to the party's own start is
 * refused (an end change there is resizeTime): the caller's release would
 * otherwise drop its only hold.
 *
 * The old hold is read inside the lock: in the same month, in the very
 * read-modify-write that writes the new time. Across months it is read
 * under the old month's lock just before; a cancel landing between that read
 * and the write would leave an extra hold at the new time, which the daily
 * "Party hold with no party" warning names (moves and cancels of one party
 * are also kept apart by the party record, Task 11).
 */
export async function moveTime(
  partyId: string, from: { startIso: string }, to: { startIso: string; endIso: string }, others: Busy[], now: Date,
): Promise<Changed> {
  checkSpan(to.startIso, to.endIso)
  if (Date.parse(from.startIso) === Date.parse(to.startIso)) return { ok: false, message: SAME_START }
  const fromMonth = monthOf(from.startIso), toMonth = monthOf(to.startIso)
  const liveOld = (holds: PartyHold[]) => holds.find((h) => sameTime(h, partyId, from.startIso) && !isExpired(h, now))
  const oldElsewhere = fromMonth === toMonth
    ? null
    : await withLock(keyOf(fromMonth), async () => liveOld(parse(fromMonth, await timed(kv.get(keyOf(fromMonth)))).holds) ?? null)
  if (fromMonth !== toMonth && !oldElsewhere) return { ok: false, message: NO_HOLD }
  return mutate<Changed>(toMonth, (cur) => {
    const old = oldElsewhere ?? liveOld(cur.holds)
    if (!old) return { next: null, result: { ok: false, message: NO_HOLD } }
    const live = cur.holds.filter((h) => !isExpired(h, now))
    if (live.some((h) => sameTime(h, partyId, to.startIso))) return { next: null, result: { ok: true } } // a retry after a move that went through
    // The party's own old time does not block its move.
    const c = check(to, live, others, (h) => h.partyId === partyId, partyId)
    if (!c.ok) return { next: null, result: { ok: false, message: c.message } }
    const moved: PartyHold = { ...old, startIso: toIso(to.startIso), endIso: toIso(to.endIso), at: now.toISOString() }
    return { next: { ...cur, holds: [...live, moved] }, result: { ok: true } }
  })
}
