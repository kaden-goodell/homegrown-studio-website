/**
 * Refunds on our own parties, from /admin (owners) and /staff (crew, with a
 * reason, S2-R8). The refund unit is one charge (one Square payment, S2-R25):
 * an amount up to what that charge has left. Square moves the money; the
 * party record keeps every refund (`refunds`), never changing what was
 * bought, the status or the held time.
 *
 * The saved-request machinery (R29–R31, one email, one audit) is the shared
 * runner in booking-core/refund-runner; this file is the party side of it
 * (`partyRefundBook`), plus recording a refund made in Square itself
 * (`recordSquarePartyRefund`, R26). Saved requests use the scope
 * `{ classId: 'party', bookingId: <party id> }`.
 *
 * Parties booked in Square (legacy) are refunded in Square (S2-R9).
 * Nothing here runs on its own; a person asks for it.
 *
 * Server only.
 */
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import type { By } from '@lib/staff-auth'
import { getPartyRecord, isOurs, updatePartyRecord, type PartyRecord, type PartyRefund } from '@lib/party-store'
import { hashOf, listRefundRequests, type SavedRefundRequest } from '@lib/classes/refund-requests'
import {
  clearRequest, PARTY_SCOPE, runRefund, type AlreadyRefunded, type RefundBook, type RefundResult as RunnerResult,
} from '@lib/booking-core/refund-runner'
import {
  AGAIN_NEEDS_THE_SCREEN, NOT_PAID_HERE, RefundError, refundCapMessage, refundKeyRaw, SQUARE_REFUND_CAP, type RefundPlan,
} from '@lib/booking-core/refund-words'
import { refundableOn } from './money'
import type { Cents } from './types'

export const NO_SUCH_PARTY = 'That party does not exist.'
export const NO_SUCH_CHARGE = 'That payment is not on this party.'
export const MORE_THAN_LEFT = 'That is more than is left to refund on this payment.'
export const SIMULATED_CHARGE = 'That payment was a test booking with no real card, so there is nothing in Square to refund.'
const UNREACHABLE = "The party records couldn't be reached. Try again."

/** Who a refund made in Square itself is recorded as. */
const SQUARE: By = { id: 'square', name: 'Square' }

/** "the Justice party" (the host's last name), or "the party" with no name. */
export function partyLabel(r: Pick<PartyRecord, 'hostName'>): string {
  const last = (r.hostName ?? '').trim().split(/\s+/).filter(Boolean).pop()
  return last ? `the ${last} party` : 'the party'
}

export interface PartyRefundAsk {
  partyId: string
  chargeId: string
  cents: Cents
  reason: string
  /** the screen's token for this ask, the same on every retry of it */
  attempt?: string
  /** "Refund again" (R31): `of` = the latest finished request with these inputs; `token` kept across retries */
  again?: { of: string; token: string }
}

/** The ask's inputs, without the attempt token: the same refund entered twice hashes the same (R31). */
const inputHashOf = (a: Pick<PartyRefundAsk, 'partyId' | 'chargeId' | 'cents'>) => hashOf('party-refund', a.partyId, a.chargeId, a.cents)

/** Refunds on one Square payment: every kind counts toward Square's cap. */
const onPayment = (r: PartyRecord, paymentId: string) => (r.refunds ?? []).filter((f) => f.paymentId === paymentId)

/**
 * Works out the refund, refusing anything wrong before any money moves.
 * `saved` = the party's saved requests (for the failure count of this exact request).
 */
export function planPartyRefund(r: PartyRecord, ask: Pick<PartyRefundAsk, 'partyId' | 'chargeId' | 'cents'>, saved: SavedRefundRequest[]): RefundPlan {
  if (!isOurs(r)) throw new RefundError(409, NOT_PAID_HERE)
  const charge = (r.charges ?? []).find((c) => c.id === ask.chargeId)
  if (!charge) throw new RefundError(404, NO_SUCH_CHARGE)
  if (charge.simulated) throw new RefundError(409, SIMULATED_CHARGE)
  const cents = ask.cents
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) throw new RefundError(400, 'Enter an amount to refund.')
  const made = onPayment(r, charge.paymentId)
  if (made.length >= SQUARE_REFUND_CAP) throw new RefundError(409, refundCapMessage())
  if (cents > refundableOn(r, charge.id)) throw new RefundError(400, MORE_THAN_LEFT)
  // As for classes: refunds made in Square itself are left out of the key, so "do the same refund again"
  // after a save that failed keeps its key even when Square's webhook recorded one in between.
  const prior = made.filter((f) => f.role !== 'square').length
  const rawKey = refundKeyRaw(ask.partyId, [charge.id], cents, prior)
  // Times Square turned this exact request down (kept on the saved requests themselves).
  const failures = saved.filter((s) => s.rawKey === rawKey).reduce((m, s) => Math.max(m, s.failures), 0)
  return { lines: [{ id: charge.id, cents }], totalCents: cents, paymentId: charge.paymentId, freeSeat: false, prior, failures, rawKey }
}

/** A saved party request as the screens show it. Keys and hashes are left out. */
export function describePartyRequest(rec: SavedRefundRequest) {
  return {
    requestId: rec.id, status: rec.status, kind: rec.kind, chargeId: rec.lines[0]?.id ?? null, cents: rec.totalCents,
    at: rec.createdAt, doneAt: rec.doneAt ?? null, by: rec.by, role: rec.role, reason: rec.reason,
    squareRefundId: rec.squareRefundId, emailed: !!rec.emailedAt, ...(rec.cleared ? { cleared: rec.cleared } : {}),
  }
}

const historyLine = (cents: Cents, chargeId: string) => `Refunded ${formatMoney(cents)} on payment ${chargeId}`

/**
 * Writes a finished request on the party: one PartyRefund, keyed by the
 * request id and the Square refund id, so never twice. A refund Square's
 * webhook already recorded as made in Square (same Square id) becomes this
 * request's (who asked, why) without adding money. Never touches status,
 * items, the held time or a payment in flight.
 */
async function writeRequest(partyId: string, rec: SavedRefundRequest, squareRefundId: string | null): Promise<PartyRecord> {
  const chargeId = rec.lines[0]?.id ?? ''
  return updatePartyRecord(partyId, (r) => {
    const refunds = r.refunds ?? []
    const i = refunds.findIndex((f) => f.requestId === rec.id || (!!squareRefundId && f.squareRefundId === squareRefundId))
    if (i >= 0) {
      const have = refunds[i]
      const mine = have.requestId === rec.id
      if (mine && (have.squareRefundId || !squareRefundId)) return null
      const next = [...refunds]
      next[i] = mine
        ? { ...have, squareRefundId }
        : { ...have, requestId: rec.id, by: rec.by, role: rec.role, reason: rec.reason }
      return { ...r, refunds: next }
    }
    const entry: PartyRefund = {
      id: `prf_${rec.id.slice(0, 16)}`, chargeId, paymentId: rec.paymentId, cents: rec.totalCents, reason: rec.reason,
      by: rec.by, role: rec.role, squareRefundId, requestId: rec.id, at: new Date().toISOString(),
    }
    return { ...r, refunds: [...refunds, entry] }
  }, historyLine(rec.totalCents, chargeId), rec.by)
}

async function auditRefund(rec: SavedRefundRequest, label: string, squareRefundId: string, via?: string): Promise<void> {
  await recordAudit({
    by: { ...rec.by, role: rec.role },
    action: 'party-refund',
    target: { kind: 'party', id: rec.bookingId, label },
    details: {
      chargeId: rec.lines[0]?.id ?? '', paymentId: rec.paymentId, cents: rec.totalCents, reason: rec.reason,
      requestId: rec.id, squareRefundId, ...(via ? { via } : {}),
    },
  })
}

/**
 * The party side of the shared refund runner: plans from the party record,
 * writes a finished request on it (writeRequest), emails the host, audits
 * `party-refund` (and `party-refund-checked` for "I checked Square").
 * Null when there is no such party. `ask` is the refund asked, for planning;
 * a book resolved from its scope alone (webhook, "I checked Square") has
 * none and can't plan (it only writes requests already saved).
 */
export async function partyRefundBook(
  partyId: string, opts: { rec?: PartyRecord | null; ask?: PartyRefundAsk; label?: string } = {},
): Promise<RefundBook<PartyRecord> | null> {
  const first = opts.rec !== undefined ? opts.rec : await getPartyRecord(partyId)
  if (!first) return null
  const ask = opts.ask
  const label = partyLabel(first) !== 'the party' ? partyLabel(first) : (opts.label || 'the party')
  const read = async (): Promise<PartyRecord> => {
    const r = await getPartyRecord(partyId)
    if (!r) throw new RefundError(404, NO_SUCH_PARTY)
    return r
  }
  return {
    scope: { classId: PARTY_SCOPE, bookingId: partyId },
    label,
    kind: 'amount',
    logTag: 'parties/refund',
    unreachable: UNREACHABLE,
    inputHash: ask ? inputHashOf(ask) : '',
    async plan() {
      if (!ask) throw new RefundError(400, 'Pick what to refund.')
      const [r, saved] = await Promise.all([read(), listRefundRequests(PARTY_SCOPE, partyId)])
      return planPartyRefund(r, ask, saved)
    },
    async stillFits(rec) {
      const r = await read()
      // At Square's cap a resend would only be refused there: say so plainly instead.
      if (onPayment(r, rec.paymentId).length >= SQUARE_REFUND_CAP) throw new RefundError(409, refundCapMessage())
      return isOurs(r) && rec.totalCents <= refundableOn(r, rec.lines[0]?.id ?? '')
    },
    // The failure count lives on the saved request itself (the runner bumps it); planPartyRefund reads it there.
    noteFailed: async () => undefined,
    write: (rec, squareRefundId) => writeRequest(partyId, rec, squareRefundId),
    // Fills the Square id on this request's own entry (writeRequest never adds money for a request already written).
    noteSquareId: async (rec, squareRefundId) => { await writeRequest(partyId, rec, squareRefundId) },
    // Nothing is freed by a party refund: the time stays booked (cancel is its own action).
    afterWrite: async () => undefined,
    current: () => read(),
    describe: async (rec) => describePartyRequest(rec),
    canEmail: (_rec, r) => !!r.hostEmail,
    async email(rec, r) {
      return (await sendRefundEmail({
        // The host reads "your party on Saturday, November 14", never their own surname as a label.
        to: r.hostEmail, givenName: (r.hostName ?? '').trim().split(/\s+/)[0] ?? '', className: 'your party', cents: rec.totalCents,
        keptSeat: r.status !== 'cancelled', party: { startIso: r.startIso || null },
      })).sent
    },
    audit: (rec, squareRefundId, how) => auditRefund(rec, label, squareRefundId, how),
    auditCheck: (rec, cleared) => recordAudit({
      by: { ...cleared.by, role: cleared.role },
      action: 'party-refund-checked',
      target: { kind: 'party', id: partyId, label },
      details: { requestId: rec.id, chargeId: rec.lines[0]?.id ?? '', outcome: cleared.outcome, reason: cleared.reason, cents: rec.totalCents },
    }),
  }
}

/** What a party refund reply carries: the refund, every refund on the party and what each charge has left. */
export interface PartyRefundResult {
  refundId: string
  cents: Cents
  refund: PartyRefund | null
  refunds: PartyRefund[]
  refundable: Record<string, Cents>
  emailed: boolean
  already?: AlreadyRefunded
}

const leftPerCharge = (r: PartyRecord) => Object.fromEntries((r.charges ?? []).map((c) => [c.id, refundableOn(r, c.id)]))

function asPartyResult(x: RunnerResult<PartyRecord>, requestId: string | null): PartyRefundResult {
  const refunds = x.written.refunds ?? []
  const refund = refunds.find((f) => (requestId && f.requestId === requestId) || (!!x.refundId && f.squareRefundId === x.refundId)) ?? null
  return {
    refundId: x.refundId, cents: x.cents, refund, refunds, refundable: leftPerCharge(x.written), emailed: x.emailed,
    ...(x.already ? { already: x.already } : {}),
  }
}

/**
 * Refund one charge of a party (all or part). The shared runner does the
 * work: the request is saved before Square is called, a retry continues it
 * with the same key, the same refund entered again later is answered
 * "Already refunded", only `again` makes a second one.
 */
export async function refundParty(ask: PartyRefundAsk, actor: { by: By; role: 'owner' | 'crew' }): Promise<PartyRefundResult> {
  const rec = ask.partyId ? await getPartyRecord(ask.partyId) : null
  if (!rec) throw new RefundError(404, NO_SUCH_PARTY)
  if (!isOurs(rec)) throw new RefundError(409, NOT_PAID_HERE)
  const book = (await partyRefundBook(rec.bookingId, { rec, ask }))!
  const r = await runRefund(book, { attempt: ask.attempt, again: ask.again, reason: ask.reason }, actor)
  return asPartyResult(r, r.already?.latest.requestId ?? null)
}

export type PartyClearOutcome = 'went-through' | 'did-not-go-through'

/** "I checked Square" for a party refund that never got an answer (R29). See the runner's clearRequest. */
export async function clearPartyRefundRequest(
  input: { partyId: string; requestId: string; outcome: PartyClearOutcome; reason: string },
  actor: { by: By; role: 'owner' | 'crew' },
): Promise<{ status: SavedRefundRequest['status']; refunds: PartyRefund[]; refundable: Record<string, Cents> }> {
  if (input.outcome !== 'went-through' && input.outcome !== 'did-not-go-through') throw new RefundError(400, 'Pick whether it went through in Square.')
  const rec = input.partyId ? await getPartyRecord(input.partyId) : null
  if (!rec) throw new RefundError(404, NO_SUCH_PARTY)
  const book = (await partyRefundBook(rec.bookingId, { rec }))!
  const r = await clearRequest(book, input.requestId, input.outcome, input.reason, actor)
  const now = r?.written ?? (await getPartyRecord(rec.bookingId)) ?? rec
  return { status: r ? 'done' : 'turned-down', refunds: now.refunds ?? [], refundable: leftPerCharge(now) }
}

/**
 * A refund made in Square itself on one of our party payments, not one of
 * our saved requests (R26): recorded at once as money on that charge,
 * `role: 'square'`, idempotent by the Square refund id. No seat to decide,
 * so no flag (S2-R24). Returns the cents recorded now (0 on a replay).
 */
export async function recordSquarePartyRefund(
  partyId: string, chargeId: string, refund: { id: string; paymentId: string; cents: Cents },
): Promise<Cents> {
  let added = 0
  await updatePartyRecord(partyId, (r) => {
    if ((r.refunds ?? []).some((f) => f.squareRefundId === refund.id)) return null
    added = refund.cents
    const entry: PartyRefund = {
      id: `prf_sq_${refund.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`, chargeId, paymentId: refund.paymentId, cents: refund.cents,
      reason: 'Refunded in Square', by: SQUARE, role: 'square', squareRefundId: refund.id, requestId: null, at: new Date().toISOString(),
    }
    return { ...r, refunds: [...(r.refunds ?? []), entry] }
  }, `${historyLine(refund.cents, chargeId)} (in Square)`, SQUARE)
  return added
}

// ── Routes (/api/admin/parties/refund.json, /api/staff/party-refund.json) ────

const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(v)

/** The request body as sent by either screen. The amount is checked against the charge on the server. */
export function readPartyRefundBody(body: any, opts: { reasonRequired: boolean }): PartyRefundAsk {
  if (!body || typeof body !== 'object') throw new RefundError(400, 'Pick a party to refund.')
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (opts.reasonRequired && reason.length < 3) throw new RefundError(400, 'Add a reason for the refund.')
  const partyId = typeof body.partyId === 'string' ? body.partyId : ''
  if (!partyId) throw new RefundError(404, NO_SUCH_PARTY)
  const chargeId = typeof body.chargeId === 'string' ? body.chargeId : ''
  if (!chargeId) throw new RefundError(400, 'Pick which payment to refund.')
  let again: PartyRefundAsk['again'] | undefined
  if (body.again !== undefined && body.again !== null && body.again !== false) {
    if (typeof body.again !== 'object' || !okId(body.again.of) || !okId(body.again.token)) throw new RefundError(400, AGAIN_NEEDS_THE_SCREEN)
    again = { of: body.again.of, token: body.again.token }
  }
  return {
    partyId, chargeId, cents: Number(body.cents), reason,
    ...(okId(body.attempt) ? { attempt: body.attempt } : {}),
    ...(again ? { again } : {}),
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** GET ?partyId= for /admin and /staff: the party's saved refund requests. */
export async function partyRefundRequestsReply(url: URL): Promise<Response> {
  try {
    const partyId = url.searchParams.get('partyId') ?? ''
    const rec = partyId ? await getPartyRecord(partyId) : null
    if (!rec) return json(404, { error: NO_SUCH_PARTY })
    const saved = await listRefundRequests(PARTY_SCOPE, rec.bookingId)
    return json(200, { data: { requests: saved.map(describePartyRequest) } })
  } catch (e) {
    console.error(`[parties/refund] refund list: ${e instanceof Error ? e.message : String(e)}`)
    return json(503, { error: UNREACHABLE })
  }
}

/**
 * Route handler body shared by /admin (owners) and /staff (crew, reason
 * required). POST `{ partyId, chargeId, cents, reason, attempt, again? }`
 * refunds; POST `{ action: 'clear', partyId, requestId, outcome, reason }`
 * is "It went through / It didn't go through".
 */
export async function partyRefundReply(request: Request, actor: { by: By; role: 'owner' | 'crew' }, opts: { reasonRequired: boolean }): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    if (body && typeof body === 'object' && (body.action === 'clear' || body.action === 'clear-request')) {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
      if (opts.reasonRequired && reason.length < 3) throw new RefundError(400, 'Add what you saw in Square.')
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const r = await clearPartyRefundRequest(
        { partyId: str(body.partyId), requestId: str(body.requestId), outcome: body.outcome as PartyClearOutcome, reason }, actor,
      )
      return json(200, { data: r })
    }
    const ask = readPartyRefundBody(body, opts)
    return json(200, { data: await refundParty(ask, actor) })
  } catch (e) {
    if (e instanceof RefundError) return json(e.status, { error: e.message, ...(e.extra ?? {}) })
    console.error(`[parties/refund] ${e instanceof Error ? e.message : String(e)}`)
    return json(503, { error: UNREACHABLE })
  }
}
