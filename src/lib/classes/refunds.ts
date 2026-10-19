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
import { getLedger, recordRefund, type Ledger, type LedgerLine } from './seat-ledger'
import type { Cents } from './types'

export type RefundKind = 'booking' | 'person' | 'session' | 'custom'
export const REFUND_KINDS: RefundKind[] = ['booking', 'person', 'session', 'custom']

/** Square allows this many refunds on one payment. */
export const SQUARE_REFUND_CAP = 20
/** Square's limit on a refund's reason. */
const SQUARE_REASON_MAX = 192

export const NOT_PAID_HERE = 'Refund this one in Square, where it was paid.'

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
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
/** What a line still has to give back. */
export const remainingOn = (l: LedgerLine): Cents => paidOn(l) - l.refunds.reduce((s, r) => s + r.cents, 0)

/** Distinct refunds already made on a booking (one Square refund can sit on several lines). */
export function priorRefunds(lines: LedgerLine[]): number {
  const seen = new Set<string>()
  for (const l of lines) for (const r of l.refunds) seen.add(r.squareRefundId ?? `${l.id}:${r.at}`)
  return seen.size
}

/**
 * The Square idempotency key. Built from
 * `refund:${bookingId}:${sortedLineIds}:${totalCents}:${n}` (n = refunds already
 * made on the booking), so a retry is the same key and a deliberate second
 * identical refund is a new one. Square caps keys at 45 characters, so the
 * string is hashed.
 */
export function refundKey(bookingId: string, lineIds: string[], totalCents: Cents, n: number): string {
  const raw = `refund:${bookingId}:${[...lineIds].sort().join(',')}:${totalCents}:${n}`
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

  const freeSeat = typeof req.freeSeat === 'boolean' ? req.freeSeat : req.kind !== 'custom'
  let lines: { id: string; cents: Cents }[]
  if (req.kind === 'booking') {
    lines = chosen.map((l) => ({ id: l.id, cents: remainingOn(l) })).filter((x) => x.cents > 0)
  } else if (req.kind === 'person') {
    lines = [{ id: chosen[0].id, cents: remainingOn(chosen[0]) }]
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
    const left = chosen.reduce((s, l) => s + remainingOn(l), 0)
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
  return { lines, totalCents, paymentId, freeSeat, prior }
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
      idempotencyKey: refundKey(req.bookingId, lineIds, plan.totalCents, plan.prior),
      ...(req.reason ? { reason: req.reason.slice(0, SQUARE_REASON_MAX) } : {}),
    })
    if (/^(FAILED|REJECTED)$/i.test(refund.status)) throw new Error(`Refund ${refund.status}`)
  } catch (e) {
    console.error(`[classes/refund] Square refused ${req.bookingId}: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(502, "Square didn't take the refund, so nothing changed. Try again, or refund it in Square.")
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
      console.warn(`[classes/refund] email for ${req.bookingId} failed: ${e instanceof Error ? e.message : e}`)
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
    const req = readRefundBody(await request.json().catch(() => null), opts)
    const r = await refundClassBooking(req, actor)
    return json(200, { data: r })
  } catch (e) {
    if (e instanceof RefundError) return json(e.status, { error: e.message })
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[classes/refund] ${msg}`)
    return json(503, { error: "The class records couldn't be reached. Try again." })
  }
}
