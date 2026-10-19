/**
 * Seat ledger: the source of truth for seats on our own classes. Every seat
 * (online, door card, door counter, comp, POS) is one line; seats left on a
 * session = capacity − seatsTaken. Writes are compare-and-swap on one document
 * per class, so two buyers racing for the last seat cannot both get it: the
 * loser's write fails, it re-reads, re-checks capacity and comes back sold out.
 */
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { Quote } from './pricing'
import type { Cents, ScheduledClass } from './types'
import { newId } from './validate'

export type SeatSource = 'online' | 'door-card' | 'door-counter' | 'comp' | 'pos'
export interface LedgerLine {
  id: string                 // 'led_'…
  bookingId: string          // groups a booking's lines ('bkg_'…)
  sessionIds: string[]
  ticketTypeId: string
  passId: string
  seat: number               // 1-based within the booking
  /** the seat itself; add-on money is kept apart in addOnCents/addOnTaxCents */
  priceCents: Cents; taxCents: Cents
  addOns: Record<string, number>
  addOnCents: Cents; addOnTaxCents: Cents
  answers: Record<string, string>
  source: SeatSource
  state: 'held' | 'confirmed' | 'released' | 'refunded'
  holdExpiresAt: string | null
  customer: { givenName: string; familyName: string; email: string; phone: string } | null // null = POS sale with no name yet
  square: { orderId: string | null; paymentId: string | null; lineUid: string | null }
  by: By | null
  refunds: { at: string; cents: Cents; reason: string; by: By; freedSeat: boolean; squareRefundId: string | null }[]
  at: string
  /** set by confirm when a paid seat landed on a session already full (the hold had run out and the seat was taken) */
  overCapacity?: boolean
}
export interface Ledger { classId: string; lines: LedgerLine[] }

export type SeatInput = { answers?: Record<string, string>; addOns?: Record<string, number> }
export interface HoldInput {
  bookingId: string
  passId: string
  source: SeatSource
  customer: LedgerLine['customer']
  /** per seat, index 0 = seat 1; may be omitted */
  seats?: SeatInput[]
  ttlMinutes: number
  /** POS and the door's "squeeze one more" skip the capacity check */
  allowOverCapacity?: boolean
  by?: By
}
export type HoldResult = { ok: true; lines: LedgerLine[] } | { ok: false; reason: 'sold_out'; sessionId: string; left: number }

const kv = makeKvStore('seat-ledger', 'seat-ledger')
const key = (classId: string) => `ledger-${classId}`
const ATTEMPTS = 3
const RETRY = 'Concurrent update — please retry'

const isExpiredHold = (l: LedgerLine, now: Date) =>
  l.state === 'held' && (!l.holdExpiresAt || Date.parse(l.holdExpiresAt) <= now.getTime())

function counts(l: LedgerLine, now: Date): boolean {
  if (l.state === 'held') return !isExpiredHold(l, now)
  if (l.state === 'confirmed') return true
  if (l.state === 'refunded') return !l.refunds.some((r) => r.freedSeat)
  return false // released
}

/** Seats taken on a session: unexpired holds + confirmed + refunds that kept the seat. */
export function seatsTaken(ledger: Ledger, sessionId: string, now: Date): number {
  return ledger.lines.filter((l) => l.sessionIds.includes(sessionId) && counts(l, now)).length
}

// One server instance runs a class's read-modify-write one at a time. Across
// servers the conditional write (setIfMatch) is what keeps it right.
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(k, tail)
  void tail.then(() => { if (locks.get(k) === tail) locks.delete(k) })
  return run
}

const parse = (classId: string, json: string | null): Ledger => (json ? (JSON.parse(json) as Ledger) : { classId, lines: [] })

export async function getLedger(classId: string): Promise<Ledger> {
  return parse(classId, await kv.get(key(classId)))
}

/**
 * Read-modify-write with CAS and 3 attempts. `fn` gets freshly read data on
 * every attempt; it returns the next ledger to write (or null to write
 * nothing) and a result.
 */
async function mutate<T>(classId: string, fn: (cur: Ledger) => { next: Ledger | null; result: T }): Promise<T> {
  const k = key(classId)
  return withLock(k, async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const { value, etag } = await kv.getWithMeta(k)
      const { next, result } = fn(parse(classId, value))
      if (!next) return result
      if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) return result
    }
    throw new Error(RETRY)
  })
}

/** One held (or, with expires null, confirmed) line per seat in the quote; add-on lines folded into their seat. */
function buildLines(q: Quote, input: HoldInput, now: Date, expires: string | null): LedgerLine[] {
  return q.lines.filter((l) => l.kind === 'seat').map((sl) => {
    const addOns: Record<string, number> = {}
    let addOnCents = 0, addOnTaxCents = 0
    for (const al of q.lines) {
      if (al.kind !== 'addon' || al.seat !== sl.seat) continue
      const addId = (al.variationKey ?? '').replace(/^addon:/, '')
      addOns[addId] = (addOns[addId] ?? 0) + 1
      addOnCents += al.cents
      addOnTaxCents += al.taxCents
    }
    return {
      id: newId('led'),
      bookingId: input.bookingId,
      sessionIds: [...q.sessionIds],
      ticketTypeId: sl.ticketTypeId,
      passId: input.passId,
      seat: sl.seat + 1,
      priceCents: sl.cents,
      taxCents: sl.taxCents,
      addOns,
      addOnCents,
      addOnTaxCents,
      answers: { ...(input.seats?.[sl.seat]?.answers ?? {}) },
      source: input.source,
      state: 'held',
      holdExpiresAt: expires,
      customer: input.customer,
      square: { orderId: null, paymentId: null, lineUid: null },
      by: input.by ?? null,
      refunds: [],
      at: now.toISOString(),
    }
  })
}

export async function hold(cls: ScheduledClass, q: Quote, input: HoldInput, now: Date): Promise<HoldResult> {
  const sessions = q.sessionIds.map((id) => {
    const s = cls.sessions.find((x) => x.id === id)
    if (!s) throw new Error('One of those sessions is no longer on the schedule.')
    return s
  })
  const seatLines = q.lines.filter((l) => l.kind === 'seat')
  if (seatLines.length !== q.seats || q.seats < 1) throw new Error('That booking has no seats to hold.')

  return mutate<HoldResult>(cls.id, (cur) => {
    // Housekeeping: expired holds leave the stored ledger whenever we write.
    const kept = cur.lines.filter((l) => !isExpiredHold(l, now))
    const live: Ledger = { classId: cls.id, lines: kept }
    if (kept.some((l) => l.bookingId === input.bookingId && l.state !== 'released')) {
      throw new Error('That booking already has seats.')
    }
    if (!input.allowOverCapacity) {
      for (const s of sessions) {
        const left = s.capacity - seatsTaken(live, s.id, now)
        if (left < q.seats) return { next: null, result: { ok: false, reason: 'sold_out', sessionId: s.id, left: Math.max(0, left) } }
      }
    }
    const lines = buildLines(q, input, now, new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString())
    return { next: { classId: cls.id, lines: [...kept, ...lines] }, result: { ok: true, lines } }
  })
}

/**
 * Held → confirmed for a booking. Called only after Square has taken the
 * money, so it never refuses a paid booking: if the hold ran out, was swept or
 * was released, the seats are written again from `fallback` (capacity
 * ignored). Any confirmed seat on a session now over capacity is marked
 * `overCapacity` for staff to sort out. Already-confirmed bookings are
 * returned unchanged (safe to retry).
 */
export async function confirm(
  classId: string,
  bookingId: string,
  square: { orderId: string; paymentId: string | null },
  fallback: { cls: ScheduledClass; quote: Quote; input: HoldInput },
  now: Date,
): Promise<LedgerLine[]> {
  return mutate(classId, (cur) => {
    const mine = cur.lines.filter((l) => l.bookingId === bookingId && (l.state === 'held' || l.state === 'confirmed'))
    if (mine.length && mine.every((l) => l.state === 'confirmed')) return { next: null, result: mine }
    const sq = (l: LedgerLine) => ({ ...l.square, orderId: square.orderId, paymentId: square.paymentId })
    let lines: LedgerLine[]
    if (mine.length) {
      // Convert this booking's holds (even expired, unswept ones); sweep everyone else's expired holds.
      lines = cur.lines
        .filter((l) => l.bookingId === bookingId || !isExpiredHold(l, now))
        .map((l) => (l.bookingId === bookingId && l.state === 'held'
          ? { ...l, state: 'confirmed' as const, holdExpiresAt: null, square: sq(l) }
          : l))
    } else {
      const fresh = buildLines(fallback.quote, { ...fallback.input, bookingId }, now, null)
        .map((l) => ({ ...l, state: 'confirmed' as const, square: sq(l) }))
      lines = [...cur.lines.filter((l) => !isExpiredHold(l, now)), ...fresh]
    }
    const after: Ledger = { ...cur, lines }
    const over = new Set(
      fallback.cls.sessions.filter((s) => seatsTaken(after, s.id, now) > s.capacity).map((s) => s.id),
    )
    lines = lines.map((l) =>
      l.bookingId === bookingId && l.state === 'confirmed' && !l.overCapacity && l.sessionIds.some((id) => over.has(id))
        ? { ...l, overCapacity: true }
        : l,
    )
    return { next: { ...cur, lines }, result: lines.filter((l) => l.bookingId === bookingId && l.state === 'confirmed') }
  })
}

/** Lets go of a booking's held seats. Confirmed seats are never released here. */
export async function release(classId: string, bookingId: string): Promise<void> {
  await mutate(classId, (cur) => {
    if (!cur.lines.some((l) => l.bookingId === bookingId && l.state === 'held')) return { next: null, result: undefined }
    const lines = cur.lines.map((l) =>
      l.bookingId === bookingId && l.state === 'held' ? { ...l, state: 'released' as const, holdExpiresAt: null } : l,
    )
    return { next: { ...cur, lines }, result: undefined }
  })
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
const refundedOn = (l: LedgerLine) => l.refunds.reduce((s, r) => s + r.cents, 0)

/**
 * Records a refund of `cents` on EACH listed line (the money goes back
 * elsewhere; this only records it). Refuses more than a line has left to give back.
 */
export async function recordRefund(
  classId: string,
  lineIds: string[],
  input: { cents: Cents; reason: string; by: By; freeSeat: boolean; squareRefundId: string | null },
): Promise<LedgerLine[]> {
  if (!Number.isInteger(input.cents) || input.cents < 0) throw new Error('A refund has to be whole cents of zero or more.')
  return mutate(classId, (cur) => {
    for (const id of lineIds) {
      const l = cur.lines.find((x) => x.id === id)
      if (!l) throw new Error('One of those seats is not on this class.')
      if (l.state !== 'confirmed' && l.state !== 'refunded') throw new Error('Only paid seats can be refunded.')
      if (refundedOn(l) + input.cents > paidOn(l)) throw new Error('That is more than was paid for this seat.')
    }
    const at = new Date().toISOString()
    const entry = { at, cents: input.cents, reason: input.reason, by: input.by, freedSeat: input.freeSeat, squareRefundId: input.squareRefundId }
    const lines = cur.lines.map((l) => (lineIds.includes(l.id) ? { ...l, state: 'refunded' as const, refunds: [...l.refunds, entry] } : l))
    return { next: { ...cur, lines }, result: lines.filter((l) => lineIds.includes(l.id)) }
  })
}

/** Puts a name on seats (e.g. a POS sale named afterwards). */
export async function setNames(classId: string, lineIds: string[], customer: NonNullable<LedgerLine['customer']>): Promise<void> {
  await mutate(classId, (cur) => {
    for (const id of lineIds) if (!cur.lines.some((l) => l.id === id)) throw new Error('One of those seats is not on this class.')
    const lines = cur.lines.map((l) => (lineIds.includes(l.id) ? { ...l, customer: { ...customer } } : l))
    return { next: { ...cur, lines }, result: undefined }
  })
}
