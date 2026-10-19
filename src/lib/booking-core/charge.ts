/**
 * The one charge path for our own checkouts (classes now, parties next):
 * the price-drift rule (R14), charging a Square order, and asking Square
 * whether an earlier try already paid (R15). The callers keep their own
 * holds, records, messages and alerts; this only talks money.
 *
 * Server only.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { attemptKey, chargeOutcomeOf, squareErrorCodes, type AttemptStep } from '@lib/checkout-attempt'
import { sendEmail } from '@lib/email'
import type { Payment } from '@providers/interfaces/payment'

/**
 * Square's order total is what is charged; our quote is for display. Square a
 * little higher (rounding) is charged and the owners get an email; more than
 * this over the quote is refused.
 */
export const PRICE_DRIFT_TOLERANCE_CENTS = 100

/** How long a place is held while the card is charged. */
export const HOLD_MINUTES = 10

/** A charge with no answer keeps its hold this long, for a person to settle. */
export const UNCLEAR_HOLD_HOURS = 24

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

export type DriftVerdict =
  | { kind: 'same' }
  | { kind: 'charge-and-tell'; driftCents: number }
  | { kind: 'refuse'; driftCents: number }

/**
 * Square's total against our quote (R14). Above the quote by more than the
 * tolerance → refuse; any other difference → charge Square's total and tell
 * the owners. Lower is never refused. `tellBelowCents` lets a caller stay
 * quiet about a small shortfall (classes: 1 cent of rounding).
 */
export function judgeDrift(quoteCents: number, squareCents: number, opts?: { tellBelowCents?: number }): DriftVerdict {
  const driftCents = squareCents - quoteCents
  if (driftCents > PRICE_DRIFT_TOLERANCE_CENTS) return { kind: 'refuse', driftCents }
  if (driftCents > 0) return { kind: 'charge-and-tell', driftCents }
  if (driftCents < -(opts?.tellBelowCents ?? 0)) return { kind: 'charge-and-tell', driftCents }
  return { kind: 'same' }
}

/** The owners' email about a charged drift. `ref` reads like "booking bkg_…". Never throws. */
export async function tellOwnersOfDrift(subject: string, ref: string, quoteCents: number, squareCents: number, hint: string): Promise<void> {
  const drift = squareCents - quoteCents
  const totals = `(quote ${dollars(quoteCents)}, Square ${dollars(squareCents)})`
  const base = drift >= 0
    ? `Square total differed by ${dollars(drift)} on ${ref} ${totals}`
    : `Square total was ${dollars(-drift)} lower than the quote on ${ref} ${totals}.`
  const note = hint ? `${base.endsWith('.') ? base : `${base}.`} ${hint}` : base
  try {
    await sendEmail({ to: siteConfig.ownerEmails.join(', '), subject, text: note, html: `<p>${note}</p>` })
  } catch {
    /* the email is a courtesy; the booking goes on */
  }
}

export type ChargeResult =
  | { kind: 'paid'; payment: Payment; recovered?: true }
  | { kind: 'declined'; codes: string[]; error?: unknown; paymentId?: string }
  | { kind: 'unknown'; error: unknown }

/**
 * Charge one Square order. Three honest answers:
 *   paid     → the card was charged (directly, or an unclear answer whose order shows paid)
 *   declined → we KNOW nothing was charged (a 4xx refusal, or a payment marked failed)
 *   unknown  → the charge was sent and we never learned how it ended
 */
export async function chargeOrder(input: {
  orderId: string
  amountCents: number
  paymentToken: string
  email: string
  attemptId: string
  step?: AttemptStep
}): Promise<ChargeResult> {
  let payment: Payment | null = null
  let recovered = false
  try {
    payment = await providers.payment.processPayment({
      orderId: input.orderId,
      paymentToken: input.paymentToken,
      amount: input.amountCents,
      currency: 'USD',
      buyerEmailAddress: input.email,
      idempotencyKey: attemptKey(input.attemptId, input.step ?? 'pay'),
    })
  } catch (err) {
    if (chargeOutcomeOf(err) === 'not_charged') return { kind: 'declined', codes: squareErrorCodes(err), error: err }
    // Before saying "we're not sure", ask whether the order shows as paid.
    try {
      payment = await providers.payment.findOrderPayment(input.orderId)
    } catch { /* still unknown */ }
    if (!payment) return { kind: 'unknown', error: err }
    recovered = true
  }
  if (!payment) return { kind: 'unknown', error: new Error('no payment returned') }
  if (payment.status === 'failed') return { kind: 'declined', codes: [], paymentId: payment.id }
  return recovered ? { kind: 'paid', payment, recovered: true } : { kind: 'paid', payment }
}

/**
 * R15 recovery: did an earlier try of this attempt pay? `makeOrder` re-creates
 * the order with the same idempotency key, so Square gives back the same
 * order, and then says whether it is paid. Anything that can't be asked is
 * 'unknown', never 'unpaid'.
 */
export async function paidOnOrder(
  makeOrder: () => Promise<{ orderId: string; totalCents: number }>,
): Promise<
  | { kind: 'paid'; payment: Payment; order: { orderId: string; totalCents: number } }
  | { kind: 'unpaid' }
  | { kind: 'unknown'; error?: unknown }
> {
  let order: { orderId: string; totalCents: number }
  let found: Payment | null
  try {
    order = await makeOrder()
    found = await providers.payment.findOrderPayment(order.orderId)
  } catch (error) {
    return { kind: 'unknown', error }
  }
  if (!found || found.status !== 'completed') return { kind: 'unpaid' }
  return { kind: 'paid', payment: found, order }
}
