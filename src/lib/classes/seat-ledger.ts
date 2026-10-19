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
import { studioDate } from '@lib/studio-time'
import { isExpiredHold, isPaidLine, paidOn, refundedOn, takesSeat } from './seat-status'
export { isComing, isPaidLine, takesSeat } from './seat-status'

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
  /** chargedCents: the whole booking's Square total, the same on each of its lines (set at confirm). */
  /**
   * paymentIds: every payment on the order when it was paid with several
   * tenders (POS split tender); paymentId is the first. A refund on any of them is this seat's.
   */
  square: { orderId: string | null; paymentId: string | null; lineUid: string | null; chargedCents?: Cents; paymentIds?: string[] }
  by: By | null
  /** requestId: the saved refund request this entry was written for (our own refunds), so it is never written twice */
  /** id: set on entries written since fix round 2 (11b-C), so an Undo can take back exactly the entry its decision wrote */
  refunds: { id?: string; at: string; cents: Cents; reason: string; by: By; freedSeat: boolean; squareRefundId: string | null; requestId?: string }[]
  at: string
  /** set by confirm when a paid seat landed on a session already full (the hold had run out and the seat was taken) */
  overCapacity?: boolean
  /**
   * R34: a counter sale paid this door seat while other unpaid door seats on
   * the same day could have been it; a person checks it was them.
   */
  counterMatch?: { orderId: string; candidates: number; at: string; checked: { at: string; by: By } | null }
  /**
   * Refunds Square turned down (FAILED/REJECTED), counted per request: the
   * request's raw key (before hashing) → times refused. Only a retry of that
   * same request gets a new idempotency key.
   */
  refundFailures?: Record<string, number>
  /**
   * A "pay at the counter" door seat an owner says was paid at the counter
   * after all (rung up some other way, so no sale matched it): it leaves
   * /admin › To decide and reads "Paid at the counter". No money is recorded.
   */
  paidAtCounter?: { at: string; by: By }
}
/** A door seat taken "to pay at the counter" that no sale has paid and no owner has marked paid. */
export const unpaidDoorSeat = (l: LedgerLine) => l.source === 'door-counter' && l.state === 'confirmed' && !l.square.orderId && !l.paidAtCounter
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

/** Seats taken on a session: unexpired holds + confirmed + refunds that kept the seat (seat-status.takesSeat). */
export function seatsTaken(ledger: Ledger, sessionId: string, now: Date): number {
  return ledger.lines.filter((l) => l.sessionIds.includes(sessionId) && takesSeat(l, now)).length
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
 * `overCapacity` for staff to sort out. A booking with any confirmed or
 * refunded seat and no held seat is already paid and recorded: its paid lines
 * are returned unchanged and nothing is rebuilt (safe to retry or replay).
 */
export async function confirm(
  classId: string,
  bookingId: string,
  square: { orderId: string | null; paymentId: string | null; chargedCents?: Cents },
  fallback: { cls: ScheduledClass; quote: Quote; input: HoldInput },
  now: Date,
  /** requireLiveHold: only convert a hold still running; with none, write nothing and return [] (no rebuild past capacity) */
  opts: { requireLiveHold?: boolean } = {},
): Promise<LedgerLine[]> {
  return mutate(classId, (cur) => {
    const isPaid = (l: LedgerLine) => l.bookingId === bookingId && (l.state === 'confirmed' || l.state === 'refunded')
    const hasHeld = cur.lines.some((l) => l.bookingId === bookingId && l.state === 'held')
    const paid = cur.lines.filter(isPaid)
    if (!hasHeld && paid.length) return { next: null, result: paid }
    if (opts.requireLiveHold && !cur.lines.some((l) => l.bookingId === bookingId && l.state === 'held' && !isExpiredHold(l, now))) {
      return { next: null, result: [] }
    }
    const sq = (l: LedgerLine) => ({
      ...l.square, orderId: square.orderId, paymentId: square.paymentId,
      ...(square.chargedCents !== undefined ? { chargedCents: square.chargedCents } : {}),
    })
    let lines: LedgerLine[]
    if (hasHeld) {
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
    return { next: { ...cur, lines }, result: lines.filter(isPaid) }
  })
}

/**
 * Keeps a booking's held seats held until `untilIso` (a charge with no answer:
 * the customer may have paid). Only that booking's held lines change; a hold
 * already swept is not brought back (confirm's fallback does that if paid).
 */
export async function extendHold(classId: string, bookingId: string, untilIso: string): Promise<number> {
  return mutate(classId, (cur) => {
    const mine = (l: LedgerLine) => l.bookingId === bookingId && l.state === 'held'
    const n = cur.lines.filter(mine).length
    if (!n) return { next: null, result: 0 }
    const lines = cur.lines.map((l) => (mine(l) ? { ...l, holdExpiresAt: untilIso } : l))
    return { next: { ...cur, lines }, result: n }
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


/** Who a ledger change made from a refund done in Square itself is recorded as (see square-events SQUARE_BY). */
const SQUARE_ACTOR_ID = 'square'

/** True when this line was paid by `paymentId` (any tender of a split-tender sale). */
export function paidBy(l: LedgerLine, paymentId: string): boolean {
  return l.square.paymentId === paymentId || (l.square.paymentIds ?? []).includes(paymentId)
}

/**
 * Records a refund of `cents` on EACH listed line (the money goes back
 * elsewhere; this only records it). `cents` may instead map line id → cents,
 * so one Square refund spread unevenly over seats is written in one go.
 * Refuses more than a line has left to give back.
 * A line that already carries a refund with the same non-null squareRefundId is
 * skipped, so a retried refund is recorded once. Except: when a person's
 * refund (our own flow) finds that refund already recorded from Square's
 * webhook (by 'square', the webhook beat the save), the Square-side entries
 * for it on this class are replaced by the person's, so their seat choice,
 * reason and name stand.
 */
export async function recordRefund(
  classId: string,
  lineIds: string[],
  input: { cents: Cents | Record<string, Cents>; reason: string; by: By; freeSeat: boolean; squareRefundId: string | null },
): Promise<LedgerLine[]> {
  const centsOf = (id: string): Cents => (typeof input.cents === 'number' ? input.cents : input.cents[id])
  for (const id of lineIds) {
    const c = centsOf(id)
    if (!Number.isInteger(c) || c < 0) throw new Error('A refund has to be whole cents of zero or more.')
  }
  return mutate(classId, (raw) => {
    const rid = input.squareRefundId
    const fromSquare = (r: LedgerLine['refunds'][number]) => rid !== null && r.squareRefundId === rid && r.by?.id === SQUARE_ACTOR_ID
    const replacing = rid !== null && input.by.id !== SQUARE_ACTOR_ID && raw.lines.some((l) => l.refunds.some(fromSquare))
    const cur: Ledger = !replacing ? raw : {
      ...raw,
      lines: raw.lines.map((l) => {
        if (!l.refunds.some(fromSquare)) return l
        const refunds = l.refunds.filter((r) => !fromSquare(r))
        return { ...l, refunds, state: refunds.length || l.state !== 'refunded' ? l.state : 'confirmed' as const }
      }),
    }
    const seen = (l: LedgerLine) => rid !== null && l.refunds.some((r) => r.squareRefundId === rid)
    const todo = new Set<string>()
    for (const id of lineIds) {
      const l = cur.lines.find((x) => x.id === id)
      if (!l) throw new Error('One of those seats is not on this class.')
      if (seen(l)) continue
      todo.add(id)
      if (l.state !== 'confirmed' && l.state !== 'refunded') throw new Error('Only paid seats can be refunded.')
      if (refundedOn(l) + centsOf(id) > paidOn(l)) throw new Error('That is more than was paid for this seat.')
    }
    const result = () => cur.lines.filter((l) => lineIds.includes(l.id))
    if (!todo.size) return { next: replacing ? cur : null, result: result() }
    const at = new Date().toISOString()
    const entry = (id: string) => ({ id: newId('rfe'), at, cents: centsOf(id), reason: input.reason, by: input.by, freedSeat: input.freeSeat, squareRefundId: input.squareRefundId })
    const lines = cur.lines.map((l) => (todo.has(l.id) ? { ...l, state: 'refunded' as const, refunds: [...l.refunds, entry(l.id)] } : l))
    return { next: { ...cur, lines }, result: lines.filter((l) => lineIds.includes(l.id)) }
  })
}

/**
 * Writes one of our saved refund requests (refund-requests) on the ledger, in
 * ONE change: the seats asked about, as asked, plus any spill-over. The split
 * is fitted to the ledger inside the same change: Square already refunded the
 * total, so all of it is saved; a seat with less left than its share keeps
 * what fits and the rest goes on the booking's other paid seats in seat order
 * (spill-over keeps the seat). Keyed twice, so it is never written twice:
 * nothing is written when any line already carries this request id or this
 * Square refund id. A plain refund recorded from Square's webhook for the same
 * Square refund (the webhook beat our save) is replaced by this request.
 * Returns the asked seats as they are now.
 */
export async function recordRequestRefund(
  classId: string,
  input: { requestId: string; bookingId: string; lines: { id: string; cents: Cents }[]; freeSeat: boolean; reason: string; by: By; squareRefundId: string | null },
): Promise<LedgerLine[]> {
  for (const x of input.lines) if (!Number.isInteger(x.cents) || x.cents < 0) throw new Error('A refund has to be whole cents of zero or more.')
  return mutate(classId, (raw) => {
    const rid = input.squareRefundId
    const fromSquare = (r: LedgerLine['refunds'][number]) => rid !== null && r.squareRefundId === rid && r.by?.id === SQUARE_ACTOR_ID
    const replacing = rid !== null && input.by.id !== SQUARE_ACTOR_ID && raw.lines.some((l) => l.refunds.some(fromSquare))
    const cur: Ledger = !replacing ? raw : {
      ...raw,
      lines: raw.lines.map((l) => {
        if (!l.refunds.some(fromSquare)) return l
        const refunds = l.refunds.filter((r) => !fromSquare(r))
        return { ...l, refunds, state: refunds.length || l.state !== 'refunded' ? l.state : 'confirmed' as const }
      }),
    }
    const askedIds = input.lines.map((x) => x.id)
    const result = (ls: LedgerLine[]) => ls.filter((l) => askedIds.includes(l.id))
    for (const id of askedIds) if (!cur.lines.some((l) => l.id === id)) throw new Error('One of those seats is not on this class.')
    const carries = (r: LedgerLine['refunds'][number]) => r.requestId === input.requestId || (rid !== null && r.squareRefundId === rid)
    if (cur.lines.some((l) => l.refunds.some(carries))) return { next: replacing ? cur : null, result: result(cur.lines) }

    const booking = cur.lines.filter((l) => l.bookingId === input.bookingId && isPaidLine(l)).sort((a, b) => a.seat - b.seat)
    const left = new Map(booking.map((l) => [l.id, paidOn(l) - refundedOn(l)]))
    const cents: Record<string, Cents> = {}
    let spill = 0
    for (const x of input.lines) {
      const c = Math.max(0, Math.min(x.cents, left.get(x.id) ?? 0))
      cents[x.id] = c
      left.set(x.id, (left.get(x.id) ?? 0) - c)
      spill += x.cents - c
    }
    const spilled: Record<string, Cents> = {}
    for (const l of booking) {
      if (spill <= 0) break
      const c = Math.min(spill, left.get(l.id) ?? 0)
      if (c <= 0) continue
      spilled[l.id] = c
      left.set(l.id, (left.get(l.id) ?? 0) - c)
      spill -= c
    }
    if (spill > 0) console.error(`[classes/refund] ${rid ?? input.requestId} is ${spill} cents more than ${input.bookingId} has left; saved what fits`)

    const at = new Date().toISOString()
    const entry = (c: Cents, freedSeat: boolean) => ({
      at, cents: c, reason: input.reason, by: input.by, freedSeat, squareRefundId: rid, requestId: input.requestId,
    })
    const lines = cur.lines.map((l) => {
      const add: LedgerLine['refunds'] = []
      // Seats asked about: as asked (a seat with nothing landing on it is still written when freeing).
      if (askedIds.includes(l.id) && ((cents[l.id] ?? 0) > 0 || input.freeSeat)) {
        if (!isPaidLine(l)) throw new Error('Only paid seats can be refunded.')
        add.push(entry(cents[l.id] ?? 0, input.freeSeat))
      }
      // Seats that only took the spill-over keep their seat.
      if ((spilled[l.id] ?? 0) > 0) add.push(entry(spilled[l.id], false))
      return add.length ? { ...l, state: 'refunded' as const, refunds: [...l.refunds, ...add] } : l
    })
    const changed = lines.some((l, i) => l !== cur.lines[i])
    if (!changed) return { next: replacing ? cur : null, result: result(cur.lines) }
    return { next: { ...cur, lines }, result: result(lines) }
  })
}

/** Counts a refund request Square turned down, by its raw key, on every line of the booking, so a retry of that request is a fresh one. */
export async function noteRefundFailed(classId: string, bookingId: string, rawKey: string): Promise<void> {
  await mutate(classId, (cur) => {
    if (!cur.lines.some((l) => l.bookingId === bookingId)) return { next: null, result: undefined }
    const lines = cur.lines.map((l) => {
      if (l.bookingId !== bookingId) return l
      const map = { ...(l.refundFailures ?? {}) }
      map[rawKey] = (map[rawKey] ?? 0) + 1
      return { ...l, refundFailures: map }
    })
    return { next: { ...cur, lines }, result: undefined }
  })
}

export interface PosLineInput {
  /** Square's order line uid */
  lineUid: string
  passId: string
  ticketTypeId: string
  sessionIds: string[]
  /** one entry per unit sold: what that unit cost before and its tax (from Square's line totals) */
  units: { priceCents: Cents; taxCents: Cents }[]
}

/**
 * Records a counter (POS) sale: one confirmed 'pos' line per unit, no name
 * yet, capacity ignored (the seat is already sold). A door seat the crew
 * took "to pay at the counter" is this sale (R32) only when it is not yet
 * paid, on the same class, pass and ticket, AND on a session on the sale's
 * own studio day (`saleIso`, Chicago date): it takes the payment instead of a
 * new seat, and keeps its name and days. Anything else is its own counter
 * line, so a walk-in is never booked against someone else's unpaid seat. Idempotent by order id +
 * line uid + unit: units already on the ledger for that line are skipped, so a
 * replayed webhook or the nightly reconcile never adds a seat twice. Seats
 * landing on a full session are marked overCapacity for staff. Returns the
 * lines added or paid this time.
 */
export async function recordPos(
  cls: ScheduledClass,
  input: { bookingId: string; orderId: string; paymentId: string | null; paymentIds?: string[]; chargedCents: Cents; lines: PosLineInput[]; saleIso?: string },
  now: Date,
): Promise<LedgerLine[]> {
  const saleDay = studioDate(input.saleIso ?? now.toISOString())
  const onSaleDay = new Set(cls.sessions.filter((s) => studioDate(s.startIso) === saleDay).map((s) => s.id))
  return mutate(cls.id, (cur) => {
    let kept = cur.lines.filter((l) => !isExpiredHold(l, now))
    const added: LedgerLine[] = []
    const claimed = new Set<string>()
    const sq = (pl: PosLineInput) => ({
      orderId: input.orderId, paymentId: input.paymentId, lineUid: pl.lineUid, chargedCents: input.chargedCents,
      ...(input.paymentIds && input.paymentIds.length > 1 ? { paymentIds: [...input.paymentIds] } : {}),
    })
    let seat = kept.filter((l) => l.bookingId === input.bookingId).reduce((m, l) => Math.max(m, l.seat), 0)
    // I1: a multi-unit sale fills one booking's seats before another's; a booking is flagged once per sale.
    let filling: string | null = null
    const flagged = new Set<string>()
    for (const pl of input.lines) {
      let have = kept.filter((l) => l.square.orderId === input.orderId && l.square.lineUid === pl.lineUid).length
      // A seat the crew took at the door to be paid at the counter is this sale: it is paid now, never a second seat.
      while (have < pl.units.length) {
        // N1: the door seat was TAKEN on the sale's day, and covers a session that day.
        const candidates = kept.filter((l) => unpaidDoorSeat(l)
          && l.passId === pl.passId && l.ticketTypeId === pl.ticketTypeId && !claimed.has(l.id)
          && studioDate(l.at) === saleDay && l.sessionIds.some((id) => onSaleDay.has(id)))
        // oldest booking first, then its seats in order; keep filling the booking already started
        const pool: LedgerLine[] = (filling ? candidates.filter((l) => l.bookingId === filling) : []).concat(candidates.filter((l) => l.bookingId !== filling))
        const door: LedgerLine | undefined = pool.sort((a, b) => (a.bookingId === b.bookingId ? a.seat - b.seat : 0))[0]
        if (!door) break
        filling = door.bookingId
        const unit = pl.units[have]
        claimed.add(door.id)
        // R34: unpaid door seats from MORE THAN ONE booking could have been this sale: a person checks it was them.
        const bookings = new Set(candidates.map((l) => l.bookingId)).size
        const check = bookings > 1 && !flagged.has(door.bookingId)
          ? { counterMatch: { orderId: input.orderId, candidates: bookings, at: input.saleIso ?? now.toISOString(), checked: null } }
          : {}
        if (bookings > 1) flagged.add(door.bookingId)
        kept = kept.map((l) => (l.id === door.id ? { ...l, priceCents: unit.priceCents, taxCents: unit.taxCents, square: sq(pl), ...check } : l))
        have++
      }
      for (let u = have; u < pl.units.length; u++) {
        added.push({
          id: newId('led'),
          bookingId: input.bookingId,
          sessionIds: [...pl.sessionIds],
          ticketTypeId: pl.ticketTypeId,
          passId: pl.passId,
          seat: ++seat,
          priceCents: pl.units[u].priceCents,
          taxCents: pl.units[u].taxCents,
          addOns: {}, addOnCents: 0, addOnTaxCents: 0,
          answers: {},
          source: 'pos',
          state: 'confirmed',
          holdExpiresAt: null,
          customer: null,
          square: {
            orderId: input.orderId, paymentId: input.paymentId, lineUid: pl.lineUid, chargedCents: input.chargedCents,
            ...(input.paymentIds && input.paymentIds.length > 1 ? { paymentIds: [...input.paymentIds] } : {}),
          },
          by: null,
          refunds: [],
          at: now.toISOString(),
        })
      }
    }
    if (!added.length && !claimed.size) return { next: null, result: [] }
    const after: Ledger = { classId: cls.id, lines: [...kept, ...added] }
    const over = new Set(cls.sessions.filter((s) => seatsTaken(after, s.id, now) > s.capacity).map((s) => s.id))
    const newIds = new Set(added.map((l) => l.id))
    const lines = after.lines.map((l) => {
      if (l.bookingId === input.bookingId && l.square.orderId === input.orderId) {
        const marked = newIds.has(l.id) && l.sessionIds.some((id) => over.has(id)) ? { overCapacity: true } : {}
        return { ...l, ...marked, square: { ...l.square, chargedCents: input.chargedCents } }
      }
      return l
    })
    return { next: { ...cur, lines }, result: lines.filter((l) => newIds.has(l.id) || claimed.has(l.id)) }
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

/**
 * Puts seats on other sessions of the same class (a counter sale of a
 * pick-your-days pass, once a person says which days). Capacity is not
 * checked: the seat is already sold. A seat landing on a full session is
 * marked overCapacity for staff, as with any paid seat.
 */
export async function moveLines(cls: ScheduledClass, lineIds: string[], sessionIds: string[], now: Date): Promise<LedgerLine[]> {
  const known = new Set(cls.sessions.map((s) => s.id))
  if (!sessionIds.length || sessionIds.some((id) => !known.has(id))) throw new Error('One of those days is not part of this class.')
  const order = cls.sessions.filter((s) => sessionIds.includes(s.id)).sort((a, b) => a.startIso.localeCompare(b.startIso)).map((s) => s.id)
  return mutate(cls.id, (cur) => {
    for (const id of lineIds) if (!cur.lines.some((l) => l.id === id)) throw new Error('One of those seats is not on this class.')
    const moved = cur.lines.map((l) => (lineIds.includes(l.id) ? { ...l, sessionIds: [...order] } : l))
    const after: Ledger = { ...cur, lines: moved }
    const over = new Set(cls.sessions.filter((s) => seatsTaken(after, s.id, now) > s.capacity).map((s) => s.id))
    const lines = moved.map((l) => (lineIds.includes(l.id) && l.sessionIds.some((id) => over.has(id)) ? { ...l, overCapacity: true } : l))
    return { next: { ...cur, lines }, result: lines.filter((l) => lineIds.includes(l.id)) }
  })
}

/** R34: a person checked that a counter sale matched to this door seat was really them. */
export async function markCounterMatchChecked(classId: string, lineId: string, by: By, now = new Date()): Promise<void> {
  await mutate(classId, (cur) => {
    const l = cur.lines.find((x) => x.id === lineId)
    if (!l?.counterMatch || l.counterMatch.checked) return { next: null, result: undefined }
    const lines = cur.lines.map((x) => (x.id === lineId ? { ...x, counterMatch: { ...x.counterMatch!, checked: { at: now.toISOString(), by } } } : x))
    return { next: { ...cur, lines }, result: undefined }
  })
}

/**
 * An owner says these unpaid door seats were paid at the counter after all
 * (To decide › Not paid at the counter). Only seats still unpaid change; the
 * money stays in Square, nothing is recorded as paid here.
 */
export async function markDoorPaid(classId: string, lineIds: string[], by: By, now = new Date()): Promise<LedgerLine[]> {
  return mutate(classId, (cur) => {
    for (const id of lineIds) if (!cur.lines.some((l) => l.id === id)) throw new Error('One of those seats is not on this class.')
    const change = (l: LedgerLine) => lineIds.includes(l.id) && unpaidDoorSeat(l)
    if (!cur.lines.some(change)) return { next: null, result: [] }
    const lines = cur.lines.map((l) => (change(l) ? { ...l, paidAtCounter: { at: now.toISOString(), by } } : l))
    return { next: { ...cur, lines }, result: lines.filter((l) => lineIds.includes(l.id)) }
  })
}

/**
 * R34: a counter sale was matched to the wrong door seat. Its payment (sale,
 * price and tax as rung up) moves to the right unpaid door seat, which counts
 * as checked; the first seat goes back to unpaid. Refused unless `toLineId`
 * is an unpaid door seat on the same class, pass and ticket.
 */
export async function moveCounterPayment(classId: string, fromLineId: string, toLineId: string, by: By, now = new Date()): Promise<void> {
  await mutate(classId, (cur) => {
    const from = cur.lines.find((l) => l.id === fromLineId)
    const to = cur.lines.find((l) => l.id === toLineId)
    if (!from?.counterMatch || !from.square.orderId) throw new Error('That counter sale is no longer on this seat.')
    if (from.counterMatch.checked) return { next: null, result: undefined }
    if (!to || !unpaidDoorSeat(to) || to.passId !== from.passId || to.ticketTypeId !== from.ticketTypeId) {
      throw new Error('Pick someone whose seat at the door is still not paid.')
    }
    // Every seat of the first booking that sale paid moves, onto the right person's unpaid seats in order (as many as they have).
    const order = from.square.orderId
    const paid = cur.lines.filter((l) => l.bookingId === from.bookingId && l.square.orderId === order && l.source === 'door-counter'
      && l.passId === from.passId && l.ticketTypeId === from.ticketTypeId && l.state === 'confirmed' && !l.refunds.length)
      .sort((a, b) => (a.id === from.id ? -1 : b.id === from.id ? 1 : a.seat - b.seat))
    const targets = [to, ...cur.lines.filter((l) => l.bookingId === to.bookingId && l.id !== to.id && unpaidDoorSeat(l)
      && l.passId === from.passId && l.ticketTypeId === from.ticketTypeId).sort((a, b) => a.seat - b.seat)]
    const pairs = new Map<string, LedgerLine>()
    paid.slice(0, targets.length).forEach((p, i) => pairs.set(targets[i].id, p))
    const moving = new Set([...pairs.values()].map((p) => p.id))
    const lines = cur.lines.map((l) => {
      if (moving.has(l.id)) {
        const { counterMatch: _m, ...rest } = l
        return { ...rest, square: { orderId: null, paymentId: null, lineUid: null } }
      }
      const src = pairs.get(l.id)
      if (src) {
        return {
          ...l, priceCents: src.priceCents, taxCents: src.taxCents, square: { ...src.square },
          ...(l.id === to.id ? { counterMatch: { ...from.counterMatch!, checked: { at: now.toISOString(), by } } } : {}),
        }
      }
      return l
    })
    return { next: { ...cur, lines }, result: undefined }
  })
}

/**
 * Undo of a "free the seat" just done in /admin › To decide (N1): takes back
 * exactly the free-seat entries that decision wrote (by entry id), and only
 * when that's still right:
 *   - the entry is still there and moves no money (never a refund with money)
 *   - no money refund was put on the seat after it
 *   - every coming session the seat would hold again still has room
 * Otherwise nothing changes and it says why.
 */
export async function unfreeSeats(cls: ScheduledClass, entries: { lineId: string; entryId: string }[], now = new Date()): Promise<void> {
  if (!entries.length) throw new Error('There’s nothing here to undo.')
  await mutate(cls.id, (cur) => {
    let lines = cur.lines
    for (const { lineId, entryId } of entries) {
      const l = lines.find((x) => x.id === lineId)
      const i = l ? l.refunds.findIndex((r) => r.id === entryId) : -1
      if (!l || i < 0) throw new Error('That seat changed since. Open the class to sort it out.')
      const e = l.refunds[i]
      if (!e.freedSeat || e.cents !== 0 || e.squareRefundId) throw new Error('That can’t be undone from here.')
      if (l.refunds.slice(i + 1).some((r) => r.cents > 0)) throw new Error('A refund was made on that seat since. Open the class to sort it out.')
      const refunds = l.refunds.filter((_, n) => n !== i)
      lines = lines.map((x) => (x.id === lineId ? { ...x, refunds, state: refunds.length ? x.state : 'confirmed' as const } : x))
    }
    // The seat comes back only where there's still room for it.
    const after: Ledger = { ...cur, lines }
    const touched = new Set(entries.flatMap((e) => lines.find((l) => l.id === e.lineId)?.sessionIds ?? []))
    for (const s of cls.sessions) {
      if (!touched.has(s.id) || Date.parse(s.startIso) <= now.getTime()) continue
      if (seatsTaken(after, s.id, now) > s.capacity) {
        throw new Error('That seat was taken since. Add them over capacity from the class if you need to.')
      }
    }
    return { next: after, result: undefined }
  })
}
