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
import { createHash } from 'node:crypto'
import { providers } from '@config/providers'
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import type { By } from '@lib/staff-auth'
import { getClass } from './class-store'
import { getLedger, noteRefundFailed, recordRefund, type Ledger, type LedgerLine } from './seat-ledger'
import type { Cents } from './types'

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
}

export interface RefundPlan {
  lines: { id: string; cents: Cents }[]
  totalCents: Cents
  paymentId: string
  freeSeat: boolean
  /** refunds already made on this booking (its payment) */
  prior: number
  /** refunds Square turned down on this booking */
  failures: number
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
/** What a line still has to give back. */
export const remainingOn = (l: LedgerLine): Cents => paidOn(l) - l.refunds.reduce((s, r) => s + r.cents, 0)

/** A "free their seat" entry: no money, nothing sent to Square. */
const isSeatOnly = (r: LedgerLine['refunds'][number]) => r.cents === 0 && r.squareRefundId === null

/** Distinct refunds already made on a booking (one Square refund can sit on several lines). Seat-only frees don't count. */
export function priorRefunds(lines: LedgerLine[]): number {
  const seen = new Set<string>()
  for (const l of lines) for (const r of l.refunds) if (!isSeatOnly(r)) seen.add(r.squareRefundId ?? `${l.id}:${r.at}`)
  return seen.size
}

/** Refunds Square turned down on this booking. */
const failuresOn = (lines: LedgerLine[]) => lines.reduce((m, l) => Math.max(m, l.refundFailures ?? 0), 0)

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
 * REJECTED) bumps a failure count that is added on, so the next try is a new
 * request; no answer at all keeps the same key. Square caps keys at 45
 * characters, so the string is hashed.
 */
export function refundKey(bookingId: string, lineIds: string[], totalCents: Cents, n: number, failures = 0): string {
  const raw = `refund:${bookingId}:${[...lineIds].sort().join(',')}:${totalCents}:${n}${failures ? `:f${failures}` : ''}`
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

  const prior = priorRefunds(booking)
  if (prior >= SQUARE_REFUND_CAP) {
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
  if (req.kind === 'booking') {
    lines = capped(chosen).filter((x) => x.cents > 0)
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
      if (cents > 0 || freeSeat) lines.push({ id: l.id, cents })
    }
  }

  const totalCents = lines.reduce((s, x) => s + x.cents, 0)
  if (totalCents <= 0) throw new RefundError(400, 'Nothing is left to refund on this booking.')
  if (cap !== null && totalCents > cap) throw new RefundError(400, 'That is more than is left to refund on this booking.')
  return { lines, totalCents, paymentId, freeSeat, prior, failures: failuresOn(booking) }
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

/** Refund a class booking (all or part). `actor` is who asked: an owner from /admin or anyone from /staff. */
export async function refundClassBooking(req: RefundRequest, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult> {
  const cls = req.classId ? await getClass(req.classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const ledger = await getLedger(cls.id)
  const plan = planRefund(ledger, req)
  const lineIds = plan.lines.map((x) => x.id)

  let refund
  try {
    refund = await providers.payment.refundPayment({
      paymentId: plan.paymentId,
      amountCents: plan.totalCents,
      idempotencyKey: refundKey(req.bookingId, lineIds, plan.totalCents, plan.prior, plan.failures),
      ...(req.reason ? { reason: req.reason.slice(0, SQUARE_REASON_MAX) } : {}),
    })
  } catch (e) {
    // No clear answer (it may even have gone through): the same request next time, so it can't refund twice.
    console.error(`[classes/refund] Square gave no answer for ${req.bookingId}: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(502, SQUARE_NO_ANSWER)
  }
  if (/^(FAILED|REJECTED)$/i.test(refund.status)) {
    // Square said no. Count it so the next try is a new request rather than a replay of this refusal.
    console.error(`[classes/refund] Square ${refund.status} the refund on ${req.bookingId}`)
    await noteRefundFailed(cls.id, req.bookingId).catch(() => undefined)
    throw new RefundError(502, SQUARE_TURNED_DOWN)
  }

  let lines: LedgerLine[]
  try {
    lines = await recordRefund(cls.id, lineIds, {
      cents: Object.fromEntries(plan.lines.map((x) => [x.id, x.cents])),
      reason: req.reason,
      by: actor.by,
      freeSeat: plan.freeSeat,
      squareRefundId: refund.id,
    })
  } catch (e) {
    // The money went back; asking again re-sends the same key, so Square won't refund twice and this gets written.
    console.error(`[classes/refund] ${refund.id} on ${req.bookingId} not recorded: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(500, "The refund went through in Square but didn't save here. Do the same refund again to save it.")
  }

  if (plan.freeSeat) {
    const sessionIds = [...new Set(lines.flatMap((l) => l.sessionIds))]
    await onSeatFreed(cls.id, sessionIds).catch(() => undefined)
  }

  let emailed = false
  const customer = lines.find((l) => l.customer?.email)?.customer
  if (customer) {
    try {
      emailed = (await sendRefundEmail({
        to: customer.email, givenName: customer.givenName, className: cls.content.name, cents: plan.totalCents, keptSeat: !plan.freeSeat,
      })).sent
    } catch (e) {
      // Name or code only: the message can carry the customer's address.
      const code = (e as { code?: unknown })?.code
      console.warn(`[classes/refund] email for ${req.bookingId} failed: ${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}`)
    }
  }

  await recordAudit({
    by: { ...actor.by, role: actor.role },
    action: 'class-refund',
    target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: {
      bookingId: req.bookingId, kind: req.kind, cents: plan.totalCents, lines: lineIds.join(','),
      freeSeat: plan.freeSeat, reason: req.reason, squareRefundId: refund.id,
    },
  })

  return { refundId: refund.id, cents: plan.totalCents, freeSeat: plan.freeSeat, lines, emailed }
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
