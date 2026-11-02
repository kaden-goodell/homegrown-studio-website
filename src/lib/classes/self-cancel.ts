/**
 * D2 (Kaden, 1 Nov, revised): customers cancel their own class seats from the
 * "Can't make it?" link in their confirmation email.
 *
 *   48+ hours ahead  pick seats → "Cancel and refund $X": ONE Square refund for
 *                    exactly what those seats paid, through the shared refund
 *                    runner (saved request + idempotency key before any money
 *                    moves, so a double tap, two tabs or a reused link can never
 *                    refund twice), seats freed → the waitlist runs, the refund
 *                    email (the runner's, once), an owner heads-up text, audit.
 *   free ($0)        the seat is freed, nothing refunded.
 *   anything else    the policy is shown + "Send us a note" → an owner text and
 *                    /admin › To decide (cancel-request): Refund and free the
 *                    seat · Free the seat, no refund · Keep their booking.
 *   no answer        Square didn't answer the refund: the seats stay held as
 *                    "cancelling" (nothing is freed until the refund is known),
 *                    the customer is told it's being finished, the owners get a
 *                    text and To decide shows it (cancel-unclear: Ask Square,
 *                    which re-sends the very same request, never a second one).
 *
 * This is the only deliberate exception to "never refund automatically": the
 * customer asks for it, inside the published policy.
 *
 * The link is a signed token (class id + booking id, HMAC with
 * LOOKUP_SIGNING_SECRET); it holds no state, so it works from any old
 * confirmation and re-reads the booking every time. One record per booking
 * (kv `class-cancels`, CAS) keeps each try and each note. Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { recordAudit } from '@lib/audit'
import { alertOwners } from '@lib/owner-alert'
import { createLogger } from '@lib/logger'
import { formatMoney } from '@lib/money'
import { formatSlotLabel } from '@lib/studio-time'
import { policyWindows } from '@config/policy-content'
import type { By } from '@lib/staff-auth'
import { getClass } from './class-store'
import { tokenOf } from './decided'
import { getLedger, type LedgerLine } from './seat-ledger'
import { seatFreed } from './seat-status'
import type { Cents, ScheduledClass } from './types'
import { listRefundRequests, isWaiting } from './refund-requests'
import { classRefundBook, freeSeatOnly, ALREADY_FREE, type RefundRequest } from './refunds'
import { runRefund } from '@lib/booking-core/refund-runner'
import { RefundError, REFUND_JUST_MADE, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE } from '@lib/booking-core/refund-words'
import { assertClassWritesAllowed } from './test-site-guard'
import { cancelToken, readCancelToken } from './self-cancel-token'
import { bookingLinesOf, cancelOptions, cancelSplit, pickedSeats, type CancelOptions, type CancelSeat } from './self-cancel-rules'

const logger = createLogger('classes:self-cancel')

export { CANCEL_PAGE, cancelPathFor, cancelToken, readCancelToken } from './self-cancel-token'

// ---------------------------------------------------------------- the record

/** One "Cancel and refund" (or free cancel) a customer pressed. */
export interface CancelTry {
  /** the page's token for this press, the same on every retry of it */
  attempt: string
  lineIds: string[]
  /** what was asked of Square for these seats (sent identically on every retry) */
  cents: Cents
  free: boolean
  at: string
  /**
   * cancelling (sent, no answer yet) · done · unclear (Square didn't answer;
   * the seats stay held) · turned-down (Square said no; nothing refunded,
   * still booked) · stopped (the booking changed under it; nothing sent)
   */
  state: 'cancelling' | 'done' | 'unclear' | 'turned-down' | 'stopped'
  refundId?: string | null
  doneAt?: string
  /** the owners were texted about this try's outcome (once) */
  told?: boolean
}

/** One "Send us a note". */
export interface CancelAsk { at: string; note: string; lineIds: string[]; why: string; told: boolean }

export interface CancelRecord {
  classId: string
  bookingId: string
  customer: { givenName: string; familyName: string; email: string; phone: string } | null
  tries: CancelTry[]
  asks: CancelAsk[]
  updatedAt: string
}

const kv = makeKvStore('class-cancels', 'class-cancels')
const keyOf = (bookingId: string) => `cxl-${bookingId.replace(/[^A-Za-z0-9_-]/g, '_')}`
const RETRY = 'Concurrent update — please retry'

export async function getCancelRecord(bookingId: string): Promise<CancelRecord | null> {
  const json = await kv.get(keyOf(bookingId))
  return json ? (JSON.parse(json) as CancelRecord) : null
}

export async function listCancelRecords(): Promise<CancelRecord[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith('cxl-'))
  const all = await Promise.all(keys.map((k) => kv.get(k)))
  return all.filter((j): j is string => !!j).map((j) => JSON.parse(j) as CancelRecord)
}

// One server runs a booking's read-modify-write one at a time; across servers the conditional write keeps it right.
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(k, tail)
  void tail.then(() => { if (locks.get(k) === tail) locks.delete(k) })
  return run
}

async function mutate<T>(base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, fn: (cur: CancelRecord) => { next: CancelRecord | null; result: T }): Promise<T> {
  assertClassWritesAllowed()
  const k = keyOf(base.bookingId)
  return withLock(k, async () => {
    for (let i = 0; i < 3; i++) {
      const { value, etag } = await kv.getWithMeta(k)
      const cur: CancelRecord = value ? (JSON.parse(value) as CancelRecord) : { ...base, tries: [], asks: [], updatedAt: '' }
      const { next, result } = fn(cur)
      if (!next) return result
      if (await kv.setIfMatch(k, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }), etag, value !== null)) return result
    }
    throw new Error(RETRY)
  })
}

const setTry = (rec: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, attempt: string, change: (t: CancelTry) => CancelTry | null) =>
  mutate(rec, (cur) => {
    const i = cur.tries.findIndex((t) => t.attempt === attempt)
    if (i < 0) return { next: null, result: null as CancelTry | null }
    const changed = change(cur.tries[i])
    if (!changed) return { next: null, result: null as CancelTry | null }
    return { next: { ...cur, tries: cur.tries.map((t, n) => (n === i ? changed : t)) }, result: changed }
  })

/** A try still in flight this long (a crash between sending and the answer) counts as unclear. */
export const CANCEL_STALE_MS = 5 * 60_000

/**
 * A try's state as it stands: unclear or in flight whose seats were freed
 * since (Square's webhook or "It went through" finished the refund) is done.
 */
export function tryState(t: CancelTry, lines: LedgerLine[], now: Date): CancelTry['state'] {
  if ((t.state === 'unclear' || t.state === 'cancelling') && t.lineIds.length && t.lineIds.every((id) => { const l = lines.find((x) => x.id === id); return !!l && seatFreed(l) })) return 'done'
  if (t.state === 'cancelling' && now.getTime() - Date.parse(t.at) >= CANCEL_STALE_MS) return 'unclear'
  return t.state
}

// ---------------------------------------------------------------- what the page shows

export interface CancelView {
  className: string
  /** "Sat, Nov 14 · 1:00 PM CT" */
  whenLabel: string
  state: 'open' | 'cancelling' | 'cancelled' | 'requested' | 'over'
  mode: CancelOptions['mode']
  why: string | null
  policyHours: number
  seats: CancelSeat[]
  wholeOnly: boolean
  /** the last note they sent, if any */
  request: { at: string; note: string } | null
  /** what came back to them online so far (seats cancelled from this page) */
  refundedCents: Cents
}

interface Loaded { cls: ScheduledClass; lines: LedgerLine[]; rec: CancelRecord | null; opts: CancelOptions; view: CancelView }

export class CancelError extends Error {
  constructor(public status: number, public code: 'not-found' | 'invalid' | 'changed' | 'request-only' | 'square' | 'unavailable', message: string, public view?: CancelView) { super(message) }
}

export const CANCEL_MESSAGES = {
  notFound: 'We couldn’t find that booking. The link may be old, or the booking may have changed. Text or call us and we’ll help.',
  pick: 'Pick the seats to cancel.',
  whole: 'This booking covers more than one date, so all of its seats are cancelled together.',
  changed: 'Your booking just changed. Here it is as it stands now.',
  stillFinishing: 'We’re still finishing your last cancel. Give it a minute, then try again.',
  turnedDown: 'The refund didn’t go through just now, so nothing changed and your seats are still booked. Try again in a few minutes, or send us a note.',
  noteTooLong: 'Keep the note under 500 characters.',
  unavailable: 'We couldn’t do that just now. Nothing changed. Try again in a minute.',
} as const

const nameOf = (c: CancelRecord['customer'] | LedgerLine['customer']) => (c ? `${c.givenName} ${c.familyName}`.trim() : '') || 'A customer'
const seatsText = (n: number) => (n === 1 ? '1 seat' : `${n} seats`)

async function load(token: unknown, now: Date): Promise<Loaded & { classId: string; bookingId: string }> {
  const ids = readCancelToken(token)
  if (!ids) throw new CancelError(404, 'not-found', CANCEL_MESSAGES.notFound)
  const cls = await getClass(ids.classId)
  if (!cls) throw new CancelError(404, 'not-found', CANCEL_MESSAGES.notFound)
  const [ledger, rec, saved] = await Promise.all([getLedger(cls.id), getCancelRecord(ids.bookingId), listRefundRequests(cls.id, ids.bookingId).catch(() => [])])
  const lines = bookingLinesOf(ledger, ids.bookingId)
  if (!lines.length) throw new CancelError(404, 'not-found', CANCEL_MESSAGES.notFound)
  // Held as "cancelling": a try Square hasn't answered, or any refund on these seats still waiting on Square.
  const cancelling = new Set<string>()
  for (const t of rec?.tries ?? []) {
    const st = tryState(t, lines, now)
    if (st === 'cancelling' || st === 'unclear') for (const id of t.lineIds) cancelling.add(id)
  }
  for (const r of saved.filter(isWaiting)) for (const x of r.lines) cancelling.add(x.id)
  const opts = cancelOptions(cls, lines, now, { policyHours: policyWindows.workshopRefundHours, cancelling })
  const first = opts.firstStartIso
  const ask = rec?.asks[rec.asks.length - 1] ?? null
  const done = (rec?.tries ?? []).filter((t) => tryState(t, lines, now) === 'done')
  const allGone = opts.seats.every((s) => s.state === 'cancelled')
  const state: CancelView['state'] = opts.seats.some((s) => s.state === 'cancelling')
    ? 'cancelling'
    : allGone ? 'cancelled' : opts.mode === 'none' ? 'over' : ask ? 'requested' : 'open'
  const view: CancelView = {
    className: cls.content.name,
    whenLabel: first ? formatSlotLabel(first) : '',
    state, mode: opts.mode, why: opts.why, policyHours: policyWindows.workshopRefundHours,
    seats: opts.seats, wholeOnly: opts.wholeOnly,
    request: ask ? { at: ask.at, note: ask.note } : null,
    refundedCents: done.reduce((s, t) => s + (t.free ? 0 : t.cents), 0),
  }
  return { ...ids, cls, lines, rec, opts, view }
}

export async function cancelView(token: unknown, now = new Date()): Promise<CancelView> {
  return (await load(token, now)).view
}

// ---------------------------------------------------------------- cancelling

/** Who the refund request and audit name: the customer, online (the runner's actor needs a role; system actors use owner). */
const customerActor = (lines: LedgerLine[]): { by: By; role: 'owner' } => ({
  by: { id: 'customer-online', name: `${nameOf(lines.find((l) => l.customer)?.customer ?? null)} (online)` },
  role: 'owner',
})

export const SELF_CANCEL_REASON = 'Cancelled online by the customer'

export interface CancelResult { result: 'cancelled' | 'cancelling'; cents: Cents; view: CancelView }

/**
 * "Cancel and refund $X" (or a free booking's "Cancel my seat"). `attempt` is
 * the page's token for this press; a retry of it continues it (the same
 * request and key), never a second refund.
 */
export async function selfCancel(input: { token: unknown; lineIds: unknown; attempt: unknown }, now = new Date()): Promise<CancelResult> {
  const attempt = typeof input.attempt === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(input.attempt) ? input.attempt : null
  if (!attempt) throw new CancelError(400, 'invalid', CANCEL_MESSAGES.unavailable)
  const first = await load(input.token, now)
  const { cls, bookingId } = first
  const base = { classId: cls.id, bookingId, customer: first.lines.find((l) => l.customer)?.customer ?? null }
  const mine = first.rec?.tries.find((t) => t.attempt === attempt)

  // A press already finished: the same answer (a double tap, a reload, a reused link).
  if (mine && tryState(mine, first.lines, now) === 'done') return { result: 'cancelled', cents: mine.free ? 0 : mine.cents, view: first.view }

  let t: CancelTry
  if (mine && mine.state !== 'stopped') {
    t = mine
  } else {
    if (first.opts.mode !== 'self' && first.opts.mode !== 'free') {
      throw new CancelError(409, first.opts.mode === 'request' ? 'request-only' : 'changed', first.opts.why ?? CANCEL_MESSAGES.changed, first.view)
    }
    const ids = pickedSeats(first.opts, input.lineIds)
    if (!ids) throw new CancelError(409, 'changed', first.opts.wholeOnly ? CANCEL_MESSAGES.whole : CANCEL_MESSAGES.pick, first.view)
    const free = first.opts.mode === 'free'
    const cents = free ? 0 : cancelSplit(first.lines, ids).reduce((s, x) => s + x.cents, 0)
    t = { attempt, lineIds: [...ids].sort(), cents, free, at: now.toISOString(), state: 'cancelling' }
    const put = t
    await mutate(base, (cur) => {
      const i = cur.tries.findIndex((x) => x.attempt === attempt)
      const tries = i < 0 ? [...cur.tries, put] : cur.tries.map((x, n) => (n === i ? put : x))
      return { next: { ...cur, customer: cur.customer ?? base.customer, tries: tries.slice(-20) }, result: null }
    })
  }

  if (t.free) return finishFree(first, base, t, now)

  const req: RefundRequest = {
    classId: cls.id, bookingId, kind: 'custom', lineIds: t.lineIds, cents: t.cents, freeSeat: true,
    reason: `${SELF_CANCEL_REASON} (${policyWindows.workshopRefundHours}+ hours ahead)`, attempt,
  }
  let refundId = ''
  try {
    const book = await classRefundBook(cls.id, bookingId, { cls, req })
    const r = await runRefund(book, { attempt, reason: req.reason }, customerActor(first.lines))
    refundId = r.refundId
  } catch (e) {
    if (e instanceof RefundError) return refundTrouble(e, base, t, first, now)
    logger.error('Self-cancel refund failed', { bookingId, error: e instanceof Error ? e.message : String(e) })
    throw new CancelError(503, 'unavailable', CANCEL_MESSAGES.unavailable)
  }
  return finished(base, t, refundId, cls, now)
}

/** The refund went through (now, or on a retry): the try is done; only the call that marks it done texts and audits. */
async function finished(base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, t: CancelTry, refundId: string, cls: ScheduledClass, now: Date): Promise<CancelResult> {
  let first = false
  await setTry(base, t.attempt, (cur) => {
    // Set on every CAS try: only the write that actually lands counts.
    first = cur.state !== 'done'
    if (!first) return null
    return { ...cur, state: 'done', refundId: refundId || null, doneAt: now.toISOString(), told: true }
  }).catch(() => undefined)
  if (first) await tellDone(base, t, cls)
  const view = await cancelView(cancelToken(base.classId, base.bookingId), now)
  return { result: 'cancelled', cents: t.free ? 0 : t.cents, view }
}

async function tellDone(base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, t: CancelTry, cls: ScheduledClass): Promise<void> {
  const first = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
  const when = first ? formatSlotLabel(first.startIso) : ''
  const who = nameOf(base.customer)
  const text = t.free
    ? `${who} cancelled ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online. It was a free booking, so nothing was refunded. The seat is back on sale.`
    : `${who} cancelled ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online and got ${formatMoney(t.cents)} back. The seat is back on sale.`
  await alertOwners(text).catch(() => undefined)
  await recordAudit({
    by: { id: 'customer-online', name: `${who} (online)`, role: 'owner' },
    action: 'class-self-cancel',
    target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { bookingId: base.bookingId, lines: t.lineIds.join(','), cents: t.free ? 0 : t.cents, free: t.free, attempt: t.attempt },
  }).catch(() => undefined)
}

async function finishFree(first: Loaded & { bookingId: string }, base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, t: CancelTry, now: Date): Promise<CancelResult> {
  try {
    await freeSeatOnly(first.cls.id, first.bookingId, t.lineIds, customerActor(first.lines), SELF_CANCEL_REASON)
  } catch (e) {
    // A double tap: the other press freed it already (said so, or seen on a fresh read).
    const freedNow = async () => {
      const now2 = bookingLinesOf(await getLedger(first.cls.id), first.bookingId)
      return t.lineIds.every((id) => { const l = now2.find((x) => x.id === id); return !!l && seatFreed(l) })
    }
    if (!(e instanceof RefundError && e.message === ALREADY_FREE) && !(await freedNow().catch(() => false))) {
      logger.error('Self-cancel free seat failed', { bookingId: first.bookingId, error: e instanceof Error ? e.message : String(e) })
      throw new CancelError(503, 'unavailable', CANCEL_MESSAGES.unavailable)
    }
  }
  return finished(base, t, '', first.cls, now)
}

/** What a refund error means for the customer, and what is written down for the owners. */
async function refundTrouble(e: RefundError, base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, t: CancelTry, first: Loaded, now: Date): Promise<CancelResult> {
  const { cls } = first
  if (e.message === SQUARE_NO_ANSWER) {
    // No answer: the seats stay held as "cancelling"; To decide's Ask Square finishes it (the same request, never a second one).
    let tell = false
    await setTry(base, t.attempt, (cur) => {
      tell = false
      if (cur.state === 'done') return null
      tell = !cur.told
      return { ...cur, state: 'unclear', told: true }
    }).catch(() => undefined)
    if (tell) {
      await alertOwners(`${nameOf(base.customer)} cancelled ${seatsText(t.lineIds.length)} of ${cls.content.name} online, but Square didn’t answer the ${formatMoney(t.cents)} refund. Their seats stay held. Open /admin › To decide and tap Ask Square.`).catch(() => undefined)
    }
    logger.error('Self-cancel refund got no answer from Square — seats held', { bookingId: base.bookingId, attempt: t.attempt })
    return { result: 'cancelling', cents: t.cents, view: await cancelView(cancelToken(base.classId, base.bookingId), now) }
  }
  if (e.message === SQUARE_TURNED_DOWN) {
    await setTry(base, t.attempt, (cur) => (cur.state === 'done' ? null : { ...cur, state: 'turned-down' })).catch(() => undefined)
    throw new CancelError(502, 'square', CANCEL_MESSAGES.turnedDown, await cancelView(cancelToken(base.classId, base.bookingId), now))
  }
  // Another refund on the booking is waiting on Square, or was just made (two tabs): nothing was sent for this press.
  await setTry(base, t.attempt, (cur) => (cur.state === 'cancelling' ? { ...cur, state: 'stopped' } : null)).catch(() => undefined)
  const view = await cancelView(cancelToken(base.classId, base.bookingId), now)
  if (e.message === STILL_WAITING_ON_SQUARE) throw new CancelError(409, 'changed', CANCEL_MESSAGES.stillFinishing, view)
  if (e.message === REFUND_JUST_MADE) throw new CancelError(409, 'changed', CANCEL_MESSAGES.changed, view)
  logger.error('Self-cancel refund refused', { bookingId: base.bookingId, status: e.status, message: e.message })
  throw new CancelError(409, 'changed', CANCEL_MESSAGES.changed, view)
}

// ---------------------------------------------------------------- "Send us a note"

/** Inside 48 hours (or anything not self-serve): a note for the owners; Catherine decides in To decide. */
export async function askToCancel(input: { token: unknown; note: unknown; lineIds?: unknown }, now = new Date()): Promise<{ result: 'requested'; view: CancelView }> {
  const first = await load(input.token, now)
  const note = typeof input.note === 'string' ? input.note.trim().replace(/\s+/g, ' ') : ''
  if (note.length > 500) throw new CancelError(400, 'invalid', CANCEL_MESSAGES.noteTooLong, first.view)
  if (first.view.state === 'cancelled' || (first.opts.mode === 'none' && first.view.state !== 'cancelling')) {
    throw new CancelError(409, 'changed', first.opts.why ?? CANCEL_MESSAGES.changed, first.view)
  }
  const booked = first.opts.seats.filter((s) => s.state === 'booked').map((s) => s.lineId)
  const asked = Array.isArray(input.lineIds) ? input.lineIds.filter((x): x is string => typeof x === 'string' && booked.includes(x)) : []
  const lineIds = asked.length ? asked : booked
  const base = { classId: first.cls.id, bookingId: first.bookingId, customer: first.lines.find((l) => l.customer)?.customer ?? null }
  const ask: CancelAsk = { at: now.toISOString(), note, lineIds, why: first.opts.why ?? '', told: true }
  // The same note sent twice (a double tap, a reload) is one note.
  const added = await mutate(base, (cur) => {
    const last = cur.asks[cur.asks.length - 1]
    if (last && last.note === note && now.getTime() - Date.parse(last.at) < 10 * 60_000) return { next: null, result: false }
    return { next: { ...cur, customer: cur.customer ?? base.customer, asks: [...cur.asks, ask].slice(-10) }, result: true }
  })
  if (added) {
    const when = first.view.whenLabel
    const inside = first.opts.hoursLeft > 0 && first.opts.hoursLeft < policyWindows.workshopRefundHours
    await alertOwners(`${nameOf(base.customer)} asked to cancel ${seatsText(lineIds.length)} of ${first.cls.content.name} (${when})${inside ? `, inside ${policyWindows.workshopRefundHours} hours` : ''}${note ? `: “${note}”` : ''}. Open /admin › To decide to refund, free the seat or keep their booking.`).catch(() => undefined)
    await recordAudit({
      by: { id: 'customer-online', name: `${nameOf(base.customer)} (online)`, role: 'owner' },
      action: 'class-cancel-request',
      target: { kind: 'class', id: first.cls.id, label: first.cls.content.name },
      details: { bookingId: first.bookingId, lines: lineIds.join(','), note: note.slice(0, 200) },
    }).catch(() => undefined)
  }
  return { result: 'requested', view: await cancelView(cancelToken(base.classId, base.bookingId), now) }
}

// ---------------------------------------------------------------- for /admin

/** One line for the booking row on the class sheet (null = nothing to say). */
export function cancelWords(rec: CancelRecord | null, lines: LedgerLine[], now: Date): string | null {
  if (!rec) return null
  const tries = rec.tries.map((t) => ({ t, st: tryState(t, lines, now) }))
  const unclear = tries.find((x) => x.st === 'unclear' || x.st === 'cancelling')
  if (unclear) return `Cancelling online · ${formatMoney(unclear.t.cents)} refund waiting on Square (To decide › Ask Square)`
  const done = tries.filter((x) => x.st === 'done')
  const ask = rec.asks[rec.asks.length - 1]
  const bits: string[] = []
  if (done.length) bits.push(`Cancelled online by the customer · ${seatsText(done.reduce((n, x) => n + x.t.lineIds.length, 0))}${done.some((x) => !x.t.free) ? `, ${formatMoney(done.reduce((s, x) => s + (x.t.free ? 0 : x.t.cents), 0))} refunded` : ''}`)
  if (ask) bits.push(`Asked to cancel${ask.note ? `: “${ask.note}”` : ''}`)
  return bits.length ? bits.join(' · ') : null
}

/** For a refund that Square never answered: the request the customer's press saved, sent again with the same key. */
export async function retrySelfCancel(classId: string, bookingId: string, attempt: string, now = new Date()): Promise<CancelResult> {
  const rec = await getCancelRecord(bookingId)
  const t = rec?.tries.find((x) => x.attempt === attempt)
  if (!rec || !t) throw new CancelError(404, 'not-found', 'That cancel isn’t on the booking any more.')
  return selfCancel({ token: cancelToken(classId, bookingId), lineIds: t.lineIds, attempt }, now)
}

// ---------------------------------------------------------------- To decide and the warnings

/**
 * What an owner must look at, said once for /admin › To decide (with buttons)
 * and the warnings (/staff, the morning email):
 *   cancel-request  a customer sent a note asking to cancel (inside 48 hours,
 *                   a gift seat, paid at the studio…) → Refund and free the
 *                   seat · Free the seat, no refund · Keep their booking
 *   cancel-unclear  a customer's own cancel whose refund Square didn't answer
 *                   (their seats are held) → Ask Square; or one Square turned
 *                   down (nothing refunded, still booked) → Try the refund
 *                   again · Got it
 */
export interface CancelItem {
  id: string
  kind: 'cancel-request' | 'cancel-unclear'
  at: string
  classId: string
  className: string
  title: string
  head: string
  hint: string
  /** for the warnings line */
  warning: string
  detail: Record<string, unknown>
}

/** The same form as every decided id. */
const itemIdOf = tokenOf

export const cancelRequestId = (bookingId: string, askAt: string) => itemIdOf(`cxr-${bookingId}-${askAt}`)
export const cancelUnclearId = (bookingId: string, attempt: string) => itemIdOf(`cxu-${bookingId}-${attempt}`)

export async function cancelItems(decided: ReadonlySet<string>, now: Date, readClass: (id: string) => Promise<ScheduledClass | null> = (id) => getClass(id).catch(() => null)): Promise<CancelItem[]> {
  const out: CancelItem[] = []
  for (const rec of await listCancelRecords()) {
    const cls = await readClass(rec.classId)
    if (!cls) continue
    const lines = bookingLinesOf(await getLedger(cls.id), rec.bookingId)
    const who = nameOf(rec.customer ?? lines.find((l) => l.customer)?.customer ?? null)
    const first = [...cls.sessions].filter((s) => lines.some((l) => l.sessionIds.includes(s.id))).sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
    const when = first ? formatSlotLabel(first.startIso) : ''
    const contact = { name: who, email: rec.customer?.email ?? '', phone: rec.customer?.phone ?? '', bookingId: rec.bookingId }
    // A customer's own cancel that Square didn't answer, or turned down (and they haven't cancelled since).
    const states = rec.tries.map((t) => ({ t, st: tryState(t, lines, now) }))
    states.forEach(({ t, st }, i) => {
      const later = states.slice(i + 1).some((x) => x.st === 'done' || x.st === 'unclear' || x.st === 'cancelling')
      if (st !== 'unclear' && !(st === 'turned-down' && !later)) return
      const id = cancelUnclearId(rec.bookingId, t.attempt)
      if (decided.has(id)) return
      const unclear = st === 'unclear'
      out.push({
        id, kind: 'cancel-unclear', at: t.at, classId: cls.id, className: cls.content.name,
        title: unclear ? 'Customer’s cancel, refund unclear' : 'Customer’s cancel, refund turned down',
        head: unclear
          ? `${who} cancelled ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online, and Square didn’t answer the ${formatMoney(t.cents)} refund. Their seats are held until we know.`
          : `${who} tried to cancel ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online, but Square turned the ${formatMoney(t.cents)} refund down. Nothing was refunded and they’re still booked. The page told them to try again or send a note.`,
        hint: unclear ? 'Ask Square' : 'Try the refund again, or call them',
        warning: unclear
          ? `${cls.content.name}: ${who} cancelled online and Square didn’t answer the ${formatMoney(t.cents)} refund. Their seats are held.`
          : `${cls.content.name}: ${who}’s online cancel was turned down by Square. Nothing was refunded; they’re still booked.`,
        detail: { ...contact, attempt: t.attempt, cents: t.cents, seats: t.lineIds.length, state: st },
      })
    })
    // The last note they sent, while there's still something booked to decide about.
    const ask = rec.asks[rec.asks.length - 1]
    if (ask) {
      const id = cancelRequestId(rec.bookingId, ask.at)
      const booked = lines.filter((l) => isComingLine(l))
      const lineIds = ask.lineIds.filter((x) => booked.some((l) => l.id === x))
      const ids = lineIds.length ? lineIds : booked.map((l) => l.id)
      if (!decided.has(id) && ids.length) {
        const chosen = lines.filter((l) => ids.includes(l.id))
        const refundCents = cancelSplit(lines, ids).reduce((s, x) => s + x.cents, 0)
        const canRefund = refundCents > 0 && chosen.every((l) => (l.source === 'online' || l.source === 'door-card' || l.source === 'door-reader') && !!l.square.paymentId && l.refunds.length === 0)
        const hours = first ? (Date.parse(first.startIso) - Date.parse(ask.at)) / 3_600_000 : 0
        const inside = hours > 0 && hours < policyWindows.workshopRefundHours
        out.push({
          id, kind: 'cancel-request', at: ask.at, classId: cls.id, className: cls.content.name,
          title: 'Customer asked to cancel',
          head: `${who} asked to cancel ${seatsText(ids.length)} of ${cls.content.name} (${when})${inside ? `, ${Math.max(1, Math.floor(hours))} hours before it starts` : ''}.${ask.note ? ` Their note: “${ask.note}”` : ''}`,
          hint: 'Refund, free the seat, or keep their booking',
          warning: `${cls.content.name}: ${who} asked to cancel ${seatsText(ids.length)}${ask.note ? ` (“${ask.note.slice(0, 80)}”)` : ''}.`,
          detail: { ...contact, lineIds: ids, seats: ids.length, note: ask.note, why: ask.why, canRefund, refundCents, inside, source: chosen[0]?.source ?? null },
        })
      }
    }
  }
  return out
}

const isComingLine = (l: LedgerLine) => (l.state === 'confirmed' || l.state === 'refunded') && !seatFreed(l)
