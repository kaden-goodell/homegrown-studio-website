/**
 * Charge on the reader: start a sale, take Square's answer, ask Square, let
 * the seat go. Used by /api/staff/reader.json (the door), /admin › To decide
 * (Ask Square · Let the seat go) and Square's own notices (square-events), so
 * every way a payment can turn up ends in the same checks.
 *
 *   start    price the seats as a door sale (the current price: early-bird
 *            while it runs, D4), hold them as 'door-reader' for 30 minutes,
 *            save the sale, and hand back the Square app link
 *   return   the app's answer: an error lets the seat go (nothing was charged);
 *            an offline payment keeps the seat a day; a payment is checked
 *            against the order Square shows (our location, COMPLETED, exactly
 *            the held amount, card or gift card, made after the sale started,
 *            not already used for another booking) before the seat is paid
 *   check    asks Square for a finished order at our location whose payment
 *            note names this booking, and seats it the same way
 *   let go   checks Square first; refuses when Square shows it paid
 *
 * Paid is recorded once: the order is tied to the booking create-only, the
 * ledger confirm is idempotent by booking id, and a finished sale keeps its
 * answer for replays. Nothing here refunds or cancels anything.
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { alertOwners } from '@lib/owner-alert'
import { signingSecret } from '@lib/reuse-token'
import type { By, StaffMember } from '@lib/staff-auth'
import { formatDay, formatSlotLabel } from '@lib/studio-time'
import { getClass } from './class-store'
import { bookingIdFor, CLASS_TAX_PERCENT, seatsLabelFor, soldOutMessage } from './checkout'
import { claimConfirmation, releaseConfirmation, sendClassConfirmation } from './confirmation'
import { quote, type BookingRequest } from './pricing'
import {
  bookingInNote, checkReaderOrder, isSetupError, paidForSeat, parseReaderReturn, paymentIdsOf, posPaymentUrl, readerErrorMessage, readerNote, refusalMessage,
  signState, verifyState, MONEY_REFUSALS, READER_CLOCK_SLACK_MS, READER_DECIDE_AFTER_MS, READER_HOLD_MINUTES, READER_OFFLINE_HOLD_HOURS, READER_STATE_TTL_MS,
  type OrderRefusal,
} from './reader'
import {
  createReaderSale, getReaderSale, linkReaderOrder, updateReaderSale, type ReaderExtraPayment, type ReaderSale,
} from './reader-store'
import { readerClientId, readerStatus } from './reader-setting'
import { confirm, extendHold, getLedger, hold, release, type HoldInput, type LedgerLine } from './seat-ledger'
import { squareFetch, squareSettings } from './square-api'
import type { ScheduledClass } from './types'
import { getWaitlist } from './waitlist-store'
import { waitlistGoesFirst } from './waitlist-rules'

const logger = createLogger('classes:reader')
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`

/** What the door (or To decide) gets back: a plain sentence and what happened. */
export type ReaderOutcome = 'paid' | 'waiting' | 'cancelled' | 'let-go' | 'refused' | 'not-found' | 'unknown'
export interface ReaderAnswer {
  outcome: ReaderOutcome; message: string; bookingId: string; classId: string; amountCents: number
  /** refused: why the order Square showed isn't this sale's payment */
  why?: OrderRefusal | 'linked'
}

export class ReaderError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}

const PAID_MESSAGE = (s: Pick<ReaderSale, 'customer' | 'amountCents'>) =>
  `Paid ${dollars(s.amountCents)} on the reader. ${s.customer.givenName} is on the class list.`
const SQUARE_DOWN = 'Square couldn’t be reached to check the payment. The seat stays held. Tap Check again in a minute.'
const NOT_FOUND = 'Square doesn’t show this payment yet. The seat stays held. If they paid another way, let the seat go.'
/** Crew and owners: a payment that didn't match is never let go by itself (R1). */
export const MISMATCH_HELD = 'Square shows a payment for this sale that doesn’t match, so the seat stays held until Catherine or Kaden keep it or refund it in /admin › To decide.'
const OFFLINE = 'Square took the payment offline and finishes it when the iPad is back online. The seat stays held. Tap Check again later.'

const answerOf = (s: ReaderSale, outcome: ReaderOutcome, message: string, why?: OrderRefusal | 'linked'): ReaderAnswer =>
  ({ outcome, message, bookingId: s.bookingId, classId: s.classId, amountCents: s.amountCents, ...(why ? { why } : {}) })

const nameOfSale = (s: ReaderSale) => `${s.customer.givenName} ${s.customer.familyName}`.trim()

const holdInputOf = (s: ReaderSale, ttlMinutes = READER_HOLD_MINUTES): HoldInput => ({
  bookingId: s.bookingId, passId: s.request.passId, source: 'door-reader', customer: s.customer, ttlMinutes, by: { id: s.by.id, name: s.by.name },
  ...(s.request.seats ? { seats: s.request.seats } : {}),
  ...(s.overCapacity ? { allowOverCapacity: true } : {}),
})

const auditBy = (by: By & { role?: 'owner' | 'crew' }) => ({ id: by.id, name: by.name, role: by.role ?? ('crew' as const) })

// ---------------------------------------------------------------- start

export interface StartInput {
  cls: ScheduledClass
  request: BookingRequest
  customer: NonNullable<LedgerLine['customer']>
  member: StaffMember
  overCapacity: boolean
  sendEmail: boolean
  /** the sheet's token for this sale, the same on a retry */
  attempt: string
  /** this site, for the return address */
  origin: string
  now?: Date
}

export type StartResult =
  | { ok: true; bookingId: string; amountCents: number; posUrl: string; seatsLabel: string; replayed?: true }
  | { ok: false; status: number; error: string; code?: 'sold_out' | 'paid' | 'off' }

export async function startReaderSale(input: StartInput): Promise<StartResult> {
  const { cls, member } = input
  const now = input.now ?? new Date()
  const status = await readerStatus()
  if (!status.on) return { ok: false, status: 404, code: 'off', error: 'Charge on the reader is turned off. Use Pay on the iPad or Pay at the counter.' }
  const clientId = readerClientId()
  if (!clientId) return { ok: false, status: 409, code: 'off', error: status.message ?? 'Charge on the reader can’t be used yet.' }
  const bookingId = bookingIdFor(`reader:${cls.id}:${input.attempt}`)
  const linkFor = (s: ReaderSale) => posPaymentUrl({
    amountCents: s.amountCents,
    callbackUrl: `${input.origin}/staff/pos-return`,
    clientId,
    notes: readerNote(s.bookingId, s.className, formatDay(s.firstStartIso), `${s.customer.givenName} ${s.customer.familyName}`),
    state: signState(s.bookingId, signingSecret(), now),
  })

  // A retry of the same sheet (a lost reply, or the app never opened): the same sale, the same amount.
  const earlier = await getReaderSale(bookingId)
  if (earlier) {
    if (earlier.state === 'paid') return { ok: false, status: 409, code: 'paid', error: PAID_MESSAGE(earlier) }
    if (earlier.state === 'waiting') {
      const live = (await getLedger(cls.id)).lines.some((l) => l.bookingId === bookingId && l.state === 'held' && l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime())
      if (live) return { ok: true, bookingId, amountCents: earlier.amountCents, posUrl: linkFor(earlier), seatsLabel: earlier.seatsLabel, replayed: true }
    }
    return { ok: false, status: 409, error: 'That sale already ended. Close this and start again.' }
  }

  if (cls.status !== 'open' && cls.status !== 'closed') return { ok: false, status: 409, error: 'That class isn’t running.' }
  // D4: a door sale at the current price (the early-bird while it runs). No codes at the door (S4-R7).
  const priced = quote(cls, input.request, now, CLASS_TAX_PERCENT, { door: true })
  if (!priced.ok) return { ok: false, status: priced.field ? 400 : 409, error: priced.error }
  const q = priced.value
  if (q.totalCents === 0) return { ok: false, status: 409, error: 'This comes to $0, so there’s nothing to charge. Use Pay on the iPad to book it free.' }
  if (q.totalCents < 100) return { ok: false, status: 409, error: 'The reader takes $1.00 or more. Use Pay at the counter for this one.' }

  // Waitlist first, as for any door sale; "Add over capacity" still seats them.
  if (!input.overCapacity) {
    const short = waitlistGoesFirst(cls, await getLedger(cls.id), await getWaitlist(cls.id), q.sessionIds, q.seats, now)
    if (short) return { ok: false, status: 409, code: 'sold_out', error: 'That seat goes to someone on the waitlist first. Nothing was charged. Ask Catherine or Kaden if they should be seated anyway.' }
  }

  const seatLines = q.lines.filter((l) => l.kind === 'seat')
  const firstStartIso = cls.sessions.filter((s) => q.sessionIds.includes(s.id)).map((s) => s.startIso).sort()[0] ?? cls.sessions[0]?.startIso ?? now.toISOString()
  const sale: ReaderSale = {
    bookingId, classId: cls.id, className: cls.content.name, firstStartIso,
    seatsLabel: seatsLabelFor(cls, seatLines), seats: seatLines.length,
    amountCents: q.totalCents, startedAt: now.toISOString(), by: { id: member.id, name: member.name, role: member.role },
    customer: input.customer, request: input.request, overCapacity: input.overCapacity, sendEmail: input.sendEmail,
    quote: q, state: 'waiting',
  }
  const held = await hold(cls, q, holdInputOf(sale), now)
  if (!held.ok) return { ok: false, status: 409, code: 'sold_out', error: soldOutMessage(cls, held.sessionId, held.left) }
  try {
    if (!(await createReaderSale(sale))) throw new Error('sale already saved')
  } catch (e) {
    // Without the record a payment couldn't be checked: let the seat go and charge nothing.
    await release(cls.id, bookingId).catch(() => undefined)
    logger.error('Reader sale not saved — seat let go', { bookingId, error: e instanceof Error ? e.message : String(e) })
    return { ok: false, status: 503, error: 'Couldn’t start the sale. Nothing was charged. Try again.' }
  }
  await recordAudit({
    by: auditBy(sale.by), action: 'seat.reader-started', target: { kind: 'workshop', id: cls.id, label: cls.content.name },
    details: { bookingId, amountCents: q.totalCents, seats: sale.seats, name: `${sale.customer.givenName} ${sale.customer.familyName}`, sessions: q.sessionIds.join(',') },
  })
  return { ok: true, bookingId, amountCents: q.totalCents, posUrl: linkFor(sale), seatsLabel: sale.seatsLabel }
}

// ---------------------------------------------------------------- the app's answer

/** /staff/pos-return posted Square's `data`. Throws ReaderError for a forged, stale or unknown one (nothing changes). */
export async function takeReaderReturn(raw: unknown, origin: string, now = new Date()): Promise<ReaderAnswer> {
  const ret = parseReaderReturn(raw)
  if (!ret) throw new ReaderError(400, 'That didn’t come from the Square app. Nothing changed.')
  const state = verifyState(ret.state, signingSecret(), now)
  if (!state.ok) {
    logger.warn('Reader return refused', { why: state.why })
    if (state.why === 'expired') throw new ReaderError(410, 'This answer from the Square app is too old to use. Open the class and tap Check again.')
    throw new ReaderError(400, 'That didn’t come from the Square app. Nothing changed.')
  }
  const sale = await getReaderSale(state.bookingId)
  if (!sale) throw new ReaderError(404, 'That sale isn’t on file. Nothing changed.')
  // A finished sale answers the same every time (a reload, a double return).
  if (sale.state === 'paid') return answerOf(sale, 'paid', sale.answer?.message ?? PAID_MESSAGE(sale))

  if (ret.kind === 'error') {
    if (sale.state !== 'waiting') return answerOf(sale, sale.state, sale.answer?.message ?? readerErrorMessage(ret.code))
    const message = readerErrorMessage(ret.code)
    await release(sale.classId, sale.bookingId)
    const after = await updateReaderSale(sale.bookingId, (cur) => (cur.state !== 'waiting' ? null : {
      ...cur, state: 'cancelled', ended: { at: now.toISOString(), why: ret.code, by: null }, answer: { message, outcome: 'cancelled' },
    }))
    if (after?.state === 'paid') return answerOf(after, 'paid', after.answer?.message ?? PAID_MESSAGE(after))
    if (isSetupError(ret.code)) {
      await alertOwners(`Charge on the reader didn't work: the Square app turned the sale down (${ret.code}). ${sale.className}, ${dollars(sale.amountCents)}. Nothing was charged. If it keeps happening, turn Charge on the reader off in /admin › More › Register setup.`).catch(() => undefined)
    }
    await recordAudit({
      by: auditBy(sale.by), action: 'seat.reader-cancelled', target: { kind: 'workshop', id: sale.classId, label: sale.className },
      details: { bookingId: sale.bookingId, code: ret.code },
    })
    return answerOf(sale, 'cancelled', message)
  }

  if (ret.kind === 'offline') {
    const until = new Date(now.getTime() + READER_OFFLINE_HOLD_HOURS * 3_600_000).toISOString()
    await extendHold(sale.classId, sale.bookingId, until).catch((e) => logger.error('Offline reader hold not extended', { bookingId: sale.bookingId, error: String(e) }))
    await updateReaderSale(sale.bookingId, (cur) => (cur.state !== 'waiting' ? null : { ...cur, offline: { clientTransactionId: ret.clientTransactionId, at: now.toISOString() } }))
    return answerOf(sale, 'waiting', OFFLINE)
  }

  let order: any
  try {
    order = (await squareFetch(`/orders/${encodeURIComponent(ret.transactionId)}`, { method: 'GET' }))?.order
  } catch (e) {
    logger.error('Reader order not read from Square', { bookingId: sale.bookingId, orderId: ret.transactionId, error: e instanceof Error ? e.message : String(e) })
    return answerOf(sale, 'unknown', SQUARE_DOWN)
  }
  if (!order) return answerOf(sale, 'unknown', SQUARE_DOWN)
  return settleReaderOrder(sale, order, 'return', origin, now)
}

// ---------------------------------------------------------------- one order, checked and seated

/**
 * The one place a reader sale becomes paid. Refused orders change nothing but
 * a note on the sale (owners hear of it); a passing order is tied to the
 * booking once, then the seats are confirmed (rebuilt over capacity if the
 * hold ran out: the money is taken), then the confirmation goes once.
 */
export async function settleReaderOrder(sale: ReaderSale, order: any, how: 'return' | 'check' | 'square', origin: string, now = new Date()): Promise<ReaderAnswer> {
  const verdict = checkReaderOrder(order, { locationId: squareSettings().locationId || '', amountCents: sale.amountCents, bookingId: sale.bookingId, startedAt: sale.startedAt })
  if (!verdict.ok) return refuse(sale, verdict.why, String(order?.id ?? ''), now, order)
  if (sale.state === 'paid') {
    if (sale.paid?.orderId === verdict.orderId) return answerOf(sale, 'paid', sale.answer?.message ?? PAID_MESSAGE(sale))
    // R2: the card was run twice for one sale. The seat is paid once; the second payment waits in To decide.
    await noteExtraPayment(sale.bookingId, { orderId: verdict.orderId, paymentIds: verdict.paymentIds, cents: sale.amountCents, at: now.toISOString(), from: 'second' })
    return answerOf(sale, 'paid', sale.answer?.message ?? PAID_MESSAGE(sale))
  }
  const cls = await getClass(sale.classId)
  if (!cls) throw new ReaderError(404, 'That class isn’t on file any more. Nothing changed.')
  const seatLines = sale.quote.lines
  const link = await linkReaderOrder({
    orderId: verdict.orderId, bookingId: sale.bookingId, classId: sale.classId,
    netCents: seatLines.reduce((s, l) => s + l.cents, 0), taxCents: seatLines.reduce((s, l) => s + l.taxCents, 0), at: now.toISOString(),
  })
  if (link === 'other') return refuse(sale, 'linked', verdict.orderId, now, order)

  const r = await markReaderPaid(sale, cls, {
    orderId: verdict.orderId, paymentId: verdict.paymentId, paymentIds: verdict.paymentIds, tipCents: verdict.tipCents, chargedCents: sale.amountCents, how,
  }, origin, now)
  return answerOf(sale, 'paid', r.message)
}

export interface PaidWith {
  orderId: string; paymentId: string | null; paymentIds: string[]; tipCents: number
  /** what the seat records as charged (the held amount; or, when an owner kept a payment that didn't match, what Square shows) */
  chargedCents: number
  how: 'return' | 'check' | 'square' | 'kept'
  kept?: NonNullable<NonNullable<ReaderSale['paid']>['kept']>
}

/**
 * Seats a reader sale as paid with one order: the seats are confirmed (rebuilt
 * over capacity if the hold ran out: the money is taken), the sale is written
 * "paid" once (CAS), and only that call sends the confirmation, the audit and
 * the owners' texts. An order that didn't match earlier, still undecided,
 * becomes a second payment to answer in To decide (R2). A payment that came
 * after the seat was let go, or after its 30-minute hold ran out and the class
 * filled, is late (R3): owners are texted and it shows in To decide.
 */
export async function markReaderPaid(sale: ReaderSale, cls: ScheduledClass, paid: PaidWith, origin: string, now: Date): Promise<{ message: string; wrote: boolean; lines: LedgerLine[] }> {
  const lines = await confirm(sale.classId, sale.bookingId,
    { orderId: paid.orderId, paymentId: paid.paymentId, chargedCents: paid.chargedCents },
    { cls, quote: sale.quote, input: holdInputOf(sale) }, now)
  // R3: over capacity that nobody asked for = the hold ran out before the payment came in.
  const overNow = !sale.overCapacity && lines.some((l) => l.overCapacity)
  const message = PAID_MESSAGE(sale)
  // Only the call that writes "paid" sends the confirmation and the audit (a double return does neither twice).
  let wrote = false
  let late: ReaderSale['late'] | undefined
  let moved: ReaderExtraPayment | null = null
  const after = await updateReaderSale(sale.bookingId, (cur) => {
    wrote = false
    late = undefined
    moved = null
    if (cur.state === 'paid') return null
    wrote = true
    const afterLetGo = cur.state !== 'waiting'
    late = paid.how !== 'kept' && (afterLetGo || overNow) ? { at: now.toISOString(), overCapacity: overNow || lines.some((l) => l.overCapacity), afterLetGo } : undefined
    // An order that didn't match, still waiting for an owner, is a second payment now (it isn't what paid the seat).
    const p = cur.problem
    moved = p && MONEY_REFUSALS.has(p.why) && p.orderId !== paid.orderId && !(cur.extraPayments ?? []).some((x) => x.orderId === p.orderId)
      ? { orderId: p.orderId, paymentIds: p.paymentIds ?? [], cents: p.paidCents ?? 0, at: now.toISOString(), from: 'mismatch' }
      : null
    return {
      ...cur, state: 'paid',
      paid: {
        orderId: paid.orderId, paymentId: paid.paymentId, paymentIds: paid.paymentIds, tipCents: paid.tipCents, at: now.toISOString(), how: paid.how,
        ...(paid.how === 'kept' ? { paidCents: paid.chargedCents } : {}), ...(paid.kept ? { kept: paid.kept } : {}),
      },
      ...(late ? { late } : {}),
      ...(moved ? { extraPayments: [...(cur.extraPayments ?? []), moved] } : {}),
      answer: { message, outcome: 'paid' },
    }
  })
  if (!wrote) return { message: after?.answer?.message ?? message, wrote, lines }

  logger.info('Reader sale paid', { bookingId: sale.bookingId, orderId: paid.orderId, how: paid.how })
  const who = `${nameOfSale(sale)}, ${sale.className}, ${dollars(sale.amountCents)}`
  const lateNow = late as ReaderSale['late'] | undefined
  if (lateNow) {
    await alertOwners(lateNow.afterLetGo
      ? `A reader payment came in after its seat was let go: ${who}. They have their seat${lateNow.overCapacity ? ' (over capacity)' : ''}. Open /admin › To decide › Reader payment came in late to keep them or refund it.`
      : `A reader payment came in after its 30-minute hold ran out: ${who}. They have their seat (over capacity). Open /admin › To decide › Reader payment came in late to keep them or refund it.`).catch(() => undefined)
  }
  const movedNow = moved as ReaderExtraPayment | null
  if (movedNow) await alertExtra(sale, movedNow)
  await recordAudit({
    by: auditBy(sale.by), action: paid.how === 'kept' ? 'seat.reader-kept' : 'seat.sold-on-reader', target: { kind: 'workshop', id: sale.classId, label: sale.className },
    details: {
      bookingId: sale.bookingId, orderId: paid.orderId, paymentId: paid.paymentId ?? '', amountCents: sale.amountCents, how: paid.how,
      seats: sale.seats, email: sale.customer.email, name: nameOfSale(sale),
      ...(paid.tipCents ? { tipCents: paid.tipCents } : {}),
      ...(paid.kept ? { keptBy: paid.kept.by.name, chargedCents: paid.chargedCents, shortCents: paid.kept.shortCents, why: paid.kept.why } : {}),
      ...(lateNow ? { late: true, overCapacity: lateNow.overCapacity } : {}),
    },
  })
  if (sale.sendEmail) await sendOnce(sale, cls, lines, origin)
  return { message, wrote, lines }
}

/** R2: records another payment Square shows for a sale already paid (once per order) and texts the owners once. */
async function noteExtraPayment(bookingId: string, extra: ReaderExtraPayment): Promise<void> {
  let added = false
  const after = await updateReaderSale(bookingId, (cur) => {
    added = false
    if ((cur.extraPayments ?? []).some((x) => x.orderId === extra.orderId) || cur.paid?.orderId === extra.orderId) return null
    added = true
    return { ...cur, extraPayments: [...(cur.extraPayments ?? []), extra] }
  }).catch((e) => {
    logger.error('Second reader payment not recorded', { bookingId, orderId: extra.orderId, error: e instanceof Error ? e.message : String(e) })
    return null
  })
  if (added && after) await alertExtra(after, extra)
}

async function alertExtra(sale: ReaderSale, extra: ReaderExtraPayment): Promise<void> {
  const amount = extra.cents ? `, ${dollars(extra.cents)}` : ''
  await alertOwners(sale.state === 'paid'
    ? `A second reader payment came in for one sale: ${nameOfSale(sale)}, ${sale.className}${amount}. The seat was already paid. Open /admin › To decide › Second reader payment to refund it.`
    : `A reader payment that doesn't match came in after its seat was let go: ${nameOfSale(sale)}, ${sale.className}${amount}. Nobody has a seat for it. Open /admin › To decide › Reader payment with no seat to refund it.`).catch(() => undefined)
}

/** The confirmation, as for any door sale, at most once per booking. */
async function sendOnce(sale: ReaderSale, cls: ScheduledClass, lines: LedgerLine[], origin: string): Promise<void> {
  if (!(await claimConfirmation(sale.bookingId))) return
  const pickLines = lines.flatMap((l) => cls.content.questions.filter((q) => l.answers[q.id]).map((q) => `Seat ${l.seat} · ${q.label} ${l.answers[q.id]}`))
  const sent = await sendClassConfirmation({
    origin, bookingId: sale.bookingId, cls, sessionIds: sale.quote.sessionIds, seats: sale.seats, seatsLabel: sale.seatsLabel,
    email: sale.customer.email, givenName: sale.customer.givenName, receiptUrl: null, totalChargedCents: sale.amountCents,
    ...(pickLines.length ? { pickLines } : {}),
  }).catch((e) => {
    logger.error('Reader confirmation email failed (the seat is paid)', { bookingId: sale.bookingId, error: e instanceof Error ? e.message : String(e) })
    return false
  })
  if (!sent) await releaseConfirmation(sale.bookingId)
}

async function refuse(sale: ReaderSale, why: OrderRefusal | 'linked', orderId: string, now: Date, order: any): Promise<ReaderAnswer> {
  logger.error('Reader order refused', { bookingId: sale.bookingId, orderId, why, total: order?.total_money?.amount ?? null })
  const money = MONEY_REFUSALS.has(why)
  const { paidCents } = paidForSeat(order)
  // A paid sale is never unpaid by a stray order. One that names this sale is money taken for it: a second payment (R2).
  if (sale.state === 'paid') {
    const names = (order?.tenders ?? []).some((t: any) => bookingInNote(t?.note) === sale.bookingId)
    if (money && names && orderId && sale.paid?.orderId !== orderId) {
      await noteExtraPayment(sale.bookingId, { orderId, paymentIds: paymentIdsOf(order), cents: paidCents, at: now.toISOString(), from: 'second' })
    }
    return answerOf(sale, 'paid', sale.answer?.message ?? PAID_MESSAGE(sale))
  }
  // 'not-completed' fixes itself: nothing for an owner.
  if (why === 'not-completed') return answerOf(sale, sale.state === 'waiting' ? 'waiting' : sale.state, refusalMessage(why), why)
  // After the seat was let go (or the app said cancelled), money Square took for this sale waits in To decide as a payment to refund.
  if (sale.state !== 'waiting') {
    if (money && orderId) await noteExtraPayment(sale.bookingId, { orderId, paymentIds: paymentIdsOf(order), cents: paidCents, at: now.toISOString(), from: 'mismatch' })
    return answerOf(sale, 'refused', refusalMessage(why), why)
  }
  const before = sale.problem
  await updateReaderSale(sale.bookingId, (cur) => (cur.state === 'paid' ? null : {
    ...cur, problem: { why, orderId, at: now.toISOString(), paidCents, paymentIds: paymentIdsOf(order) },
  })).catch(() => undefined)
  // For an owner, once per order and reason.
  if (!(before?.orderId === orderId && before.why === why)) {
    const shown = typeof order?.total_money?.amount === 'number' ? ` Square shows ${dollars(order.total_money.amount)}.` : ''
    const what: Record<typeof why, string> = {
      amount: 'a different amount', tender: 'not paid by card or gift card', location: 'taken at another Square location',
      old: 'from before the sale started', late: 'finished more than a day after the sale started', split: 'split between a gift card and a card',
      linked: 'already used for another seat', 'not-ours': 'for a different sale',
    }
    const next = money ? 'Open /admin › To decide › Reader payment didn’t match to keep it or refund it.' : 'Open /admin › To decide to Ask Square or let the seat go.'
    await alertOwners(`Reader payment didn't match (${what[why]}): ${nameOfSale(sale)}, ${sale.className}, ${dollars(sale.amountCents)} expected.${shown} The seat is held, not marked paid. ${next}`).catch(() => undefined)
  }
  return answerOf(sale, 'refused', refusalMessage(why), why)
}

// ---------------------------------------------------------------- ask Square

/**
 * Asks Square for this sale's payment: a finished order at our location,
 * made since the sale started, whose payment note names the booking. Found →
 * checked and seated like any return. Never throws for Square being down.
 */
export async function checkReaderSale(bookingId: string, origin: string, now = new Date()): Promise<ReaderAnswer> {
  const sale = await getReaderSale(bookingId)
  if (!sale) throw new ReaderError(404, 'That sale isn’t on file.')
  if (sale.state === 'paid') return answerOf(sale, 'paid', sale.answer?.message ?? PAID_MESSAGE(sale))
  let orders: any[]
  try {
    orders = await findOrdersFor(sale, now)
  } catch (e) {
    logger.error('Reader check: Square search failed', { bookingId, error: e instanceof Error ? e.message : String(e) })
    return answerOf(sale, 'unknown', SQUARE_DOWN)
  }
  const mine = orders.filter((o) => (o.tenders ?? []).some((t: any) => bookingInNote(t?.note) === bookingId))
  if (!mine.length) {
    return answerOf(sale, sale.state === 'waiting' ? 'not-found' : sale.state, sale.state === 'waiting' ? NOT_FOUND : (sale.answer?.message ?? NOT_FOUND))
  }
  // More than one: the first that passes is the payment (owners hear of the rest from settle).
  let last: ReaderAnswer | null = null
  for (const o of mine) {
    const fresh = (await getReaderSale(bookingId)) ?? sale
    last = await settleReaderOrder(fresh, o, 'check', origin, now)
    if (last.outcome === 'paid') return last
  }
  return last!
}

async function findOrdersFor(sale: ReaderSale, now: Date): Promise<any[]> {
  const loc = squareSettings().locationId || ''
  const start = new Date(Date.parse(sale.startedAt) - READER_CLOCK_SLACK_MS).toISOString()
  const end = new Date(Math.min(now.getTime() + 60_000, Date.parse(sale.startedAt) + READER_STATE_TTL_MS)).toISOString()
  const out: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const res = await squareFetch('/orders/search', {
      method: 'POST',
      body: JSON.stringify({
        location_ids: [loc], limit: 100, ...(cursor ? { cursor } : {}),
        query: {
          filter: { state_filter: { states: ['COMPLETED'] }, date_time_filter: { created_at: { start_at: start, end_at: end } } },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
      }),
    })
    out.push(...(res?.orders ?? []))
    cursor = res?.cursor
    if (!cursor) break
  }
  return out
}

// ---------------------------------------------------------------- let the seat go

/**
 * The crew (or an owner) say the reader payment isn't coming. Square is asked
 * first: shown paid → the seat is theirs and nothing is let go; Square can't
 * be reached → nothing changes (try again). Otherwise the held seat is freed.
 */
export async function letReaderSeatGo(bookingId: string, by: By & { role?: 'owner' | 'crew' }, origin: string, now = new Date()): Promise<ReaderAnswer> {
  const sale = await getReaderSale(bookingId)
  if (!sale) throw new ReaderError(404, 'That sale isn’t on file.')
  if (sale.state === 'paid') throw new ReaderError(409, 'This seat is paid, so it stays. Refund it from the class if you need to.')
  if (sale.state !== 'waiting') return answerOf(sale, sale.state, sale.answer?.message ?? 'The seat was already let go.')
  // R1: Square took money for this sale that didn't match: an owner keeps it or refunds it (letting the seat go here would keep the money).
  if (sale.problem && MONEY_REFUSALS.has(sale.problem.why)) throw new ReaderError(409, MISMATCH_HELD, 'mismatch')
  const asked = await checkReaderSale(bookingId, origin, now)
  if (asked.outcome === 'paid') throw new ReaderError(409, `Square shows this paid, so the seat is theirs. ${asked.message}`, 'paid')
  if (asked.outcome === 'unknown') throw new ReaderError(503, 'Square couldn’t be reached to check first, so the seat stays held. Try again in a minute.')
  // An order that isn't this sale's money (another booking's, or a counter sale) doesn't keep the seat.
  if (asked.outcome === 'refused' && asked.why && MONEY_REFUSALS.has(asked.why)) throw new ReaderError(409, MISMATCH_HELD, 'mismatch')
  await release(sale.classId, bookingId)
  const message = 'The seat was let go. Nothing was charged.'
  const after = await updateReaderSale(bookingId, (cur) => (cur.state !== 'waiting' ? null : {
    ...cur, state: 'let-go', ended: { at: now.toISOString(), why: 'let go', by: { id: by.id, name: by.name } }, answer: { message, outcome: 'let-go' },
  }))
  if (after?.state === 'paid') throw new ReaderError(409, `Square shows this paid, so the seat is theirs. ${after.answer?.message ?? ''}`.trim(), 'paid')
  await recordAudit({
    by: auditBy(by), action: 'seat.reader-let-go', target: { kind: 'workshop', id: sale.classId, label: sale.className },
    details: { bookingId, amountCents: sale.amountCents, name: `${sale.customer.givenName} ${sale.customer.familyName}` },
  })
  return answerOf(sale, 'let-go', message)
}

// ---------------------------------------------------------------- Square's own notice

/**
 * An order from Square's webhook or the nightly reconcile with no class items:
 * when a tender's note names one of our reader sales, it is that sale's
 * payment (the return never came, or came first). true = it was a reader
 * order (handled or refused); false = not ours.
 */
export async function settleReaderOrderFromSquare(order: any, origin: string, now = new Date()): Promise<boolean> {
  const bookingId = (order?.tenders ?? []).map((t: any) => bookingInNote(t?.note)).find((x: string | null) => !!x)
  if (!bookingId) return false
  const sale = await getReaderSale(bookingId)
  if (!sale) return false
  if (order?.state !== 'COMPLETED') return true
  if (sale.state === 'paid' && sale.paid?.orderId === order.id) return true
  await settleReaderOrder(sale, order, 'square', origin, now)
  return true
}

// ---------------------------------------------------------------- for the roster and To decide

/** A sale waiting long enough (or with an order that didn't match) to be in /admin › To decide. */
export function readerNeedsDeciding(s: ReaderSale, now: Date): boolean {
  return s.state === 'waiting' && ((!!s.problem && s.problem.why !== 'not-completed') || now.getTime() - Date.parse(s.startedAt) >= READER_DECIDE_AFTER_MS)
}

/** When the seat's hold runs out (30 minutes; a day for a payment Square took offline). */
export function readerHoldEnds(s: ReaderSale): number {
  return s.offline ? Date.parse(s.offline.at) + READER_OFFLINE_HOLD_HOURS * 3_600_000 : Date.parse(s.startedAt) + READER_HOLD_MINUTES * 60_000
}

/** "Sat Nov 7 4:30 PM". */
export const readerWhen = (s: ReaderSale) => formatSlotLabel(s.firstStartIso)
