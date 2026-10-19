/**
 * Refunds on our own classes, from /admin (owners) and /staff (crew, with a
 * reason). Square moves the money; the seat ledger decides how much is left
 * to give back and whether the seat frees.
 *
 * Order of work: plan from the ledger (refuse anything wrong before any money
 * moves) → ONE Square refund for the total → record it on the ledger with the
 * Square refund id → email the customer (best effort) → audit. A Square error
 * writes nothing. Nothing here ever runs on its own; a person asks for it.
 */
import { createHash, randomUUID } from 'node:crypto'
import { providers } from '@config/providers'
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import type { By } from '@lib/staff-auth'
import { getClass } from './class-store'
import { getLedger, noteRefundFailed, recordRefund, recordRequestRefund, type Ledger, type LedgerLine } from './seat-ledger'
import type { Cents, ScheduledClass } from './types'
import {
  changeRefundRequest, claimRequestEmail, hashOf, isWaiting, listRefundRequests, markRequestDone, markRequestSent,
  doneAsks, releaseRequestEmail, resendRefundRequest, sameAsk, saveRefundRequest, type SavedRefundRequest,
} from './refund-requests'

export type RefundKind = 'booking' | 'person' | 'session' | 'custom'
export const REFUND_KINDS: RefundKind[] = ['booking', 'person', 'session', 'custom']

/** Square allows this many refunds on one payment. */
export const SQUARE_REFUND_CAP = 20
/** Square's limit on a refund's reason. */
const SQUARE_REASON_MAX = 192

export const NOT_PAID_HERE = 'Refund this one in Square, where it was paid.'
export const SQUARE_NO_ANSWER = "Square didn't confirm the refund. Try again. It won't refund twice."
export const SQUARE_TURNED_DOWN = "Square turned the refund down, so nothing was refunded. Try again."
export const ALREADY_FREE = 'That seat is already free.'

export const NOT_WAITING = "That refund isn't waiting on Square any more."
export const STILL_WAITING_ON_SQUARE = 'A refund on this booking is still waiting on Square. Check it in Square first.'
export const AGAIN_IS_STALE = 'Someone already refunded this again. Check the list.'
export const AGAIN_NEEDS_THE_SCREEN = 'To repeat a refund, use "Refund again" on the refund screen.'
export const REFUND_JUST_MADE = 'Another refund was just made on this booking. Look at the booking again before refunding more.'
export const SAVED_SPLIT_NO_LONGER_FITS =
  "That refund no longer fits what's left on this booking, so nothing was sent to Square. Look at what's left and refund again."

export class RefundError extends Error {
  /** `extra` goes into the reply next to the error (e.g. the refund still waiting on Square) */
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message)
  }
}

export interface RefundRequest {
  classId: string
  bookingId: string
  kind: RefundKind
  /** person / session / custom: which seats; custom without them = every seat on the booking. */
  lineIds?: string[]
  /** custom only: the total to give back, spread over the seats in seat order. */
  cents?: Cents
  /** omitted → custom keeps the seat, everything else frees it */
  freeSeat?: boolean
  reason: string
  /** the screen's token for this ask, the same on every retry of it (a new one for a new refund) */
  attempt?: string
  /**
   * "Refund again" (R31): the owner saw that the same refund was already made
   * and wants another on purpose. `of` = the latest finished request with
   * these inputs, as the "Already refunded" reply named it (refused when it is
   * no longer the latest: a stale screen); `token` = made once when that reply
   * arrived and kept across every retry, so the repeat has one identity (its
   * request id comes from booking + of + token). Without it, a request with
   * the same inputs as an earlier finished one is answered "Already refunded".
   */
  again?: { of: string; token: string }
}

export interface RefundPlan {
  lines: { id: string; cents: Cents }[]
  totalCents: Cents
  paymentId: string
  freeSeat: boolean
  /** refunds already made on this booking (its payment), as counted for the idempotency key */
  prior: number
  /** times Square turned down this same request */
  failures: number
  /** the request's key before hashing, without the failure count */
  rawKey: string
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
/** What a line still has to give back. */
export const remainingOn = (l: LedgerLine): Cents => paidOn(l) - l.refunds.reduce((s, r) => s + r.cents, 0)

/** A "free their seat" entry: no money, nothing sent to Square. */
const isSeatOnly = (r: LedgerLine['refunds'][number]) => r.cents === 0 && r.squareRefundId === null

/**
 * A plain amount refund recorded from Square's webhook (square-events). It may
 * be one of OUR refunds whose save here failed after Square took it.
 */
const isSquarePlain = (r: LedgerLine['refunds'][number]) => r.by?.id === 'square' && !r.freedSeat && r.squareRefundId !== null

/**
 * Distinct refunds already made on a booking (one Square refund can sit on several lines). Seat-only frees don't count.
 * `forKey`: also leaves out plain refunds recorded from Square, so "do the same refund again" after a save that
 * failed keeps its idempotency key even when Square's webhook recorded that refund in between (Square then
 * hands back the same refund instead of making a second one).
 */
export function priorRefunds(lines: LedgerLine[], opts: { forKey?: boolean } = {}): number {
  const seen = new Set<string>()
  for (const l of lines) {
    for (const r of l.refunds) {
      if (isSeatOnly(r) || (opts.forKey && isSquarePlain(r))) continue
      seen.add(r.squareRefundId ?? `${l.id}:${r.at}`)
    }
  }
  return seen.size
}

/** Times Square turned down this exact request (by raw key) on this booking. */
const failuresOn = (lines: LedgerLine[], raw: string) => lines.reduce((m, l) => Math.max(m, l.refundFailures?.[raw] ?? 0), 0)

/**
 * What the booking as a whole can still give back: what Square charged
 * (when known) less everything refunded. Null = no charged total recorded.
 */
export function bookingCap(lines: LedgerLine[]): Cents | null {
  const charged = lines.find((l) => typeof l.square.chargedCents === 'number')?.square.chargedCents
  if (typeof charged !== 'number') return null
  return Math.max(0, charged - lines.reduce((s, l) => s + l.refunds.reduce((a, r) => a + r.cents, 0), 0))
}

/**
 * The Square idempotency key. Built from
 * `refund:${bookingId}:${sortedLineIds}:${totalCents}:${n}` (n = refunds already
 * made on the booking), so a retry is the same key and a deliberate second
 * identical refund is a new one. A refund Square turned down (FAILED or
 * REJECTED) bumps a failure count kept for that exact request (its raw key),
 * so only a retry of that request is new; no answer keeps the same key, and
 * other requests on the booking are untouched. Square caps keys at 45
 * characters, so the string is hashed.
 */
export function refundKeyRaw(bookingId: string, lineIds: string[], totalCents: Cents, n: number): string {
  return `refund:${bookingId}:${[...lineIds].sort().join(',')}:${totalCents}:${n}`
}
export function refundKey(bookingId: string, lineIds: string[], totalCents: Cents, n: number, failures = 0): string {
  const raw = `${refundKeyRaw(bookingId, lineIds, totalCents, n)}${failures ? `:f${failures}` : ''}`
  return `refund:${createHash('sha256').update(raw).digest('hex').slice(0, 38)}`
}

/** What one session of a multi-session seat is worth: seat price ÷ sessions (rounded down) plus that share's tax. Add-ons are not prorated. */
export function sessionShare(l: LedgerLine): Cents {
  const share = Math.floor(l.priceCents / l.sessionIds.length)
  const tax = l.priceCents > 0 ? Math.round((share * l.taxCents) / l.priceCents) : 0
  return share + tax
}

/** Works out who gets what, refusing anything that can't be done. Pure: reads the ledger only. */
export function planRefund(ledger: Ledger, req: RefundRequest): RefundPlan {
  const booking = ledger.lines.filter((l) => l.bookingId === req.bookingId).sort((a, b) => a.seat - b.seat)
  const paid = booking.filter((l) => l.state === 'confirmed' || l.state === 'refunded')
  if (!paid.length) throw new RefundError(404, 'That booking is not on this class.')

  let chosen: LedgerLine[]
  if (req.kind === 'booking' || (req.kind === 'custom' && !req.lineIds?.length)) {
    chosen = paid
  } else {
    const ids = [...new Set(req.lineIds ?? [])]
    if (!ids.length) throw new RefundError(400, 'Pick who to refund.')
    if (req.kind === 'person' && ids.length !== 1) throw new RefundError(400, 'Pick one person to refund.')
    chosen = ids.map((id) => {
      const l = paid.find((x) => x.id === id)
      if (!l) throw new RefundError(404, 'That seat is not on this booking.')
      return l
    }).sort((a, b) => a.seat - b.seat)
  }

  const paymentId = chosen[0].square.paymentId
  if (!paymentId || chosen.some((l) => l.square.paymentId !== paymentId)) throw new RefundError(400, NOT_PAID_HERE)

  const prior = priorRefunds(booking, { forKey: true })
  if (priorRefunds(booking) >= SQUARE_REFUND_CAP) {
    throw new RefundError(409, `This payment has had ${SQUARE_REFUND_CAP} refunds, the most Square allows on one payment.`)
  }

  // One-session refunds keep the seat by default: one line covers the whole pass, so freeing it frees every session.
  const freeSeat = typeof req.freeSeat === 'boolean' ? req.freeSeat : req.kind === 'booking' || req.kind === 'person'
  const cap = bookingCap(booking)
  /** Full remaining per line, cut down in seat order to what the booking was charged. */
  const capped = (ls: LedgerLine[]) => {
    let room = cap ?? Infinity
    return ls.map((l) => {
      const cents = Math.min(remainingOn(l), room)
      room -= cents
      return { id: l.id, cents }
    })
  }
  let lines: { id: string; cents: Cents }[]
  const freedAlready = (id: string) => booking.find((l) => l.id === id)!.refunds.some((r) => r.freedSeat)
  if (req.kind === 'booking') {
    // Seats with nothing left to give back (or trimmed to 0 by the cap) are still freed when freeing.
    lines = capped(chosen).filter((x) => x.cents > 0 || (freeSeat && !freedAlready(x.id)))
  } else if (req.kind === 'person') {
    lines = capped(chosen)
  } else if (req.kind === 'session') {
    lines = chosen.map((l) => {
      if (l.sessionIds.length < 2) throw new RefundError(400, 'That seat is for one session. Refund the whole seat instead.')
      const cents = sessionShare(l)
      if (cents > remainingOn(l)) throw new RefundError(400, 'That is more than is left to refund on that seat.')
      return { id: l.id, cents }
    })
  } else {
    const want = req.cents
    if (typeof want !== 'number' || !Number.isInteger(want) || want <= 0) throw new RefundError(400, 'Enter an amount to refund.')
    const left = Math.min(chosen.reduce((s, l) => s + remainingOn(l), 0), cap ?? Infinity)
    if (want > left) throw new RefundError(400, 'That is more than is left to refund on this booking.')
    let rest = want
    lines = []
    for (const l of chosen) {
      const cents = Math.min(rest, remainingOn(l))
      rest -= cents
      // A seat being freed is recorded even when none of the money lands on it.
      if (cents > 0 || (freeSeat && !freedAlready(l.id))) lines.push({ id: l.id, cents })
    }
  }

  const totalCents = lines.reduce((s, x) => s + x.cents, 0)
  if (totalCents <= 0) throw new RefundError(400, 'Nothing is left to refund on this booking.')
  if (cap !== null && totalCents > cap) throw new RefundError(400, 'That is more than is left to refund on this booking.')
  const rawKey = refundKeyRaw(req.bookingId, lines.map((x) => x.id), totalCents, prior)
  return { lines, totalCents, paymentId, freeSeat, prior, failures: failuresOn(booking, rawKey), rawKey }
}

/** Stage 4 (waitlist) hooks in here. Called after a refund frees seats. */
export async function onSeatFreed(_classId: string, _sessionIds: string[]): Promise<void> {}

export interface RefundResult {
  refundId: string
  cents: Cents
  freeSeat: boolean
  lines: LedgerLine[]
  emailed: boolean
  /**
   * Set when this ask matched a refund already made (nothing was sent): the
   * screen shows `message` and offers "Refund again" of `latest`. `at` is null
   * for a request saved before finish times were kept. `count` = refunds made
   * with these same inputs.
   */
  already?: {
    at: string | null; by: By; checkedBy?: By; message: string; count: number
    latest: { requestId: string; at: string | null; by: By; cents: Cents }
  }
}

/** The request's inputs, without the attempt token: the same ask twice hashes the same. */
function inputHashOf(classId: string, req: RefundRequest): string {
  const lineIds = [...new Set(req.lineIds ?? [])].sort()
  return hashOf('refund-request', classId, req.bookingId, req.kind, lineIds, req.cents ?? null, req.freeSeat ?? null)
}

/** True when the saved split still fits what each of its seats (and the booking) has left. */
function stillFits(ledger: Ledger, rec: SavedRefundRequest): boolean {
  const booking = ledger.lines.filter((l) => l.bookingId === rec.bookingId)
  for (const x of rec.lines) {
    const l = booking.find((b) => b.id === x.id)
    if (!l || (l.state !== 'confirmed' && l.state !== 'refunded') || x.cents > remainingOn(l)) return false
  }
  const cap = bookingCap(booking)
  return cap === null || rec.totalCents <= cap
}

const fullName = (l: LedgerLine | undefined) => (l?.customer ? `${l.customer.givenName} ${l.customer.familyName}`.trim() : '')

/**
 * A saved request as the screens show it: who asked, when, how much, which
 * people (seats) and which class dates. Keys and hashes are left out.
 */
export function describeRequest(rec: SavedRefundRequest, ledger: Ledger, cls: Pick<ScheduledClass, 'sessions'>) {
  const lines = rec.lines.map((x) => ledger.lines.find((l) => l.id === x.id))
  const sessionIds = new Set(lines.flatMap((l) => l?.sessionIds ?? []))
  return {
    requestId: rec.id, status: rec.status, kind: rec.kind, cents: rec.totalCents, at: rec.createdAt, doneAt: rec.doneAt ?? null,
    by: rec.by, role: rec.role, reason: rec.reason, freeSeat: rec.freeSeat, squareRefundId: rec.squareRefundId,
    emailed: !!rec.emailedAt, ...(rec.cleared ? { cleared: rec.cleared } : {}),
    people: rec.lines.map((x, i) => ({ lineId: x.id, seat: lines[i]?.seat ?? null, name: fullName(lines[i]) || `Seat ${lines[i]?.seat ?? '?'}`, cents: x.cents })),
    dates: cls.sessions.filter((se) => sessionIds.has(se.id)).map((se) => se.startIso),
  }
}

/** A 409 naming the other refund (who, when, how much, which people and dates), so the owner can find it in Square. */
async function blockedBy(cls: ScheduledClass, other: SavedRefundRequest, message: string): Promise<RefundError> {
  const ledger = await getLedger(cls.id).catch((): Ledger => ({ classId: cls.id, lines: [] }))
  return new RefundError(409, message, { pending: describeRequest(other, ledger, cls) })
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

/**
 * Puts a saved request on the ledger (by the person who asked): asked seats
 * and spill-over in one change, keyed by the request id and the Square refund
 * id, so it is never written twice. Shared with Square's webhook and "It went through".
 */
async function writeToLedger(rec: SavedRefundRequest, squareRefundId: string | null): Promise<LedgerLine[]> {
  return recordRequestRefund(rec.classId, {
    requestId: rec.id, bookingId: rec.bookingId, lines: rec.lines, freeSeat: rec.freeSeat, reason: rec.reason, by: rec.by, squareRefundId,
  })
}

async function auditRefund(rec: SavedRefundRequest, label: string, squareRefundId: string, via?: string): Promise<void> {
  await recordAudit({
    by: { ...rec.by, role: rec.role },
    action: 'class-refund',
    target: { kind: 'class', id: rec.classId, label },
    details: {
      bookingId: rec.bookingId, kind: rec.kind, cents: rec.totalCents, lines: rec.lines.map((x) => x.id).join(','),
      freeSeat: rec.freeSeat, reason: rec.reason, squareRefundId, ...(via ? { via } : {}),
    },
  })
}

/**
 * The customer's refund email, at most once per request whoever finishes it
 * (our reply, Square's webhook, the nightly run, or "It went through").
 * Returns true when the customer has been emailed for this request.
 */
async function emailOnce(rec: SavedRefundRequest, lines: LedgerLine[], className: string): Promise<boolean> {
  const customer = lines.find((l) => l.customer?.email)?.customer
  if (!customer) return false
  if (!(await claimRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => false))) {
    const now = (await listRefundRequests(rec.classId, rec.bookingId).catch(() => [])).find((r) => r.id === rec.id)
    return !!now?.emailedAt
  }
  try {
    const sent = (await sendRefundEmail({
      to: customer.email, givenName: customer.givenName, className, cents: rec.totalCents, keptSeat: !rec.freeSeat,
    })).sent
    if (!sent) await releaseRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => undefined)
    return sent
  } catch (e) {
    // Name or code only: the message can carry the customer's address.
    const code = (e as { code?: unknown })?.code
    console.warn(`[classes/refund] email for ${rec.bookingId} failed: ${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}`)
    await releaseRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => undefined)
    return false
  }
}

/**
 * A request already on the ledger, asked for again: nothing is sent. A replay
 * of the same attempt token is answered as that refund (`already` false).
 * Otherwise (`already`) it is the same refund re-entered, or a "Refund again"
 * retried after Square finished it: the reply names the LATEST refund with
 * these inputs and how many there have been. Only the asker is marked as told.
 */
async function doneReply(cls: ScheduledClass, rec: SavedRefundRequest, actor: { by: By }, already: boolean): Promise<RefundResult> {
  if (actor.by.id === rec.by.id) await markRequestDone(cls.id, rec.bookingId, rec.id, rec.squareRefundId, { answered: true }).catch(() => false)
  const done = already ? doneAsks(await listRefundRequests(cls.id, rec.bookingId), rec.inputHash) : []
  const latest = done[0] ?? rec
  const lines = (await getLedger(cls.id)).lines.filter((l) => latest.lines.some((x) => x.id === l.id))
  const out: RefundResult = { refundId: latest.squareRefundId ?? '', cents: latest.totalCents, freeSeat: latest.freeSeat, lines, emailed: !!latest.emailedAt }
  if (!already) return out
  // Only a real finish time; never one that moves with later writes (an email claim, say).
  const at = latest.doneAt ?? latest.cleared?.at ?? null
  const count = Math.max(1, done.length)
  const when = at ? `on ${shortDate(at)} ` : ''
  const message = count === 1
    ? `Already refunded ${when}by ${latest.by.name}.`
    : `Refunded ${count === 2 ? 'twice' : `${count} times`} already, last ${when}by ${latest.by.name}.`
  return {
    ...out,
    already: {
      at, by: latest.by, ...(latest.cleared ? { checkedBy: latest.cleared.by } : {}), message, count,
      latest: { requestId: latest.id, at, by: latest.by, cents: latest.totalCents },
    },
  }
}

/** "It went through" was saved on the ledger but the request wasn't marked done (a failure in between). */
const checkedButUnfinished = (r: SavedRefundRequest) => r.status === 'sent' && !r.squareRefundId && r.cleared?.outcome === 'went-through'

/**
 * Refund a class booking (all or part). `actor` is who asked: an owner from
 * /admin or anyone from /staff.
 *
 * The request is saved (exact split + idempotency key) BEFORE Square is
 * called. A retry continues that saved request: it re-sends the same split and
 * key (Square hands back the same refund), or, when Square already took it,
 * only saves it here. It is never re-planned from the ledger, so "Try again"
 * can never refund twice. The same refund entered again later (a reload, a
 * new screen, days on) matches it by its inputs and is answered "Already
 * refunded"; only `again` makes a second one.
 */
export async function refundClassBooking(req: RefundRequest, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult> {
  const cls = req.classId ? await getClass(req.classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const now = new Date()
  const again = req.again ?? null
  const inputHash = inputHashOf(cls.id, req)
  // One identity per ask across its retries: a "Refund again" by (booking, what it repeats, its token); else the screen's token.
  const tokenId = again
    ? hashOf('refund-again', cls.id, req.bookingId, again.of, again.token)
    : req.attempt ? hashOf('refund-attempt', inputHash, req.attempt) : null
  const saved = await listRefundRequests(cls.id, req.bookingId)
  let rec: SavedRefundRequest | null = null

  // 1. This very ask (same token), whatever else is asked: continue it, or say it's done.
  const exact = tokenId ? saved.find((r) => r.id === tokenId) : undefined
  if (exact && exact.retired && again) throw new RefundError(409, SAVED_SPLIT_NO_LONGER_FITS)
  if (exact && !exact.retired) {
    if (exact.status === 'done') return doneReply(cls, exact, actor, !!again)
    rec = exact
  }
  // 2. The same inputs, unfinished: continue it (a retry from a reloaded screen).
  rec ??= saved.find((r) => sameAsk(r, inputHash) && r.status !== 'done') ?? null
  if (!rec) {
    // 3. The same inputs, finished: "Already refunded", unless this is a "Refund again" of exactly the latest one.
    const latest = doneAsks(saved, inputHash)[0]
    if (again) {
      if (!latest || latest.id !== again.of) throw new RefundError(409, AGAIN_IS_STALE)
    } else if (latest) {
      return doneReply(cls, latest, actor, true)
    }
  }

  if (!rec) {
    // A different refund while one has no answer from Square: refused until a person checks Square (R29).
    const waiting = saved.find(isWaiting)
    if (waiting) throw await blockedBy(cls, waiting, STILL_WAITING_ON_SQUARE)
    const plan = planRefund(await getLedger(cls.id), req)
    const at = now.toISOString()
    // A "Refund again" always uses its own id (a retired one was refused above); a plain ask whose token was retired gets a new one.
    const id = tokenId && (again || !saved.some((r) => r.id === tokenId)) ? tokenId : hashOf('refund-attempt', inputHash, randomUUID())
    // Checked again and saved in one step: two refunds at once can't both go to Square.
    const out = await saveRefundRequest({
      id, inputHash, classId: cls.id, bookingId: req.bookingId, paymentId: plan.paymentId, kind: req.kind, freeSeat: plan.freeSeat,
      reason: req.reason, by: actor.by, role: actor.role, lines: plan.lines, totalCents: plan.totalCents, prior: plan.prior,
      rawKey: plan.rawKey, failures: plan.failures,
      idempotencyKey: refundKey(req.bookingId, plan.lines.map((x) => x.id), plan.totalCents, plan.prior, plan.failures),
      status: 'pending', squareRefundId: null, answered: false, createdAt: at, updatedAt: at,
    }, { seen: saved.map((r) => r.id), againOf: again?.of ?? null })
    if (out.kind === 'waiting') throw await blockedBy(cls, out.rec, STILL_WAITING_ON_SQUARE)
    if (out.kind === 'changed') throw await blockedBy(cls, out.rec, REFUND_JUST_MADE)
    if (out.kind === 'stale') throw new RefundError(409, AGAIN_IS_STALE)
    // Our own id finished meanwhile (a double tap): a replay, or for "Refund again" the "Already refunded" answer.
    if (out.rec.status === 'done') return doneReply(cls, out.rec, actor, out.kind === 'same' || !!again)
    rec = out.rec
  }

  const checked = checkedButUnfinished(rec)
  let refundId: string | null = rec.status === 'sent' ? rec.squareRefundId : null
  if (!refundId && !checked) {
    if (rec.status === 'turned-down') {
      // A fresh try of a refused request, days later maybe: only while its split still fits what's left.
      if (!stillFits(await getLedger(cls.id), rec)) {
        await changeRefundRequest(cls.id, req.bookingId, rec.id, (r) => (r.status === 'turned-down' && !r.retired ? { ...r, retired: true } : null)).catch(() => undefined)
        throw new RefundError(409, SAVED_SPLIT_NO_LONGER_FITS)
      }
      // In flight again until Square answers; refused while a different refund waits on Square.
      const out = await resendRefundRequest(cls.id, req.bookingId, rec.id)
      if (out.kind === 'waiting') throw await blockedBy(cls, out.rec, STILL_WAITING_ON_SQUARE)
      rec = out.rec
    }
    let refund
    try {
      refund = await providers.payment.refundPayment({
        paymentId: rec.paymentId,
        amountCents: rec.totalCents,
        idempotencyKey: rec.idempotencyKey,
        ...(rec.reason ? { reason: rec.reason.slice(0, SQUARE_REASON_MAX) } : {}),
      })
    } catch (e) {
      // No clear answer (it may even have gone through): the saved request is sent again next time, same key.
      console.error(`[classes/refund] Square gave no answer for ${req.bookingId}: ${e instanceof Error ? e.message : e}`)
      throw new RefundError(502, SQUARE_NO_ANSWER)
    }
    if (/^(FAILED|REJECTED)$/i.test(refund.status)) {
      // Square said no, nothing was refunded: the next try of this request is a new one (a new key).
      console.error(`[classes/refund] Square ${refund.status} the refund on ${req.bookingId}`)
      await noteRefundFailed(cls.id, req.bookingId, rec.rawKey).catch(() => undefined)
      await changeRefundRequest(cls.id, req.bookingId, rec.id, (r) => r.status === 'done' || r.status === 'sent' ? null : {
        ...r, status: 'turned-down', failures: r.failures + 1,
        idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
      }).catch(() => undefined)
      throw new RefundError(502, SQUARE_TURNED_DOWN)
    }
    refundId = refund.id as string
    await markRequestSent(cls.id, req.bookingId, rec.id, refundId).catch(() => undefined)
  }

  let lines: LedgerLine[]
  try {
    lines = await writeToLedger(rec, refundId)
  } catch (e) {
    // The money went back; the saved request knows it, so trying again only saves it here.
    console.error(`[classes/refund] ${refundId} on ${req.bookingId} not recorded: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(500, "The refund went through in Square but didn't save here. Do the same refund again to save it.")
  }
  const first = await markRequestDone(cls.id, req.bookingId, rec.id, refundId, { answered: actor.by.id === rec.by.id }).catch(() => true)

  if (rec.freeSeat) {
    const sessionIds = [...new Set(lines.flatMap((l) => l.sessionIds))]
    await onSeatFreed(cls.id, sessionIds).catch(() => undefined)
  }

  const emailed = await emailOnce(rec, lines, cls.content.name)

  // Audited once: by whichever of us, Square's webhook and "It went through" saved it first.
  if (first) await auditRefund(rec, cls.content.name, refundId ?? '', checked ? 'checked-in-square' : undefined)

  return { refundId: refundId ?? '', cents: rec.totalCents, freeSeat: rec.freeSeat, lines, emailed }
}

/**
 * Square's webhook (or the nightly run) saw a COMPLETED refund on one of
 * these bookings' payment. If it is one of our saved requests (same Square
 * refund id; a request id the ledger already carries for it; or, unless
 * `exactOnly`, an unfinished request on that payment for exactly that
 * amount), it is saved here as that request, by the person who asked, and
 * true is returned: the caller records nothing of its own.
 *
 * Money first: the ledger write is keyed by the Square refund id (and the
 * request id), then the request is marked done. A replay after a failure in
 * between finds the money already written and only finishes the request.
 */
export async function claimSquareRefund(
  refund: { id: string; paymentId: string; cents: Cents },
  bookings: { classId: string; bookingId: string; label?: string }[],
  opts: { requestIds?: string[]; exactOnly?: boolean } = {},
): Promise<boolean> {
  let found: SavedRefundRequest | null = null
  let label = ''
  for (const b of bookings) {
    const saved = await listRefundRequests(b.classId, b.bookingId)
    const sameMoney = (r: SavedRefundRequest) => !r.squareRefundId && r.paymentId === refund.paymentId && r.totalCents === refund.cents
    const hit = saved.find((r) => r.squareRefundId === refund.id)
      ?? saved.find((r) => opts.requestIds?.includes(r.id))
      ?? (opts.exactOnly ? undefined : (
        saved.filter((r) => r.status === 'pending' && sameMoney(r)).sort((a, c) => a.createdAt.localeCompare(c.createdAt))[0]
        // a person said "It went through" before Square's refund reached us: it is that one
        ?? saved.filter((r) => (r.status === 'done' || r.status === 'sent') && r.cleared?.outcome === 'went-through' && sameMoney(r))[0]
      ))
    if (hit) { found = hit; label = b.label ?? ''; break }
  }
  if (!found) return false
  if (found.status === 'done') {
    // Already on the ledger ("It went through"): just remember Square's id for it.
    if (!found.squareRefundId) await changeRefundRequest(found.classId, found.bookingId, found.id, (r) => (r.squareRefundId ? null : { ...r, squareRefundId: refund.id }))
    return true
  }
  const lines = await writeToLedger(found, refund.id)
  if (await markRequestDone(found.classId, found.bookingId, found.id, refund.id)) {
    await auditRefund(found, label || found.classId, refund.id, 'square-webhook').catch(() => undefined)
  }
  if (found.freeSeat) await onSeatFreed(found.classId, [...new Set(lines.flatMap((l) => l.sessionIds))]).catch(() => undefined)
  const className = label || (await getClass(found.classId))?.content.name || ''
  await emailOnce(found, lines, className)
  return true
}

export type ClearOutcome = 'went-through' | 'did-not-go-through'

/**
 * A person checked Square for a refund that never got an answer (R29).
 * - 'went-through': saved on the ledger exactly as asked (by who asked),
 *   noted as checked by this person, customer emailed once. Money first
 *   (keyed by the request), then the request: if marking it done fails, the
 *   same check again finishes it and never writes the money twice.
 * - 'did-not-go-through': nothing saved; the request stops blocking new
 *   refunds. Asking the same refund again re-sends its key, so if it had in
 *   fact gone through Square hands that refund back instead of a second one.
 */
export async function clearRefundRequest(
  input: { classId: string; bookingId: string; requestId: string; outcome: ClearOutcome; reason: string },
  actor: { by: By; role: 'owner' | 'crew' },
): Promise<{ status: SavedRefundRequest['status']; lines: LedgerLine[] }> {
  if (input.outcome !== 'went-through' && input.outcome !== 'did-not-go-through') throw new RefundError(400, 'Pick whether it went through in Square.')
  const cls = input.classId ? await getClass(input.classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const rec = (await listRefundRequests(cls.id, input.bookingId)).find((r) => r.id === input.requestId)
  if (!rec) throw new RefundError(404, 'That refund is not on this booking.')

  let next: SavedRefundRequest | null
  if (input.outcome === 'went-through' && checkedButUnfinished(rec)) {
    // Its money is already on the ledger: finish it.
    next = rec
  } else {
    const cleared = { at: new Date().toISOString(), by: actor.by, role: actor.role, outcome: input.outcome, reason: input.reason }
    // Claim it first, so two people checking at once can't both save it.
    let claimed = false
    next = await changeRefundRequest(cls.id, input.bookingId, rec.id, (r) => {
      if (!isWaiting(r)) return null
      claimed = true
      return input.outcome === 'went-through' ? { ...r, status: 'sent', cleared } : { ...r, status: 'turned-down', cleared }
    })
    if (!claimed || !next) throw new RefundError(409, NOT_WAITING)
  }
  const cleared = next.cleared!

  const checked = () => recordAudit({
    by: { ...cleared.by, role: cleared.role },
    action: 'class-refund-checked',
    target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { bookingId: rec.bookingId, requestId: rec.id, outcome: input.outcome, reason: cleared.reason, cents: rec.totalCents },
  }).catch(() => undefined)

  if (input.outcome === 'did-not-go-through') {
    await checked()
    return { status: next.status, lines: [] }
  }
  let lines: LedgerLine[]
  try {
    lines = await writeToLedger(next, null)
  } catch (e) {
    // Nothing was written (one change, all or nothing): put it back as waiting so the check can be done again.
    if (!checkedButUnfinished(rec)) {
      await changeRefundRequest(cls.id, input.bookingId, rec.id, (r) => (checkedButUnfinished(r) ? { ...r, status: 'pending', cleared: undefined } : null)).catch(() => undefined)
    }
    console.error(`[classes/refund] checked refund on ${rec.bookingId} not saved: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(503, "The class records couldn't be reached. Try again.")
  }
  // Told the asker only when the asker is the one who checked.
  const first = await markRequestDone(cls.id, input.bookingId, rec.id, null, { answered: actor.by.id === next.by.id })
  if (first && next.freeSeat) await onSeatFreed(cls.id, [...new Set(lines.flatMap((l) => l.sessionIds))]).catch(() => undefined)
  await emailOnce(next, lines, cls.content.name)
  if (first) {
    await auditRefund(next, cls.content.name, '', 'checked-in-square').catch(() => undefined)
    await checked()
  }
  return { status: 'done', lines }
}

/**
 * "Free their seat" with no money: a refund entry of 0 cents with no Square
 * id, so the seat can be booked again. Never calls Square. No line ids = every
 * paid seat on the booking still holding a seat.
 */
export async function freeSeatOnly(
  classId: string, bookingId: string, lineIds: string[], actor: { by: By; role: 'owner' | 'crew' }, reason: string,
): Promise<{ lines: LedgerLine[] }> {
  const cls = classId ? await getClass(classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const ledger = await getLedger(cls.id)
  const paid = ledger.lines.filter((l) => l.bookingId === bookingId && (l.state === 'confirmed' || l.state === 'refunded'))
  if (!paid.length) throw new RefundError(404, 'That booking is not on this class.')
  const freed = (l: LedgerLine) => l.refunds.some((r) => r.freedSeat)
  let chosen: LedgerLine[]
  if (lineIds.length) {
    chosen = [...new Set(lineIds)].map((id) => {
      const l = paid.find((x) => x.id === id)
      if (!l) throw new RefundError(404, 'That seat is not on this booking.')
      if (freed(l)) throw new RefundError(409, ALREADY_FREE)
      return l
    })
  } else {
    chosen = paid.filter((l) => !freed(l))
    if (!chosen.length) throw new RefundError(409, ALREADY_FREE)
  }
  const ids = chosen.map((l) => l.id)
  const lines = await recordRefund(cls.id, ids, { cents: 0, reason, by: actor.by, freeSeat: true, squareRefundId: null })
  await onSeatFreed(cls.id, [...new Set(lines.flatMap((l) => l.sessionIds))]).catch(() => undefined)
  await recordAudit({
    by: { ...actor.by, role: actor.role },
    action: 'class-free-seat',
    target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { bookingId, lines: ids.join(','), reason },
  })
  return { lines }
}

/** The request body as sent by either screen. Prices never come from here: only line ids and, for custom, an amount. */
export function readRefundBody(body: any, opts: { reasonRequired: boolean }): RefundRequest {
  if (!body || typeof body !== 'object') throw new RefundError(400, 'Pick a booking to refund.')
  const kind = body.kind as RefundKind
  if (!REFUND_KINDS.includes(kind)) throw new RefundError(400, 'Pick what to refund.')
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (opts.reasonRequired && reason.length < 3) throw new RefundError(400, 'Add a reason for the refund.')
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : ''
  if (!bookingId) throw new RefundError(404, 'That booking is not on this class.')
  const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(v)
  let again: RefundRequest['again'] | undefined
  if (body.again !== undefined && body.again !== null && body.again !== false) {
    if (typeof body.again !== 'object' || !okId(body.again.of) || !okId(body.again.token)) throw new RefundError(400, AGAIN_NEEDS_THE_SCREEN)
    again = { of: body.again.of, token: body.again.token }
  }
  return {
    classId: typeof body.classId === 'string' ? body.classId : '',
    bookingId,
    kind,
    ...(Array.isArray(body.lineIds) ? { lineIds: body.lineIds.filter((x: unknown): x is string => typeof x === 'string') } : {}),
    ...(body.cents !== undefined ? { cents: Number(body.cents) } : {}),
    ...(typeof body.freeSeat === 'boolean' ? { freeSeat: body.freeSeat } : {}),
    ...(typeof body.attempt === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(body.attempt) ? { attempt: body.attempt } : {}),
    ...(again ? { again } : {}),
    reason,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** GET ?classId=&bookingId= for /admin and /staff: the booking's saved refund requests, as describeRequest shows them. */
export async function refundRequestsReply(url: URL): Promise<Response> {
  try {
    const classId = url.searchParams.get('classId') ?? ''
    const bookingId = url.searchParams.get('bookingId') ?? ''
    const cls = classId ? await getClass(classId) : null
    if (!cls) return json(404, { error: 'That class does not exist.' })
    if (!bookingId) return json(404, { error: 'That booking is not on this class.' })
    const [saved, ledger] = await Promise.all([listRefundRequests(cls.id, bookingId), getLedger(cls.id)])
    return json(200, { data: { requests: saved.map((r) => describeRequest(r, ledger, cls)) } })
  } catch (e) {
    console.error(`[classes/refund] refund list: ${e instanceof Error ? e.message : String(e)}`)
    return json(503, { error: "The class records couldn't be reached. Try again." })
  }
}

/** Route handler body shared by /admin and /staff. */
export async function refundReply(request: Request, actor: { by: By; role: 'owner' | 'crew' }, opts: { reasonRequired: boolean }): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    if (body && typeof body === 'object' && body.action === 'free-seat') {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
      if (opts.reasonRequired && reason.length < 3) throw new RefundError(400, 'Add a reason for freeing the seat.')
      const lineIds = Array.isArray(body.lineIds) ? body.lineIds.filter((x: unknown): x is string => typeof x === 'string') : []
      const r = await freeSeatOnly(typeof body.classId === 'string' ? body.classId : '', typeof body.bookingId === 'string' ? body.bookingId : '', lineIds, actor, reason)
      return json(200, { data: r })
    }
    if (body && typeof body === 'object' && body.action === 'clear-request') {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
      if (opts.reasonRequired && reason.length < 3) throw new RefundError(400, 'Add what you saw in Square.')
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const r = await clearRefundRequest(
        { classId: str(body.classId), bookingId: str(body.bookingId), requestId: str(body.requestId), outcome: body.outcome as ClearOutcome, reason },
        actor,
      )
      return json(200, { data: r })
    }
    const req = readRefundBody(body, opts)
    const r = await refundClassBooking(req, actor)
    return json(200, { data: r })
  } catch (e) {
    if (e instanceof RefundError) return json(e.status, { error: e.message, ...(e.extra ?? {}) })
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[classes/refund] ${msg}`)
    return json(503, { error: "The class records couldn't be reached. Try again." })
  }
}
