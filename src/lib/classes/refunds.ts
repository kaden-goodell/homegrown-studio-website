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
import { getLedger, noteRefundFailed, recordRefund, type Ledger, type LedgerLine } from './seat-ledger'
import type { Cents } from './types'
import {
  changeRefundRequest, createRefundRequest, hashOf, listRefundRequests, markRequestDone, markRequestSent,
  UNCONFIRMED_AFTER_MS, type SavedRefundRequest,
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

export class RefundError extends Error {
  constructor(public status: number, message: string) {
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
}

/** The request's inputs, without the attempt token: the same ask twice hashes the same. */
function inputHashOf(classId: string, req: RefundRequest): string {
  const lineIds = [...new Set(req.lineIds ?? [])].sort()
  return hashOf('refund-request', classId, req.bookingId, req.kind, lineIds, req.cents ?? null, req.freeSeat ?? null)
}

/**
 * The saved request this ask continues, if any. In order: the same attempt
 * token's request; else an unfinished request with the same inputs (a retry
 * after a reload); else a same-inputs request finished by Square's webhook in
 * the last 24 h that we never told the person about (they saw "Square didn't
 * confirm"). Anything else is a new request.
 */
function continuing(saved: SavedRefundRequest[], id: string | null, inputHash: string, now: number): SavedRefundRequest | null {
  if (id) {
    const exact = saved.find((r) => r.id === id)
    if (exact) return exact
  }
  const same = saved.filter((r) => r.inputHash === inputHash)
  return same.find((r) => r.status !== 'done')
    ?? same.find((r) => r.status === 'done' && !r.answered && now - Date.parse(r.createdAt) < UNCONFIRMED_AFTER_MS)
    ?? null
}

/**
 * The saved split, fitted to the ledger as it is now. Square has already
 * refunded the total, so all of it must be saved: a seat that has less left
 * than its share (a refund made in Square since) keeps what fits, and the rest
 * goes on the booking's other paid seats in seat order. Entries already
 * written for this same Square refund don't count against what's left.
 */
function fitSplit(ledger: Ledger, rec: SavedRefundRequest, squareRefundId: string): Record<string, Cents> {
  const booking = ledger.lines.filter((l) => l.bookingId === rec.bookingId && (l.state === 'confirmed' || l.state === 'refunded'))
    .sort((a, b) => a.seat - b.seat)
  const left = new Map(booking.map((l) => [l.id, paidOn(l) - l.refunds.filter((r) => r.squareRefundId !== squareRefundId).reduce((s, r) => s + r.cents, 0)]))
  const out: Record<string, Cents> = {}
  let spill = 0
  for (const x of rec.lines) {
    const c = Math.max(0, Math.min(x.cents, left.get(x.id) ?? 0))
    out[x.id] = c
    left.set(x.id, (left.get(x.id) ?? 0) - c)
    spill += x.cents - c
  }
  for (const l of booking) {
    if (spill <= 0) break
    const c = Math.min(spill, left.get(l.id) ?? 0)
    if (c <= 0) continue
    out[l.id] = (out[l.id] ?? 0) + c
    spill -= c
  }
  if (spill > 0) console.error(`[classes/refund] ${squareRefundId} is ${spill} cents more than ${rec.bookingId} has left; saved what fits`)
  return out
}

/** Puts a saved request on the ledger (by the person who asked). Shared with Square's webhook. */
async function writeToLedger(rec: SavedRefundRequest, squareRefundId: string): Promise<LedgerLine[]> {
  const cents = fitSplit(await getLedger(rec.classId), rec, squareRefundId)
  const asked = new Set(rec.lines.map((x) => x.id))
  // Seats asked about: as asked (a seat with nothing landing on it is still written when freeing).
  const mine = Object.keys(cents).filter((id) => asked.has(id) && (cents[id] > 0 || rec.freeSeat))
  // Seats that only took the spill-over keep their seat.
  const spill = Object.keys(cents).filter((id) => !asked.has(id) && cents[id] > 0)
  const write = (ids: string[], freeSeat: boolean) => recordRefund(rec.classId, ids, {
    cents: Object.fromEntries(ids.map((id) => [id, cents[id]])), reason: rec.reason, by: rec.by, freeSeat, squareRefundId,
  })
  const out = mine.length ? await write(mine, rec.freeSeat) : []
  if (spill.length) await write(spill, false)
  return out
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
 * Refund a class booking (all or part). `actor` is who asked: an owner from
 * /admin or anyone from /staff.
 *
 * The request is saved (exact split + idempotency key) BEFORE Square is
 * called. A retry continues that saved request: it re-sends the same split and
 * key (Square hands back the same refund), or, when Square already took it,
 * only saves it here. It is never re-planned from the ledger, so "Try again"
 * can never refund twice.
 */
export async function refundClassBooking(req: RefundRequest, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult> {
  const cls = req.classId ? await getClass(req.classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const now = new Date()
  const inputHash = inputHashOf(cls.id, req)
  const tokenId = req.attempt ? hashOf('refund-attempt', inputHash, req.attempt) : null
  let rec = continuing(await listRefundRequests(cls.id, req.bookingId), tokenId, inputHash, now.getTime())

  if (rec?.status === 'done') {
    // Already refunded and saved (by our earlier try or Square's webhook): say so, refund nothing more.
    await markRequestDone(cls.id, req.bookingId, rec.id, rec.squareRefundId ?? '', { answered: true })
    const lines = (await getLedger(cls.id)).lines.filter((l) => rec!.lines.some((x) => x.id === l.id))
    return { refundId: rec.squareRefundId ?? '', cents: rec.totalCents, freeSeat: rec.freeSeat, lines, emailed: false }
  }

  if (!rec) {
    const plan = planRefund(await getLedger(cls.id), req)
    const at = now.toISOString()
    rec = await createRefundRequest({
      id: tokenId ?? hashOf('refund-attempt', inputHash, randomUUID()),
      inputHash, classId: cls.id, bookingId: req.bookingId, paymentId: plan.paymentId, kind: req.kind, freeSeat: plan.freeSeat,
      reason: req.reason, by: actor.by, role: actor.role, lines: plan.lines, totalCents: plan.totalCents, prior: plan.prior,
      rawKey: plan.rawKey, failures: plan.failures,
      idempotencyKey: refundKey(req.bookingId, plan.lines.map((x) => x.id), plan.totalCents, plan.prior, plan.failures),
      status: 'pending', squareRefundId: null, answered: false, createdAt: at, updatedAt: at,
    })
  }

  let refundId = rec.status === 'sent' ? rec.squareRefundId : null
  if (!refundId) {
    if (rec.status === 'turned-down') {
      // A fresh try of a refused request: in flight again until Square answers.
      rec = (await changeRefundRequest(cls.id, req.bookingId, rec.id, (r) => (r.status === 'turned-down' ? { ...r, status: 'pending' } : null))) ?? rec
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
  const first = await markRequestDone(cls.id, req.bookingId, rec.id, refundId, { answered: true }).catch(() => true)

  if (rec.freeSeat) {
    const sessionIds = [...new Set(lines.flatMap((l) => l.sessionIds))]
    await onSeatFreed(cls.id, sessionIds).catch(() => undefined)
  }

  let emailed = false
  const customer = lines.find((l) => l.customer?.email)?.customer
  if (customer) {
    try {
      emailed = (await sendRefundEmail({
        to: customer.email, givenName: customer.givenName, className: cls.content.name, cents: rec.totalCents, keptSeat: !rec.freeSeat,
      })).sent
    } catch (e) {
      // Name or code only: the message can carry the customer's address.
      const code = (e as { code?: unknown })?.code
      console.warn(`[classes/refund] email for ${req.bookingId} failed: ${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}`)
    }
  }

  // Audited once: by whichever of us and Square's webhook saved it first.
  if (first) await auditRefund(rec, cls.content.name, refundId)

  return { refundId, cents: rec.totalCents, freeSeat: rec.freeSeat, lines, emailed }
}

/**
 * Square's webhook (or the nightly run) saw a COMPLETED refund on one of
 * these bookings' payment. If it is one of our saved requests (same Square
 * refund id, or an unfinished request on that payment for exactly that
 * amount), it is saved here as that request, by the person who asked, and
 * true is returned: the caller records nothing of its own.
 */
export async function claimSquareRefund(refund: { id: string; paymentId: string; cents: Cents }, bookings: { classId: string; bookingId: string; label?: string }[]): Promise<boolean> {
  let found: SavedRefundRequest | null = null
  let label = ''
  for (const b of bookings) {
    const saved = await listRefundRequests(b.classId, b.bookingId)
    const hit = saved.find((r) => r.squareRefundId === refund.id)
      ?? saved.filter((r) => r.status === 'pending' && !r.squareRefundId && r.paymentId === refund.paymentId && r.totalCents === refund.cents)
        .sort((a, c) => a.createdAt.localeCompare(c.createdAt))[0]
    if (hit) { found = hit; label = b.label ?? ''; break }
  }
  if (!found) return false
  if (found.status !== 'done') {
    await markRequestSent(found.classId, found.bookingId, found.id, refund.id)
    const lines = await writeToLedger(found, refund.id)
    if (await markRequestDone(found.classId, found.bookingId, found.id, refund.id)) {
      await auditRefund(found, label || found.classId, refund.id, 'square-webhook').catch(() => undefined)
    }
    if (found.freeSeat) await onSeatFreed(found.classId, [...new Set(lines.flatMap((l) => l.sessionIds))]).catch(() => undefined)
  }
  return true
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
  return {
    classId: typeof body.classId === 'string' ? body.classId : '',
    bookingId,
    kind,
    ...(Array.isArray(body.lineIds) ? { lineIds: body.lineIds.filter((x: unknown): x is string => typeof x === 'string') } : {}),
    ...(body.cents !== undefined ? { cents: Number(body.cents) } : {}),
    ...(typeof body.freeSeat === 'boolean' ? { freeSeat: body.freeSeat } : {}),
    ...(typeof body.attempt === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(body.attempt) ? { attempt: body.attempt } : {}),
    reason,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

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
    const req = readRefundBody(body, opts)
    const r = await refundClassBooking(req, actor)
    return json(200, { data: r })
  } catch (e) {
    if (e instanceof RefundError) return json(e.status, { error: e.message })
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[classes/refund] ${msg}`)
    return json(503, { error: "The class records couldn't be reached. Try again." })
  }
}
