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
import { hashOf, listRefundRequests, isWaiting, type SavedRefundRequest } from './refund-requests'
import { classRefundBook, freeSeatOnly, ALREADY_FREE, type RefundRequest } from './refunds'
import { clearRequest, runRefund } from '@lib/booking-core/refund-runner'
import { askAboutRequest } from '@lib/booking-core/ask-square'
import { RefundError, REFUND_JUST_MADE, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE } from '@lib/booking-core/refund-words'
import { assertClassWritesAllowed } from './test-site-guard'
import { cancelToken, readCancelToken } from './self-cancel-token'
import { bookingLinesOf, cancelOptions, cancelSplit, pickedSeats, wallHoursBetween, type CancelOptions, type CancelSeat } from './self-cancel-rules'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

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
  /** money M12: the id of the refund request this press saves (known before Square is called), so it's always found */
  requestId?: string
  /** F3: an owner's Ask Square found no refund on the payment (then: try again · release the seats) */
  noRefundSeenAt?: string
  /** F3: an owner released the held seats with no refund (Square showed none): the cancel is called off */
  released?: { by: By; at: string }
}

/** One "Send us a note". */
export interface CancelAsk { at: string; note: string; lineIds: string[]; why: string; told: boolean }

/** F8: at most this many owner texts per booking link in a day (notes past it still save and show in To decide). */
export const OWNER_TEXTS_PER_DAY = 3
/** F7: the note is cut to this in the owner text, so "Open /admin › To decide" always fits (To decide has it in full). */
export const NOTE_IN_TEXT_MAX = 120

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
  const keys = (await kv.list('cxl-')).filter((k) => k.startsWith('cxl-'))
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
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      await casPause(i)
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

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * The refund request a customer's press saved (the shared runner saves it before Square is called): the
 * customer's own, for exactly these seats and this amount, made since the press. Null = nothing was saved,
 * so nothing can have gone to Square.
 */
export function requestOfTry(t: Pick<CancelTry, 'lineIds' | 'cents' | 'at' | 'requestId'>, saved: SavedRefundRequest[]): SavedRefundRequest | null {
  // M12: the press knows its request's id: matched exactly, however long after the press it was saved.
  if (t.requestId) {
    const exact = saved.find((r) => r.id === t.requestId)
    if (exact) return exact
  }
  const since = Date.parse(t.at) - 60_000
  return saved
    .filter((r) => r.by.id.startsWith('customer-online') && r.totalCents === t.cents && sameIds(r.lines.map((x) => x.id), t.lineIds) && Date.parse(r.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/**
 * A try's state as it stands: unclear or in flight whose seats were freed
 * since (Square's webhook or "It went through" finished the refund) is done.
 * F3: its saved refund request decides too: done/sent → done, turned down →
 * turned-down (so a request cleared as "didn't go through" never leaves the
 * seats held).
 */
export function tryState(t: CancelTry, lines: LedgerLine[], now: Date, saved?: SavedRefundRequest[]): CancelTry['state'] {
  if ((t.state === 'unclear' || t.state === 'cancelling') && t.lineIds.length && t.lineIds.every((id) => { const l = lines.find((x) => x.id === id); return !!l && seatFreed(l) })) return 'done'
  if ((t.state === 'unclear' || t.state === 'cancelling') && saved && !t.free) {
    const r = requestOfTry(t, saved)
    if (r?.status === 'turned-down') return 'turned-down'
    if (r && (r.status === 'done' || (r.status === 'sent' && !!r.squareRefundId))) return 'done'
  }
  if (t.state === 'cancelling' && now.getTime() - Date.parse(t.at) >= CANCEL_STALE_MS) {
    // Concurrency minor 5: the press stopped before its refund request was saved (we know its id): nothing can
    // have reached Square, so it's simply stopped (the customer can press again), never "unclear" for an owner.
    if (saved && !t.free && t.requestId && !requestOfTry(t, saved)) return 'stopped'
    return 'unclear'
  }
  return t.state
}

/** F2: what came back online, counting one Square refund once (two presses that ended on the same refund). */
function refundedOnline(done: CancelTry[]): { cents: Cents; seats: number } {
  const seen = new Set<string>()
  let cents = 0
  const seats = new Set<string>()
  for (const t of done) {
    for (const id of t.lineIds) seats.add(id)
    if (t.free) continue
    if (t.refundId) {
      if (seen.has(t.refundId)) continue
      seen.add(t.refundId)
    }
    cents += t.cents
  }
  return { cents, seats: seats.size }
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

interface Loaded { cls: ScheduledClass; lines: LedgerLine[]; rec: CancelRecord | null; opts: CancelOptions; view: CancelView; saved: SavedRefundRequest[] }

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
  // A list that can't be read is "unknown" (never read as "nothing was saved").
  const [ledger, rec, savedOrNull] = await Promise.all([getLedger(cls.id), getCancelRecord(ids.bookingId), listRefundRequests(cls.id, ids.bookingId).catch(() => null)])
  const saved = savedOrNull ?? []
  const lines = bookingLinesOf(ledger, ids.bookingId)
  if (!lines.length) throw new CancelError(404, 'not-found', CANCEL_MESSAGES.notFound)
  // Held as "cancelling": a try Square hasn't answered, or any refund on these seats still waiting on Square.
  const cancelling = new Set<string>()
  for (const t of rec?.tries ?? []) {
    const st = tryState(t, lines, now, savedOrNull ?? undefined)
    if (st === 'cancelling' || st === 'unclear') for (const id of t.lineIds) cancelling.add(id)
  }
  for (const r of saved.filter(isWaiting)) for (const x of r.lines) cancelling.add(x.id)
  const opts = cancelOptions(cls, lines, now, { policyHours: policyWindows.workshopRefundHours, cancelling })
  const first = opts.firstStartIso
  const ask = rec?.asks[rec.asks.length - 1] ?? null
  const done = (rec?.tries ?? []).filter((t) => tryState(t, lines, now, saved) === 'done')
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
    refundedCents: refundedOnline(done).cents,
  }
  return { ...ids, cls, lines, rec, opts, view, saved }
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
  if (mine && tryState(mine, first.lines, now, first.saved) === 'done') return { result: 'cancelled', cents: mine.free ? 0 : mine.cents, view: first.view }

  let t: CancelTry
  if (mine && mine.state !== 'stopped') {
    // M13(a): a retried press keeps its own seats; one sent with different seats is refused (nothing sent).
    const askedIds = Array.isArray(input.lineIds) ? input.lineIds.filter((x): x is string => typeof x === 'string') : null
    if (askedIds && askedIds.length && !sameIds(askedIds, mine.lineIds)) {
      throw new CancelError(409, 'changed', CANCEL_MESSAGES.stillFinishing, first.view)
    }
    t = mine
  } else {
    if (first.opts.mode !== 'self' && first.opts.mode !== 'free') {
      throw new CancelError(409, first.opts.mode === 'request' ? 'request-only' : 'changed', first.opts.why ?? CANCEL_MESSAGES.changed, first.view)
    }
    const ids = pickedSeats(first.opts, input.lineIds)
    if (!ids) throw new CancelError(409, 'changed', first.opts.wholeOnly ? CANCEL_MESSAGES.whole : CANCEL_MESSAGES.pick, first.view)
    const splitCents = first.opts.mode === 'free' ? 0 : cancelSplit(first.lines, ids).reduce((s, x) => s + x.cents, 0)
    // M13(b): only $0 seats picked on a paid booking: nothing to refund, so the seats are just freed (a $0 refund is refused).
    const free = first.opts.mode === 'free' || splitCents === 0
    const cents = free ? 0 : splitCents
    t = { attempt, lineIds: [...ids].sort(), cents, free, at: now.toISOString(), state: 'cancelling' }
    const put = t
    // F2: two tabs (or two devices) pressing at once: a seat another press is cancelling, or has cancelled, is
    // refused here, before anything is sent, so one refund is one try (one text, one audit, the right totals).
    const clash = await mutate(base, (cur): { next: CancelRecord | null; result: 'busy' | 'done' | null } => {
      const other = cur.tries
        .filter((x) => x.attempt !== attempt && x.lineIds.some((id) => put.lineIds.includes(id)))
        .map((x) => tryState(x, first.lines, now, first.saved))
      if (other.some((st) => st === 'cancelling' || st === 'unclear')) return { next: null, result: 'busy' }
      if (other.some((st) => st === 'done')) return { next: null, result: 'done' }
      const i = cur.tries.findIndex((x) => x.attempt === attempt)
      const tries = i < 0 ? [...cur.tries, put] : cur.tries.map((x, n) => (n === i ? put : x))
      return { next: { ...cur, customer: cur.customer ?? base.customer, tries: tries.slice(-20) }, result: null }
    })
    if (clash) {
      const view = await cancelView(cancelToken(base.classId, base.bookingId), now)
      throw new CancelError(409, 'changed', clash === 'busy' ? CANCEL_MESSAGES.stillFinishing : CANCEL_MESSAGES.changed, view)
    }
  }

  if (t.free) return finishFree(first, base, t, now)

  const req: RefundRequest = {
    classId: cls.id, bookingId, kind: 'custom', lineIds: t.lineIds, cents: t.cents, freeSeat: true,
    reason: `${SELF_CANCEL_REASON} (${policyWindows.workshopRefundHours}+ hours ahead)`, attempt,
  }
  let refundId = ''
  try {
    const book = await classRefundBook(cls.id, bookingId, { cls, req })
    // M12: the request this press will save, by id, written on the press before Square is called.
    if (!t.requestId && book.inputHash) {
      const requestId = hashOf('refund-attempt', book.inputHash, attempt)
      await setTry(base, t.attempt, (cur) => (cur.requestId ? null : { ...cur, requestId })).catch(() => undefined)
      t = { ...t, requestId }
    }
    const r = await runRefund(book, { attempt, reason: req.reason }, customerActor(first.lines))
    refundId = r.refundId
  } catch (e) {
    if (e instanceof RefundError) return refundTrouble(e, base, t, first, now)
    logger.error('Self-cancel refund failed', { bookingId, error: e instanceof Error ? e.message : String(e) })
    // F4: was the refund request saved (so it may have gone to Square)? None → nothing was sent: the press is
    // stopped and nothing stays held. Saved, or we can't tell → treated as no answer: the seats stay held, the
    // owners are texted and To decide shows it now (not after 5 minutes), and the customer is told honestly.
    const saved = await listRefundRequests(cls.id, bookingId).catch(() => null)
    if (saved && !requestOfTry(t, saved)) {
      await setTry(base, t.attempt, (cur) => (cur.state === 'cancelling' ? { ...cur, state: 'stopped' } : null)).catch(() => undefined)
      throw new CancelError(503, 'unavailable', CANCEL_MESSAGES.unavailable, await cancelView(cancelToken(base.classId, base.bookingId), now).catch(() => undefined))
    }
    return refundTrouble(new RefundError(502, SQUARE_NO_ANSWER), base, t, first, now)
  }
  return finished(base, t, refundId, cls, now)
}

/** The refund went through (now, or on a retry): the try is done; only the call that marks it done texts and audits. */
async function finished(base: Omit<CancelRecord, 'tries' | 'asks' | 'updatedAt'>, t: CancelTry, refundId: string, cls: ScheduledClass, now: Date): Promise<CancelResult> {
  let first = false
  let sameRefund = false
  await mutate(base, (cur) => {
    // Set on every CAS try: only the write that actually lands counts.
    first = false
    const i = cur.tries.findIndex((x) => x.attempt === t.attempt)
    if (i < 0 || cur.tries[i].state === 'done') return { next: null, result: null }
    first = true
    // F2: another press already finished on this very Square refund: it told the owners and audited it.
    sameRefund = !!refundId && cur.tries.some((x, n) => n !== i && x.state === 'done' && x.refundId === refundId)
    const tries = cur.tries.map((x, n) => (n === i ? { ...x, state: 'done' as const, refundId: refundId || null, doneAt: now.toISOString(), told: true } : x))
    return { next: { ...cur, tries }, result: null }
  }).catch(() => undefined)
  if (first && !sameRefund) await tellDone(base, t, cls)
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
      // F4: no money is involved: the press stops and nothing stays held.
      await setTry(base, t.attempt, (cur) => (cur.state === 'cancelling' ? { ...cur, state: 'stopped' } : null)).catch(() => undefined)
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
  // M11: the runner answered 500 (e.g. Square made the refund but it couldn't be saved here): that's "no answer"
  // for the customer and the owners (seats held, Ask Square finishes it once), never "your booking just changed".
  if (e.status >= 500) return refundTrouble(new RefundError(502, SQUARE_NO_ANSWER), base, t, first, now)
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
  // The same note sent twice (a double tap, a reload) is one note. F8: at most OWNER_TEXTS_PER_DAY owner texts per
  // booking link a day; a note past that still saves and shows in To decide.
  let text = false
  const added = await mutate(base, (cur) => {
    const last = cur.asks[cur.asks.length - 1]
    if (last && last.note === note && now.getTime() - Date.parse(last.at) < 10 * 60_000) return { next: null, result: false }
    const textedToday = cur.asks.filter((a) => a.told && now.getTime() - Date.parse(a.at) < 86_400_000).length
    text = textedToday < OWNER_TEXTS_PER_DAY
    const ask: CancelAsk = { at: now.toISOString(), note, lineIds, why: first.opts.why ?? '', told: text }
    return { next: { ...cur, customer: cur.customer ?? base.customer, asks: [...cur.asks, ask].slice(-10) }, result: true }
  })
  if (added) {
    const when = first.view.whenLabel
    const inside = first.opts.hoursLeft > 0 && first.opts.policyHoursLeft < policyWindows.workshopRefundHours
    const short = note.length > NOTE_IN_TEXT_MAX ? `${note.slice(0, NOTE_IN_TEXT_MAX - 1).trimEnd()}…` : note
    if (text) await alertOwners(`${nameOf(base.customer)} asked to cancel ${seatsText(lineIds.length)} of ${first.cls.content.name} (${when})${inside ? `, inside ${policyWindows.workshopRefundHours} hours` : ''}${short ? `: “${short}”` : ''}. Open /admin › To decide to refund, free the seat or keep their booking.`).catch(() => undefined)
    await recordAudit({
      by: { id: 'customer-online', name: `${nameOf(base.customer)} (online)`, role: 'owner' },
      action: 'class-cancel-request',
      target: { kind: 'class', id: first.cls.id, label: first.cls.content.name },
      details: { bookingId: first.bookingId, lines: lineIds.join(','), note: note.slice(0, 200), ...(text ? {} : { texted: false }) },
    }).catch(() => undefined)
  }
  return { result: 'requested', view: await cancelView(cancelToken(base.classId, base.bookingId), now) }
}

// ---------------------------------------------------------------- for /admin

/** One line for the booking row on the class sheet (null = nothing to say). */
export function cancelWords(rec: CancelRecord | null, lines: LedgerLine[], now: Date, saved?: SavedRefundRequest[]): string | null {
  if (!rec) return null
  const tries = rec.tries.map((t) => ({ t, st: tryState(t, lines, now, saved) }))
  // F11: a press still in flight (its first 5 minutes) isn't in To decide yet.
  const flying = tries.find((x) => x.st === 'cancelling')
  if (flying) return `Cancelling online… (${formatMoney(flying.t.cents)} refund on its way)`
  const unclear = tries.find((x) => x.st === 'unclear')
  if (unclear) return `Cancelling online · ${formatMoney(unclear.t.cents)} refund waiting on Square (To decide › Ask Square)`
  const done = tries.filter((x) => x.st === 'done').map((x) => x.t)
  const lastDown = [...tries].reverse().find((x) => x.st === 'turned-down' && !x.t.released)
  const laterDone = lastDown ? tries.slice(tries.indexOf(lastDown) + 1).some((x) => x.st === 'done') : false
  const ask = rec.asks[rec.asks.length - 1]
  const bits: string[] = []
  if (done.length) {
    // F2: one Square refund counted once.
    const total = refundedOnline(done)
    bits.push(`Cancelled online by the customer · ${seatsText(total.seats)}${done.some((t) => !t.free) ? `, ${formatMoney(total.cents)} refunded` : ''}`)
  }
  if (lastDown && !laterDone) bits.push(`Online cancel’s ${formatMoney(lastDown.t.cents)} refund turned down by Square; still booked (To decide)`)
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

/**
 * Money review I2: what Square shows for this saved request, read only, from
 * Square's own list of refunds on the payment (the shared Ask Square), never
 * from the payment's refunded total (which may leave out a PENDING refund):
 *   'refund'  Square made it (or already took it: we have its refund id)
 *   'pending' Square shows it still going through: nothing may be decided yet
 *   'none'    no such refund (or it failed)
 */
async function squareShows(classId: string, bookingId: string, r: SavedRefundRequest): Promise<'refund' | 'pending' | 'none'> {
  if (r.status === 'sent' || r.squareRefundId) return 'refund'
  try {
    const { answer } = await askAboutRequest({ classId, bookingId }, r.id)
    return answer.state === 'done' ? 'refund' : answer.state === 'pending' ? 'pending' : 'none'
  } catch (e) {
    if (e instanceof RefundError && e.status === 404) return 'refund' // settled meanwhile: the retry reads it as it stands
    throw new CancelError(503, 'unavailable', 'Square isn’t answering right now. Their seats stay held. Try again in a few minutes.')
  }
}

export const CANCEL_REFUND_PENDING = 'Square shows this refund still going through. Their seats stay held. Ask Square again in a little while. Nothing was changed.'

export type CancelAskAnswer = { result: 'cancelled' | 'cancelling'; cents: Cents } | { result: 'no-refund' }

/**
 * F3 "Ask Square" on a customer's cancel whose refund Square didn't answer.
 * Square is read first: a refund on the payment we haven't recorded → the
 * saved request is sent again with the same key (Square hands back that same
 * refund, never a second one) and the cancel finishes. No refund shown → said
 * so; the owner then picks Try again (the same request, same key) or Release
 * the seats (no refund). Nothing is ever sent on top of a possibly-sent refund.
 */
export async function askSquareAboutCancel(classId: string, bookingId: string, attempt: string, now = new Date()): Promise<CancelAskAnswer> {
  const rec = await getCancelRecord(bookingId)
  const t = rec?.tries.find((x) => x.attempt === attempt)
  if (!rec || !t) throw new CancelError(404, 'not-found', 'That cancel isn’t on the booking any more.')
  const r = requestOfTry(t, await listRefundRequests(classId, bookingId))
  if (!r || r.status === 'done' || r.status === 'turned-down') {
    // Nothing was saved (so nothing went to Square), or it's settled: the page reads it as it stands.
    const out = await retrySelfCancel(classId, bookingId, attempt, now)
    return { result: out.result, cents: out.cents }
  }
  const shows = await squareShows(classId, bookingId, r)
  if (shows === 'pending') throw new CancelError(409, 'changed', CANCEL_REFUND_PENDING)
  if (shows === 'refund') {
    const out = await retrySelfCancel(classId, bookingId, attempt, now)
    return { result: out.result, cents: out.cents }
  }
  await setTry({ classId, bookingId, customer: rec.customer }, attempt, (cur) => (cur.state === 'done' ? null : { ...cur, noRefundSeenAt: now.toISOString() })).catch(() => undefined)
  return { result: 'no-refund' }
}

/**
 * F3 "Keep their booking (no refund)": only after Ask Square showed no refund,
 * and read again now. The saved request is cleared as "didn't go through"
 * (the shared runner's check, audited); the press is called off, so the seats
 * stop being held and the customer stays booked. Nothing is refunded.
 */
export async function releaseSelfCancel(classId: string, bookingId: string, attempt: string, by: By, now = new Date()): Promise<void> {
  const rec = await getCancelRecord(bookingId)
  const t = rec?.tries.find((x) => x.attempt === attempt)
  if (!rec || !t) throw new CancelError(404, 'not-found', 'That cancel isn’t on the booking any more.')
  if (t.released) return
  if (!t.noRefundSeenAt) throw new CancelError(409, 'changed', 'Ask Square first. Their seats stay held until we know about the refund.')
  const cls = await getClass(classId)
  if (!cls) throw new CancelError(404, 'not-found', 'That class isn’t on file any more.')
  const r = requestOfTry(t, await listRefundRequests(classId, bookingId))
  if (r && (r.status === 'pending' || r.status === 'sent')) {
    const shows = await squareShows(classId, bookingId, r)
    if (shows === 'pending') throw new CancelError(409, 'changed', CANCEL_REFUND_PENDING)
    if (shows === 'refund') throw new CancelError(409, 'changed', 'Square shows a refund on this payment now. Tap Ask Square to finish the cancel.')
    try {
      const book = await classRefundBook(classId, bookingId, { cls })
      await clearRequest(book, r.id, 'did-not-go-through', 'Square showed no refund (To decide › Keep their booking)', { by, role: 'owner' })
    } catch (e) {
      if (!(e instanceof RefundError)) throw e
      // Already settled by someone else: read it again.
      const fresh = requestOfTry(t, await listRefundRequests(classId, bookingId))
      if (fresh?.status === 'done') throw new CancelError(409, 'changed', 'The refund went through meanwhile, so they’re cancelled.')
    }
  }
  let wrote = false
  await setTry({ classId, bookingId, customer: rec.customer }, attempt, (cur) => {
    wrote = false
    if (cur.state === 'done' || cur.released) return null
    wrote = true
    return { ...cur, state: 'stopped', released: { by: { id: by.id, name: by.name }, at: now.toISOString() } }
  })
  if (wrote) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'class-self-cancel-released',
      target: { kind: 'class', id: classId, label: cls.content.name },
      details: { bookingId, attempt, cents: t.cents, lines: t.lineIds.join(',') },
    }).catch(() => undefined)
  }
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
  // F10: ledgers read once per class, and only for records with something still open.
  const ledgers = new Map<string, Promise<Awaited<ReturnType<typeof getLedger>>>>()
  const ledgerOf = (classId: string) => {
    if (!ledgers.has(classId)) ledgers.set(classId, getLedger(classId))
    return ledgers.get(classId)!
  }
  for (const rec of await listCancelRecords()) {
    // Nothing open without reading anything else: every press settled (done, stopped) and the last note decided.
    const lastAsk = rec.asks[rec.asks.length - 1]
    const pressOpen = rec.tries.some((t) => t.state === 'cancelling' || t.state === 'unclear' || (t.state === 'turned-down' && !decided.has(cancelUnclearId(rec.bookingId, t.attempt))))
    const askOpen = !!lastAsk && !decided.has(cancelRequestId(rec.bookingId, lastAsk.at))
    if (!pressOpen && !askOpen) continue
    const cls = await readClass(rec.classId)
    if (!cls) continue
    const lines = bookingLinesOf(await ledgerOf(cls.id), rec.bookingId)
    const saved = pressOpen ? await listRefundRequests(cls.id, rec.bookingId).catch(() => [] as SavedRefundRequest[]) : []
    const who = nameOf(rec.customer ?? lines.find((l) => l.customer)?.customer ?? null)
    const first = [...cls.sessions].filter((s) => lines.some((l) => l.sessionIds.includes(s.id))).sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
    const when = first ? formatSlotLabel(first.startIso) : ''
    const contact = { name: who, email: rec.customer?.email ?? '', phone: rec.customer?.phone ?? '', bookingId: rec.bookingId }
    // A customer's own cancel that Square didn't answer, or turned down (and they haven't cancelled since).
    const states = rec.tries.map((t) => ({ t, st: tryState(t, lines, now, saved) }))
    states.forEach(({ t, st }, i) => {
      const later = states.slice(i + 1).some((x) => x.st === 'done' || x.st === 'unclear' || x.st === 'cancelling')
      if (st !== 'unclear' && !(st === 'turned-down' && !later)) return
      const id = cancelUnclearId(rec.bookingId, t.attempt)
      if (decided.has(id)) return
      const unclear = st === 'unclear'
      const noRefund = unclear && !!t.noRefundSeenAt
      out.push({
        id, kind: 'cancel-unclear', at: t.at, classId: cls.id, className: cls.content.name,
        title: unclear ? 'Customer’s cancel, refund unclear' : 'Customer’s cancel, refund turned down',
        head: unclear
          ? `${who} cancelled ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online, and Square didn’t answer the ${formatMoney(t.cents)} refund. Their seats are held until we know.${noRefund ? ' When you asked, Square showed no refund on their payment.' : ''}`
          : `${who} tried to cancel ${seatsText(t.lineIds.length)} of ${cls.content.name} (${when}) online, but Square turned the ${formatMoney(t.cents)} refund down. Nothing was refunded and they’re still booked. The page told them to try again or send a note.`,
        hint: noRefund ? 'Try again, or release the seats' : unclear ? 'Ask Square' : 'Try the refund again, or call them',
        warning: unclear
          ? `${cls.content.name}: ${who} cancelled online and Square didn’t answer the ${formatMoney(t.cents)} refund. Their seats are held.`
          : `${cls.content.name}: ${who}’s online cancel was turned down by Square. Nothing was refunded; they’re still booked.`,
        detail: { ...contact, attempt: t.attempt, cents: t.cents, seats: t.lineIds.length, state: st, noRefundSeen: noRefund },
      })
    })
    // The last note they sent, while there's still something booked to decide about.
    const ask = lastAsk
    if (ask && askOpen) {
      const id = cancelRequestId(rec.bookingId, ask.at)
      const booked = lines.filter((l) => isComingLine(l))
      const lineIds = ask.lineIds.filter((x) => booked.some((l) => l.id === x))
      const ids = lineIds.length ? lineIds : booked.map((l) => l.id)
      if (ids.length) {
        const chosen = lines.filter((l) => ids.includes(l.id))
        const refundCents = cancelSplit(lines, ids).reduce((s, x) => s + x.cents, 0)
        const canRefund = refundCents > 0 && chosen.every((l) => (l.source === 'online' || l.source === 'door-card' || l.source === 'door-reader') && !!l.square.paymentId && l.refunds.length === 0)
        const hours = first ? wallHoursBetween(Date.parse(ask.at), first.startIso) : 0
        const elapsed = first ? (Date.parse(first.startIso) - Date.parse(ask.at)) / 3_600_000 : 0
        const inside = elapsed > 0 && hours < policyWindows.workshopRefundHours
        // F6: which sentence To decide shows under the choices.
        const reason: CancelReason = chosen.some((l) => l.source === 'comp')
          ? 'comp'
          : chosen.length && chosen.every((l) => (l.source === 'online' || l.source === 'door-card') && !l.square.paymentId && (l.square.chargedCents ?? 0) === 0)
            ? 'free'
            : chosen.some((l) => l.source === 'door-counter' || l.source === 'pos')
              ? 'studio'
              : chosen.some((l) => l.refunds.length > 0)
                ? 'partly'
                : chosen.some((l) => !l.square.paymentId)
                  ? 'no-payment'
                  : elapsed <= 0 ? 'started' : inside ? 'inside' : 'outside'
        out.push({
          id, kind: 'cancel-request', at: ask.at, classId: cls.id, className: cls.content.name,
          title: 'Customer asked to cancel',
          head: `${who} asked to cancel ${seatsText(ids.length)} of ${cls.content.name} (${when})${inside ? `, ${Math.max(1, Math.floor(hours))} hours before it starts` : ''}.${ask.note ? ` Their note: “${ask.note}”` : ''}`,
          hint: 'Refund, free the seat, or keep their booking',
          warning: `${cls.content.name}: ${who} asked to cancel ${seatsText(ids.length)}${ask.note ? ` (“${ask.note.slice(0, 80)}”)` : ''}.`,
          detail: { ...contact, lineIds: ids, seats: ids.length, note: ask.note, why: ask.why, canRefund, refundCents, inside, reason, source: chosen[0]?.source ?? null },
        })
      }
    }
  }
  return out
}

/** F6: why a customer's note can (or can't) be refunded from To decide, for the sentence under the choices. */
export type CancelReason = 'comp' | 'free' | 'studio' | 'partly' | 'no-payment' | 'started' | 'inside' | 'outside'

const isComingLine = (l: LedgerLine) => (l.state === 'confirmed' || l.state === 'refunded') && !seatFreed(l)
