/**
 * Refunds on our own classes, from /admin (owners) and /staff (crew, with a
 * reason). Square moves the money; the seat ledger decides how much is left
 * to give back and whether the seat frees.
 *
 * Order of work: plan from the ledger (refuse anything wrong before any money
 * moves) → ONE Square refund for the total → record it on the ledger with the
 * Square refund id → email the customer (best effort) → audit. A Square error
 * writes nothing. Nothing here ever runs on its own; a person asks for it.
 *
 * The saved-request machinery (R29–R31, one email, one audit) is the shared
 * runner in booking-core/refund-runner; this file is the class side of it
 * (`classRefundBook`) plus the class rules: planning, keys, words.
 */
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import type { By } from '@lib/staff-auth'
import { getClass } from './class-store'
import { getLedger, noteRefundFailed, recordRefund, recordRequestRefund, type Ledger, type LedgerLine } from './seat-ledger'
import type { Cents, ScheduledClass } from './types'
import { hashOf, listRefundRequests, type SavedRefundRequest } from './refund-requests'
import {
  clearRequest, runRefund, type AlreadyRefunded, type RefundBook, type RefundResult as RunnerResult,
} from '@lib/booking-core/refund-runner'
import {
  AGAIN_NEEDS_THE_SCREEN, NOT_PAID_HERE, RefundError, refundCapMessage, refundKeyRaw, SQUARE_REFUND_CAP, type RefundPlan,
} from '@lib/booking-core/refund-words'

// The shared words live in booking-core/refund-words; re-exported so older imports keep working.
export {
  AGAIN_IS_STALE, AGAIN_NEEDS_THE_SCREEN, NOT_PAID_HERE, NOT_WAITING, REFUND_JUST_MADE, RefundError, refundKey, refundKeyRaw,
  SAVED_SPLIT_NO_LONGER_FITS, SQUARE_NO_ANSWER, SQUARE_REFUND_CAP, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE,
} from '@lib/booking-core/refund-words'
export type { RefundPlan } from '@lib/booking-core/refund-words'

export type RefundKind = 'booking' | 'person' | 'session' | 'custom'
export const REFUND_KINDS: RefundKind[] = ['booking', 'person', 'session', 'custom']

export const AT_THE_REGISTER = 'Refund this at the register, then free the seat.'
export const ALREADY_FREE = 'That seat is already free.'

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
  // m7: money taken at the register goes back at the register (it may have been cash).
  if (paid.some((l) => l.source === 'pos' || l.source === 'door-counter')) throw new RefundError(409, AT_THE_REGISTER)

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
    throw new RefundError(409, refundCapMessage())
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
  already?: AlreadyRefunded
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
 * The class side of the shared refund runner: plans from the seat ledger,
 * writes a finished request on it (asked seats and spill-over in one change,
 * keyed by the request id and the Square refund id, so never twice), frees
 * seats, emails the customer named on the seats, audits `class-refund`.
 * `cls` is read when not given (null when the class is gone: Square's refund
 * is still written to its ledger). `req` is the ask, for planning; a book
 * resolved from its scope alone (webhook, "I checked Square") has none.
 * `label` is a name the caller already has (the webhook's class list).
 */
export async function classRefundBook(
  classId: string, bookingId: string, opts: { cls?: ScheduledClass | null; req?: RefundRequest; label?: string } = {},
): Promise<RefundBook<LedgerLine[]>> {
  const cls = opts.cls !== undefined ? opts.cls : await getClass(classId).catch(() => null)
  const req = opts.req
  // The name the caller already had (the webhook's class list) comes first, as before the shared runner.
  const label = opts.label || (cls?.content.name ?? '')
  return {
    scope: { classId, bookingId },
    label,
    kind: req?.kind ?? '',
    logTag: 'classes/refund',
    unreachable: "The class records couldn't be reached. Try again.",
    inputHash: req ? inputHashOf(classId, req) : '',
    async plan() {
      if (!req) throw new RefundError(400, 'Pick what to refund.')
      return planRefund(await getLedger(classId), req)
    },
    stillFits: async (rec) => stillFits(await getLedger(classId), rec),
    noteFailed: (rawKey) => noteRefundFailed(classId, bookingId, rawKey).then(() => undefined),
    write: (rec, squareRefundId) => recordRequestRefund(rec.classId, {
      requestId: rec.id, bookingId: rec.bookingId, lines: rec.lines, freeSeat: rec.freeSeat, reason: rec.reason, by: rec.by, squareRefundId,
    }),
    async afterWrite(rec, lines) {
      if (rec.freeSeat) await onSeatFreed(classId, [...new Set(lines.flatMap((l) => l.sessionIds))])
    },
    current: async (rec) => (await getLedger(classId)).lines.filter((l) => rec.lines.some((x) => x.id === l.id)),
    async describe(rec) {
      const ledger = await getLedger(classId).catch((): Ledger => ({ classId, lines: [] }))
      return describeRequest(rec, ledger, cls ?? { sessions: [] })
    },
    canEmail: (_rec, lines) => !!lines.find((l) => l.customer?.email)?.customer,
    async email(rec, lines) {
      const customer = lines.find((l) => l.customer?.email)!.customer!
      return (await sendRefundEmail({
        to: customer.email, givenName: customer.givenName, className: label, cents: rec.totalCents, keptSeat: !rec.freeSeat,
      })).sent
    },
    audit: (rec, squareRefundId, how) => auditRefund(rec, label || rec.classId, squareRefundId, how),
    auditCheck: (rec, cleared) => recordAudit({
      by: { ...cleared.by, role: cleared.role },
      action: 'class-refund-checked',
      target: { kind: 'class', id: classId, label },
      details: { bookingId: rec.bookingId, requestId: rec.id, outcome: cleared.outcome, reason: cleared.reason, cents: rec.totalCents },
    }),
  }
}

const asClassResult = (r: RunnerResult<LedgerLine[]>): RefundResult => ({
  refundId: r.refundId, cents: r.cents, freeSeat: r.freeSeat, lines: r.written, emailed: r.emailed, ...(r.already ? { already: r.already } : {}),
})

/**
 * Refund a class booking (all or part). `actor` is who asked: an owner from
 * /admin or anyone from /staff. The shared runner does the work: the request
 * is saved (exact split + idempotency key) BEFORE Square is called, a retry
 * continues that saved request and never re-plans, so "Try again" can never
 * refund twice; the same refund entered again later is answered "Already
 * refunded"; only `again` makes a second one.
 */
export async function refundClassBooking(req: RefundRequest, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult> {
  const cls = req.classId ? await getClass(req.classId) : null
  if (!cls) throw new RefundError(404, 'That class does not exist.')
  const book = await classRefundBook(cls.id, req.bookingId, { cls, req })
  return asClassResult(await runRefund(book, { attempt: req.attempt, again: req.again, reason: req.reason }, actor))
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
  const book = await classRefundBook(cls.id, input.bookingId, { cls })
  const r = await clearRequest(book, input.requestId, input.outcome, input.reason, actor)
  return r ? { status: 'done', lines: r.written } : { status: 'turned-down', lines: [] }
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
