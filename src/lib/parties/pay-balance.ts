/**
 * Pay the balance from a payment link: what a party of ours still owes (the
 * package and extras not yet paid, S2-R1), in one Square order and one charge.
 *
 *   1. the link's key       constant-time match on the party's payToken; a
 *                           wrong key answers exactly like a missing party
 *   2. booked, due > 0      cancelled → refused; nothing due → "already paid"
 *   3. one payment at once  `claimPaying` through a compare-and-set update;
 *                           another attempt in flight → refused before any order
 *   4. one Square order     exactly the items unpaid at that moment
 *                           (reference_id = party id); items added later stay due
 *   5. drift (R14), charge  Square's total is what is charged
 *   6. record it            those items get the charge, the charge is added,
 *                           the payment filed under the party, `paying` cleared
 *   7. the host's email, the owners' text
 *
 * Declined → `paying` cleared, nothing charged. No answer → `paying` kept
 * 24 hours (no second payment can start), owners told; a retry of the same
 * attempt, Square's payment event or a later attempt (which first asks Square
 * about this order) settles it. Money taken is always recorded; nothing here
 * refunds. The bookings gate does not apply (S2-R16).
 *
 * Server only.
 */
import { timingSafeEqual } from 'node:crypto'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { attemptKey, squareErrorCodes, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { TEXT_US, workshopMessages } from '@lib/checkout-messages'
import { chargeOrder, judgeDrift, paidOnOrder, tellOwnersOfDrift, UNCLEAR_HOLD_HOURS } from '@lib/booking-core/charge'
import { idFor } from '@lib/booking-core/ids'
import { alertOwners } from '@lib/owner-alert'
import { sendPartyPaidEmail } from '@lib/email'
import type { Payment } from '@providers/interfaces/payment'
import {
  getPartyRecord, isOurs, updatePartyRecord,
  type PartyCharge, type PartyPaying, type PartyRecord,
} from '@lib/party-store'
import { claimPaying, dueCents } from './money'
import { orderLineItems } from './pricing'
import { recordPartyPayment } from './party-payments'
import { getPartySettings } from './settings-store'
import { partyWritesRefusal } from './test-site'
import { giftCardRefusal } from './checkout'
import { partyWhenLabel } from './payment-link'

const logger = createLogger('parties:pay-balance')
const MINUTE = 60_000
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** How long one link payment holds the party's payment slot while it is charged. */
export const PAYING_MINUTES = 10
/** A link payment Square's payment event leaves alone while its own request may still be running. */
export const LINK_IN_FLIGHT_MS = 5 * MINUTE

// DRAFT copy (new, for Kaden).
export const LINK_NOT_FOUND_MESSAGE = `This payment link doesn’t work. Please ${TEXT_US} and we’ll send a new one.`
export const LINK_BUSY_MESSAGE = 'A payment for this party is already going through. Check back in a few minutes.'
export const LINK_CANCELLED_MESSAGE = 'This party was cancelled. Nothing was charged.'
export const LINK_PRICE_MISMATCH_MESSAGE = `Something’s off with the price, so nothing was charged. Please ${TEXT_US}.`
export const LINK_ORDER_FAILED_MESSAGE = 'We couldn’t start the payment. Nothing was charged. Please try again.'
export const LINK_AMOUNT_CHANGED_MESSAGE = 'The amount changed. Refresh to see what’s due. Nothing was charged.'

export type LinkPay =
  | { kind: 'card'; paymentToken: string; sourceKind?: 'card' | 'gift_card' }
  /** Payment bypass (local dev, namespaced previews): recorded as simulated, no Square. */
  | { kind: 'simulated' }

export interface PayInput {
  partyId: string
  key: string
  attemptId: string
  /** The amount the page showed (and the wallet sheet approved). Anything else is refused before any order. */
  expectedCents: number
  pay: LinkPay
  requestUrl: string
}

export type PayOutcome =
  | { kind: 'paid'; rec: PartyRecord; charge: PartyCharge | null; already: boolean; replay: boolean }
  | { kind: 'refused'; status: 400 | 402 | 404 | 409 | 410 | 503; code: CheckoutErrorCode | 'in_progress' | 'not_found' | 'cancelled' | 'amount_changed'; message: string; extra?: Record<string, unknown> }
  | { kind: 'unknown'; partyId: string }

const refuse = (
  status: 400 | 402 | 404 | 409 | 410 | 503, code: Extract<PayOutcome, { kind: 'refused' }>['code'], message: string, extra?: Record<string, unknown>,
): PayOutcome => ({ kind: 'refused', status, code, message, ...(extra ? { extra } : {}) })

/** Constant-time match of a link key against the party's payment key (never the host page key). */
export function payKeyMatches(rec: PartyRecord | null, key: unknown): boolean {
  if (!rec?.payToken || typeof key !== 'string' || !key) return false
  const a = Buffer.from(key)
  const b = Buffer.from(rec.payToken)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The party behind a link: null when there is no such party of ours or the
 * key is wrong (the two look the same to the caller). Throws when the store
 * can't be read.
 */
export async function partyForLink(partyId: string, key: unknown): Promise<PartyRecord | null> {
  if (typeof partyId !== 'string' || !partyId.startsWith('pty_')) return null
  const rec = await getPartyRecord(partyId)
  if (!rec || !isOurs(rec) || !payKeyMatches(rec, key)) return null
  return rec
}

/** The last charge on a party (for an "already paid" receipt). */
const lastCharge = (r: PartyRecord): PartyCharge | null => (r.charges?.length ? r.charges[r.charges.length - 1] : null)

/** Thrown inside the claim update to stop it with an answer. */
class Stop extends Error {
  constructor(public why: 'busy' | 'cancelled' | 'paid' | 'changed') { super(why) }
}

export async function payBalance(input: PayInput, now: Date = new Date()): Promise<PayOutcome> {
  const { partyId, attemptId } = input
  let rec: PartyRecord | null
  try {
    rec = await partyForLink(partyId, input.key)
  } catch (err) {
    logger.error('Party unreadable for a link payment — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', workshopMessages.unavailable)
  }
  if (!rec) return refuse(404, 'not_found', LINK_NOT_FOUND_MESSAGE)
  if (rec.status === 'cancelled') return refuse(410, 'cancelled', LINK_CANCELLED_MESSAGE)

  // This very attempt already paid: its answer again, never a second charge.
  const mine = rec.charges?.find((c) => c.attemptId === attemptId)
  if (mine) return { kind: 'paid', rec, charge: mine, already: false, replay: true }
  if (dueCents(rec) === 0) return { kind: 'paid', rec, charge: lastCharge(rec), already: true, replay: false }

  // Nothing is written on a test site that shares the live stores (R41).
  const testSite = partyWritesRefusal(new Request(input.requestUrl))
  if (testSite) return refuse(503, 'unavailable', testSite)

  // An earlier attempt that ran out with no answer: ask Square about its order before another can start.
  const before = rec.paying
  if (before?.order && before.attemptId !== attemptId && Date.parse(before.until) <= now.getTime()) {
    const settled = await settleEarlier(rec, before, now)
    if (settled === 'unknown') return refuse(409, 'in_progress', LINK_BUSY_MESSAGE)
    if (settled === 'paid') {
      try {
        rec = (await partyForLink(partyId, input.key)) ?? rec
      } catch { /* the stale copy only decides "already paid" */ }
      if (dueCents(rec) === 0) return { kind: 'paid', rec, charge: lastCharge(rec), already: true, replay: false }
    }
  }

  // The page showed another amount (an extra added or paid since it loaded): nothing starts.
  // (A retry of this very attempt is checked against its own order's quote inside the claim instead.)
  const retryingMine = rec.paying?.attemptId === attemptId && !!rec.paying.itemIds
  if (!retryingMine && dueCents(rec) !== input.expectedCents) return refuse(409, 'amount_changed', LINK_AMOUNT_CHANGED_MESSAGE)

  const card = input.pay.kind === 'card' ? input.pay : null
  if (card?.sourceKind === 'gift_card') {
    const refusal = await giftCardRefusal(card.paymentToken, dueCents(rec))
    if (refusal?.kind === 'refused') return refuse(refusal.status as 400 | 402 | 503, refusal.code, refusal.message, refusal.extra)
  }

  // The package's name for the order lines (a whole studio party's lines never need it).
  let pkgName = ''
  try {
    pkgName = (await getPartySettings()).packages.find((p) => p.id === rec!.packageId)?.name ?? ''
  } catch { /* the item's own label stands in */ }

  // ── One payment at a time ─────────────────────────────────────────────────
  const at = now.toISOString()
  let paying: PartyPaying
  try {
    const claimed = await updatePartyRecord(partyId, (r) => {
      if (r.status === 'cancelled') throw new Stop('cancelled')
      const c = claimPaying(r, attemptId, now, PAYING_MINUTES)
      if (!c.ok) throw new Stop('busy')
      const p = c.rec.paying!
      // A retry of this attempt keeps its order request and items (same key → the same Square order).
      if (p.itemIds) {
        if ((p.quotedCents ?? -1) !== input.expectedCents) throw new Stop('changed')
        return { ...c.rec, paying: { ...p, state: 'charging', at } }
      }
      const due = (r.items ?? []).filter((it) => it.chargeId === null)
      if (due.length === 0) throw new Stop('paid')
      const quotedCents = due.reduce((t, it) => t + it.cents, 0)
      // Checked here too, on the record as written: what is charged is exactly what the page showed.
      if (quotedCents !== input.expectedCents) throw new Stop('changed')
      return {
        ...c.rec,
        paying: {
          ...p, via: 'link', state: 'charging', at, itemIds: due.map((it) => it.id), quotedCents, orderId: null,
          ...(input.pay.kind === 'card'
            ? {
                order: {
                  idempotencyKey: attemptKey(attemptId, 'order'),
                  locationId: siteConfig.providers.booking.config.locationId,
                  customerId: null,
                  lineItems: orderLineItems(due, pkgName, r.packageId ?? ''),
                  referenceId: partyId,
                },
              }
            : {}),
        },
      }
    }, 'Payment started (link)', null)
    paying = claimed.paying!
  } catch (err) {
    if (err instanceof Stop) {
      if (err.why === 'busy') return refuse(409, 'in_progress', LINK_BUSY_MESSAGE)
      if (err.why === 'cancelled') return refuse(410, 'cancelled', LINK_CANCELLED_MESSAGE)
      if (err.why === 'changed') return refuse(409, 'amount_changed', LINK_AMOUNT_CHANGED_MESSAGE)
      return { kind: 'paid', rec, charge: lastCharge(rec), already: true, replay: false }
    }
    logger.error('Link payment could not start — refusing before any order', { partyId, error: String(err) })
    return refuse(503, 'unavailable', workshopMessages.unavailable)
  }
  const wasRetry = before?.attemptId === attemptId && !!before.itemIds
  const quotedCents = paying.quotedCents ?? 0

  /** Nothing was charged: the party's payment slot is free again. */
  const letGo = async (why: string) => {
    await updatePartyRecord(partyId, (r) => (r.paying?.attemptId === attemptId ? { ...r, paying: null } : null), `Payment not taken (link): ${why}`, null)
      .catch((err) => logger.error('Link payment slot not cleared (it runs out by itself)', { partyId, why, error: String(err) }))
  }

  // ── Simulated (local dev, namespaced previews): no Square ────────────────
  if (input.pay.kind === 'simulated') {
    logger.warn('Payment bypassed (simulated link payment)', { partyId })
    const out = await recordLinkCharge(partyId, paying, { orderId: `sim-${attemptId}`, paymentId: `sim-${attemptId}`, cents: quotedCents, receiptUrl: null, simulated: true }, now)
    if (out.rec) await tellLinkPaid(out.rec, out.charge)
    return paidAnswer(out, rec)
  }

  // ── One Square order ──────────────────────────────────────────────────────
  const req = paying.order!
  let order: { id: string; totalAmount: number }
  try {
    order = await providers.payment.createOrder(req)
  } catch (err) {
    if (squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) return unclear(null, err)
    logger.error('Link payment order failed — nothing charged', { partyId, error: err instanceof Error ? err.message : String(err) })
    await letGo('order failed')
    return refuse(503, 'unavailable', LINK_ORDER_FAILED_MESSAGE)
  }
  paying = { ...paying, orderId: order.id }
  await updatePartyRecord(partyId, (r) => (r.paying?.attemptId === attemptId ? { ...r, paying: { ...r.paying, orderId: order.id } } : null), 'Payment order made (link)', null)
    .catch((err) => logger.error('Link payment order id not saved', { partyId, error: String(err) }))

  // A retry of this attempt: did the first try already pay?
  if (wasRetry) {
    const found = await providers.payment.findOrderPayment(order.id).catch(() => null)
    if (found?.status === 'completed') return paid(found, true)
  }

  // ── Drift (R14), then charge ──────────────────────────────────────────────
  const verdict = judgeDrift(quotedCents, order.totalAmount)
  if (verdict.kind === 'refuse') {
    logger.error('Link payment order far above the quote — refusing', { partyId, orderId: order.id, quote: quotedCents, square: order.totalAmount })
    await letGo('price mismatch')
    await alertOwners(
      `Party payment link refused, price mismatch: party ${partyId}. Quote ${dollars(quotedCents)}, Square ${dollars(order.totalAmount)}. Nothing was charged.`,
    ).catch(() => undefined)
    return refuse(503, 'unavailable', LINK_PRICE_MISMATCH_MESSAGE)
  }
  if (verdict.kind === 'charge-and-tell') {
    await tellOwnersOfDrift('Party price differed', `party ${partyId} (payment link)`, quotedCents, order.totalAmount, '')
  }

  const result = await chargeOrder({ orderId: order.id, amountCents: order.totalAmount, paymentToken: card!.paymentToken, email: rec.hostEmail, attemptId })
  if (result.kind === 'declined') {
    logger.error('Link payment refused', { partyId, reason: result.reason, codes: result.codes, paymentId: result.paymentId })
    await letGo('card declined')
    return refuse(402, 'card_declined', workshopMessages.card_declined)
  }
  if (result.kind === 'unknown') return unclear(order, result.error)
  return paid(result.payment, !!result.recovered)

  // ── helpers (closures over this request) ──────────────────────────────────

  async function paid(payment: Payment, recovered: boolean): Promise<PayOutcome> {
    if (recovered) logger.info('Link payment answer was unclear but the order is paid — recording', { partyId, orderId: order.id })
    const out = await recordLinkCharge(partyId, paying, {
      orderId: order.id, paymentId: payment.id, cents: payment.amount || order.totalAmount, receiptUrl: payment.receiptUrl ?? null,
    }, now)
    if (out.rec) await tellLinkPaid(out.rec, out.charge)
    return paidAnswer(out, rec!)
  }

  /** The charge may have gone through: keep the payment slot 24 hours, tell the owners, say we're not sure. */
  async function unclear(o: { id: string; totalAmount: number } | null, err: unknown): Promise<PayOutcome> {
    logger.error('LINK PAYMENT OUTCOME UNKNOWN — needs a person', {
      partyId, orderId: o?.id ?? null, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err),
    })
    const until = new Date(now.getTime() + UNCLEAR_HOLD_HOURS * 60 * MINUTE).toISOString()
    await updatePartyRecord(
      partyId,
      (r) => (r.paying?.attemptId === attemptId ? { ...r, paying: { ...r.paying, state: 'unclear', until, ...(o ? { orderId: o.id } : {}) } } : null),
      'Payment unclear (link)', null,
    ).catch((e) => logger.error('Unclear link payment not noted', { partyId, error: String(e) }))
    await alertOwners(
      `Party payment link unclear: ${rec!.hostName}, party on ${partyWhenLabel(rec!.startIso)}. Check Square for a${o ? ` ${dollars(o.totalAmount)}` : ''} payment${o ? ` on order ${o.id}` : ''}. Party ${partyId}. No other payment can start on it for 24 hours.`,
    ).catch(() => undefined)
    return { kind: 'unknown', partyId }
  }
}

function paidAnswer(out: { rec: PartyRecord | null; charge: PartyCharge }, fallback: PartyRecord): PayOutcome {
  return { kind: 'paid', rec: out.rec ?? fallback, charge: out.charge, already: false, replay: false }
}

/**
 * A link payment Square took: those items get the charge, the charge is
 * added, `paying` is cleared, and the payment is filed under the party.
 * Idempotent (a payment already on the party adds nothing). Never fails for
 * money taken: a record that can't be written tells the owners and leaves
 * `paying` for Square's payment event to finish. `created`: this call added
 * the charge (only it tells the host and owners).
 */
export async function recordLinkCharge(
  partyId: string,
  paying: PartyPaying,
  pay: { orderId: string; paymentId: string; cents: number; receiptUrl: string | null; simulated?: boolean },
  now: Date = new Date(),
): Promise<{ rec: PartyRecord | null; charge: PartyCharge; created: boolean }> {
  const chargeId = idFor('chg', pay.paymentId)
  let charge: PartyCharge = {
    id: chargeId, via: 'link', orderId: pay.orderId, paymentId: pay.paymentId, cents: pay.cents, quotedCents: paying.quotedCents ?? pay.cents,
    itemIds: paying.itemIds ?? [], receiptUrl: pay.receiptUrl, at: now.toISOString(), by: null, attemptId: paying.attemptId,
    ...(pay.simulated ? { simulated: true as const } : {}),
  }
  let rec: PartyRecord | null = null
  let created = false
  let threw = false
  for (let i = 0; i < 2 && !rec; i++) {
    try {
      rec = await updatePartyRecord(partyId, (r) => {
        const freePaying = r.paying?.attemptId === paying.attemptId ? null : r.paying
        const existing = r.charges?.find((c) => c.paymentId === pay.paymentId)
        if (existing) {
          charge = existing
          created = false
          return freePaying === r.paying ? null : { ...r, paying: freePaying }
        }
        const ids = new Set(charge.itemIds)
        created = true
        return {
          ...r,
          items: (r.items ?? []).map((it) => (ids.has(it.id) && it.chargeId === null ? { ...it, chargeId } : it)),
          charges: [...(r.charges ?? []), charge],
          paying: freePaying,
        }
      }, `Paid ${dollars(pay.cents)} by payment link`, null)
    } catch (err) {
      threw = true
      logger.error(i === 0 ? 'Link payment record failed — retrying once' : 'Link payment record failed after retry (money taken)', { partyId, error: String(err) })
    }
  }
  if (threw && rec) logger.warn('Link payment record landed on the retry', { partyId })
  if (!rec) {
    await alertOwners(
      `Party balance paid by link (${dollars(pay.cents)}, payment ${pay.paymentId}, order ${pay.orderId}), but it couldn't be written on party ${partyId}. Nothing was refunded. Check the party on /admin.`,
    ).catch(() => undefined)
  }
  if (!pay.simulated) {
    let indexed = false
    for (let i = 0; i < 2 && !indexed; i++) {
      try {
        await recordPartyPayment(pay.paymentId, partyId, chargeId)
        indexed = true
      } catch (err) {
        logger.error('Party payment index write failed', { partyId, paymentId: pay.paymentId, error: String(err) })
      }
    }
    if (!indexed) {
      await alertOwners(`Party ${partyId} took a link payment (payment ${pay.paymentId}), but it couldn't be filed under it. A refund made in Square on it won't be matched; refund it from /admin.`).catch(() => undefined)
    }
  }
  return { rec, charge, created }
}

/**
 * The host's email and the owners' "Balance paid" text, once per charge:
 * whoever marks the charge told (`toldAt`, compare-and-set) sends them, so a
 * request and Square's payment event landing together never both send. If
 * that mark can't be written, they are sent anyway (a rare second message
 * beats none). A party cancelled before the money landed: the owners are
 * asked to check it and the host isn't told it is paid. Never throws.
 */
export async function tellLinkPaid(rec: PartyRecord, charge: PartyCharge): Promise<void> {
  let mine = true
  try {
    let claimed = false
    rec = await updatePartyRecord(rec.bookingId, (r) => {
      const c = r.charges?.find((x) => x.id === charge.id)
      claimed = !!c && !c.toldAt
      if (!claimed) return null
      return { ...r, charges: r.charges!.map((x) => (x.id === charge.id ? { ...x, toldAt: new Date().toISOString() } : x)) }
    }, 'Payment receipt sent', null)
    mine = claimed
  } catch (err) {
    logger.error('Could not mark a link payment told — telling anyway', { partyId: rec.bookingId, error: String(err) })
  }
  if (!mine) return
  const whenLabel = partyWhenLabel(rec.startIso)
  if (rec.status === 'cancelled') {
    await alertOwners(`Paid after it was cancelled. Check it. ${rec.hostName} paid ${dollars(charge.cents)} by payment link for the cancelled party on ${whenLabel}. Party ${rec.bookingId}. Nothing was refunded.`).catch(() => undefined)
    return
  }
  try {
    await sendPartyPaidEmail({
      to: rec.hostEmail, givenName: rec.hostName.split(' ')[0] ?? '', whenLabel, paidCents: charge.cents, receiptUrl: charge.receiptUrl, stillDueCents: dueCents(rec),
    })
  } catch (err) {
    logger.error('Link payment email failed (payment recorded)', { partyId: rec.bookingId, error: String(err) })
  }
  await alertOwners(`Balance paid: ${rec.hostName} paid ${dollars(charge.cents)} for the party on ${whenLabel}. Party ${rec.bookingId}.`).catch(() => undefined)
}

/**
 * An earlier link attempt ran out with no answer. Did its order get paid?
 * Paid → recorded now. 'unknown' when Square can't be asked (never a guess).
 */
async function settleEarlier(rec: PartyRecord, p: PartyPaying, now: Date): Promise<'paid' | 'unpaid' | 'unknown'> {
  const earlier = await paidOnOrder(async () => {
    if (p.orderId) return { orderId: p.orderId, totalCents: p.quotedCents ?? 0 }
    const o = await providers.payment.createOrder(p.order!)
    return { orderId: o.id, totalCents: o.totalAmount }
  })
  if (earlier.kind === 'unknown') {
    logger.error('Could not ask Square whether an earlier link payment paid', { partyId: rec.bookingId, error: String(earlier.error) })
    return 'unknown'
  }
  if (earlier.kind === 'unpaid') return 'unpaid'
  logger.warn('An earlier link payment was paid — recording it', { partyId: rec.bookingId, orderId: earlier.order.orderId })
  const out = await recordLinkCharge(rec.bookingId, p, {
    orderId: earlier.order.orderId, paymentId: earlier.payment.id, cents: earlier.payment.amount || earlier.order.totalCents, receiptUrl: earlier.payment.receiptUrl ?? null,
  }, now)
  if (out.rec) await tellLinkPaid(out.rec, out.charge)
  return 'paid'
}

/**
 * Square's payment event (webhook, nightly reconcile) for one of our party
 * orders, checked before "already paid by another order": is it the order
 * of the link payment in flight on this party? 'in-flight' while its own
 * request may still be running; 'recorded' once recorded from here; null
 * when it isn't that order.
 */
export async function linkOrderPaid(rec: PartyRecord, orderId: string, payment: Payment, now: Date): Promise<'recorded' | 'in-flight' | null> {
  const p = rec.paying
  if (!p?.order) return null
  let mine = p.orderId === orderId
  if (!mine && !p.orderId) {
    // Never learned its order id: the same request gives back the same order.
    try {
      mine = (await providers.payment.createOrder(p.order)).id === orderId
    } catch {
      mine = false
    }
  }
  if (!mine) return null
  if (p.state !== 'unclear' && now.getTime() - Date.parse(p.at ?? p.until) < LINK_IN_FLIGHT_MS) return 'in-flight'
  const out = await recordLinkCharge(rec.bookingId, p, { orderId, paymentId: payment.id, cents: payment.amount || p.quotedCents || 0, receiptUrl: payment.receiptUrl ?? null }, now)
  logger.warn('Square shows a link payment paid — recorded from Square', { partyId: rec.bookingId, orderId })
  if (out.rec) await tellLinkPaid(out.rec, out.charge)
  return 'recorded'
}
