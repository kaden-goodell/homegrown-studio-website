/**
 * Square → our party records: one of our own party orders (reference_id
 * 'pty_…') seen by the webhook or the nightly reconcile. The class seat code
 * (src/lib/classes/square-events.ts) hands these over before any catalog
 * lookup.
 *
 *   - Already recorded (the party saved, its payment filed) → nothing.
 *   - Not paid in Square → nothing.
 *   - Paid, and its checkout is unclear (or was left mid-charge for 5+
 *     minutes) → the party is recorded from that checkout and its time
 *     booked (R15/R42 for parties); the host gets the confirmation once,
 *     the owners a text.
 *   - Paid, and it is the order of the payment link in flight on the party
 *     (`paying`) → those items are recorded paid (left alone for 5 minutes
 *     while its own request may still be running).
 *   - Paid, with nothing here to record it from (no checkout; or the party is
 *     already paid by another order) → a 'paid-elsewhere' entry for /admin ›
 *     To decide, and a text to the owners.
 *
 * Nothing here charges, cancels or refunds. Never throws to the caller.
 */
import { providers } from '@config/providers'
import { squareErrorCodes } from '@lib/checkout-attempt'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { formatSlotLabel } from '@lib/studio-time'
import { getPartyRecord } from '@lib/party-store'
import type { Payment } from '@providers/interfaces/payment'
import { partyForPayment } from './party-payments'
import { deleteCheckout, getCheckout, savePaidElsewhere, type PartyCheckout } from './party-checkouts'
import { releaseTime } from './party-book'
import { confirmationDone, recordPaidParty, reportRecoveredBooking, sendPartyBookedEmail } from './checkout'
import { linkOrderPaid } from './pay-balance'

const logger = createLogger('parties:square-orders')

/** A checkout still being charged by its own request is left alone this long. */
export const IN_FLIGHT_MS = 5 * 60_000

export type PartyOrderOutcome =
  | { action: 'ignored'; why: 'not-paid' | 'recorded' | 'in-flight' | 'unreadable' }
  | { action: 'recorded'; partyId: string }
  | { action: 'flagged'; why: 'no-checkout' | 'other-payment' }

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`

function tenderPaymentIds(order: any): string[] {
  return [...new Set<string>((order?.tenders ?? []).map((t: any) => t?.payment_id ?? t?.id).filter((x: unknown): x is string => typeof x === 'string' && !!x))]
}

export async function handlePartyOrder(order: any, now: Date, opts: { paymentId?: string } = {}): Promise<PartyOrderOutcome> {
  try {
    return await handle(order, now, opts)
  } catch (err) {
    logger.error('Party order from Square not handled', { orderId: order?.id, error: err instanceof Error ? err.message : String(err) })
    return { action: 'ignored', why: 'unreadable' }
  }
}

async function handle(order: any, now: Date, opts: { paymentId?: string }): Promise<PartyOrderOutcome> {
  const orderId = String(order?.id ?? '')
  const partyId = String(order?.reference_id ?? '')
  if (!orderId || !partyId.startsWith('pty_')) return { action: 'ignored', why: 'not-paid' }
  if (order?.state !== 'COMPLETED' && order?.state !== 'OPEN') return { action: 'ignored', why: 'not-paid' }

  // The usual echo of a booking that went through: its payment is filed and the party saved. No Square call.
  const rec = await getPartyRecord(partyId)
  const known = [...new Set([...(opts.paymentId ? [opts.paymentId] : []), ...tenderPaymentIds(order)])]
  if (rec) for (const id of known) if (await partyForPayment(id)) return { action: 'ignored', why: 'recorded' }

  const payment: Payment | null = await providers.payment.findOrderPayment(orderId)
  if (!payment || payment.status !== 'completed') return { action: 'ignored', why: 'not-paid' }
  if (rec && (await partyForPayment(payment.id))) return { action: 'ignored', why: 'recorded' }

  if (rec?.charges?.some((c) => c.paymentId === payment.id)) return { action: 'ignored', why: 'recorded' }
  // A payment-link order on a booked party (checked before "already paid by another order").
  if (rec?.paying?.order) {
    const link = await linkOrderPaid(rec, orderId, payment, now)
    if (link === 'recorded') return { action: 'recorded', partyId }
    if (link === 'in-flight') return { action: 'ignored', why: 'in-flight' }
  }
  const c = await getCheckout(partyId)

  if (!rec && c?.draft && (c.state === 'unclear' || (c.state === 'charging' && now.getTime() - Date.parse(c.updatedAt) >= IN_FLIGHT_MS))) {
    const paid = await recordPaidParty(c, {
      orderId, paymentId: payment.id, cents: payment.amount || c.squareCents || c.quotedCents, receiptUrl: payment.receiptUrl ?? null,
    }, now)
    logger.warn('Square shows our party paid — recorded from Square', { partyId, orderId })
    if (paid.created) await tellBooked(c, paid.rec, paid.charge.cents, paid.charge.receiptUrl)
    return { action: 'recorded', partyId }
  }
  if (!rec && c && c.state === 'charging') return { action: 'ignored', why: 'in-flight' }

  const why = rec ? 'other-payment' : 'no-checkout'
  const entry: PartyCheckout & { orderId: string } = {
    partyId, state: 'paid-elsewhere', why, startIso: rec?.startIso ?? c?.startIso ?? '', endIso: rec?.endIso ?? c?.endIso ?? '',
    draft: null, order: null, orderId, quotedCents: 0, squareCents: payment.amount, paymentId: payment.id,
    host: c?.host ?? { firstName: rec?.hostName ?? '', lastName: '', email: rec?.hostEmail ?? '', phone: rec?.hostPhone ?? '' },
    origin: c?.origin ?? '', via: 'online', at: now.toISOString(), updatedAt: now.toISOString(),
  }
  if (await savePaidElsewhere(entry)) {
    logger.error('PARTY PAID IN SQUARE WITH NOTHING TO RECORD IT FROM', { partyId, orderId, why })
    await alertOwners(
      `Party payment to check: Square shows ${dollars(payment.amount)} paid on order ${orderId} for party ${partyId}, but ${why === 'other-payment' ? 'that party is already paid by another order' : 'there is nothing here to book it from'}. Nothing was refunded. Open /admin › To decide.`,
    ).catch(() => undefined)
  }
  return { action: 'flagged', why }
}

/** The host's confirmation (once: only the call that created the record) and the owners' text. */
export async function tellBooked(c: PartyCheckout, rec: Parameters<typeof sendPartyBookedEmail>[0]['rec'], cents: number, receiptUrl: string | null): Promise<void> {
  if (!c.draft) return
  const sent = await sendPartyBookedEmail({
    partyId: c.partyId, rec, draft: c.draft, firstName: c.host.firstName, email: c.host.email, origin: c.origin,
    chargedCents: cents, receiptUrl, onFile: c.onFile ?? null, themeName: c.theme?.displayName,
  })
  await reportRecoveredBooking(c, cents)
  await confirmationDone(c.partyId, rec, sent)
  await alertOwners(
    `Party booked from Square's payment: ${c.host.firstName} ${c.host.lastName} paid ${dollars(cents)} for ${formatSlotLabel(c.startIso)}. Party ${c.partyId}. It is confirmed and they were emailed.`,
  ).catch(() => undefined)
}

// ---------------------------------------------------------------- owners' decisions (To decide)

/** Why an owner's decision on an unclear party payment can't go ahead (status for the API). */
export class PartyUnclearError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/**
 * What Square says about the checkout's order: its payment, or null when
 * unpaid. `orderUnknown`: no order id was ever learned and Square refuses to
 * give the order back (that key was first used with a different request), so
 * this try's order can't be looked up from here. Throws PartyUnclearError
 * when Square can't be read.
 */
async function paymentOf(c: PartyCheckout): Promise<{ orderId: string; payment: Payment | null; orderUnknown?: true }> {
  try {
    let orderId = c.orderId
    // Never got its order id back: the same request gives back the same order.
    if (!orderId && c.order) {
      try {
        orderId = (await providers.payment.createOrder(c.order)).id
      } catch (err) {
        if (squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) return { orderId: '', payment: null, orderUnknown: true }
        throw err
      }
    }
    if (!orderId) return { orderId: '', payment: null, orderUnknown: true }
    const payment = await providers.payment.findOrderPayment(orderId)
    return { orderId, payment: payment && payment.status === 'completed' ? payment : null }
  } catch {
    throw new PartyUnclearError(503, 'Couldn’t reach Square to check that payment. Try again.')
  }
}

/** Owners' words when this try's order can't be found from here. */
export const ORDER_UNKNOWN_MESSAGE = 'We can’t tell which Square order this try made, so it can’t be confirmed from here. Look for the payment in Square. If it was paid, the party is booked here by itself once Square tells us (by the next morning). If it wasn’t, choose It wasn’t paid.'

/**
 * "Confirm the party": only once Square shows the order paid (the money is
 * what makes it a party). Books the time, records the party, emails the host once.
 */
export async function confirmUnclearParty(partyId: string, now: Date = new Date()): Promise<{ partyId: string; overlap: boolean }> {
  const c = await getCheckout(partyId)
  if (!c?.draft) throw new PartyUnclearError(404, 'This isn’t waiting any more.')
  const { orderId, payment, orderUnknown } = await paymentOf(c)
  if (orderUnknown) throw new PartyUnclearError(409, ORDER_UNKNOWN_MESSAGE)
  if (!payment) throw new PartyUnclearError(409, 'Square doesn’t show this order paid. If it wasn’t paid, choose It wasn’t paid.')
  const paid = await recordPaidParty(c, { orderId, paymentId: payment.id, cents: payment.amount || c.squareCents || c.quotedCents, receiptUrl: payment.receiptUrl ?? null }, now)
  if (paid.created) await tellBooked(c, paid.rec, paid.charge.cents, paid.charge.receiptUrl)
  return { partyId, overlap: !!paid.rec?.overlap }
}

/**
 * "It wasn't paid": refused while Square shows it paid; otherwise the held
 * time is let go. Also allowed when the order can't be looked up (the owner
 * has checked Square; the nightly reconcile still flags any paid pty_ order).
 */
export async function notPaidUnclearParty(partyId: string): Promise<void> {
  const c = await getCheckout(partyId)
  if (!c) throw new PartyUnclearError(404, 'This isn’t waiting any more.')
  const { payment } = await paymentOf(c)
  if (payment) throw new PartyUnclearError(409, 'Square shows this order paid. Confirm the party instead.')
  await releaseTime(partyId, c.startIso)
  await deleteCheckout(partyId)
}
