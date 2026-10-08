/**
 * What a customer reads when a checkout doesn't finish. One place, used by the
 * endpoints and by both booking panels, so the two flows say the same thing
 * and nothing technical ever reaches the screen.
 *
 * Rule: the words "not charged" / "nothing was charged" appear only where the
 * code knows that. When the outcome is unknown we say so.
 *
 * Client-safe: imports only client-safe config.
 */
import { partyContent } from '@config/party-content'
import type { CheckoutErrorCode } from '@lib/checkout-attempt'

export const TEXT_US = partyContent.textNumber ? `text us at ${partyContent.textNumber}` : 'get in touch'

export const UNKNOWN_OUTCOME_MESSAGE = `We’re not sure that went through. Please don’t pay again yet. Check your email for a receipt, or ${TEXT_US} and we’ll confirm.`

export const workshopMessages: Record<CheckoutErrorCode, string> = {
  invalid: 'Something in the booking was missing. Please check your details and try again.',
  card_declined: 'Your card was declined. Nothing was charged. Try another card.',
  slot_taken: 'The last seat was just taken. Nothing was charged.',
  sold_out: 'The last seat was just taken. Nothing was charged.',
  already_booked: 'You already have a seat in this workshop. Check your email for the confirmation.',
  not_open: 'This workshop isn’t open for booking yet. Nothing was charged.',
  unavailable: `Something went wrong on our end and nothing was charged. Please try again, or ${TEXT_US}.`,
  unknown_outcome: UNKNOWN_OUTCOME_MESSAGE,
  gift_card_short: 'That gift card doesn’t have enough on it for this booking. Nothing was charged. Use a card instead.',
}

export const partyMessages: Record<CheckoutErrorCode, string> = {
  invalid: 'Something in the booking was missing. Please check your details and try again.',
  card_declined: 'Your card was declined, so we released the date. Nothing was charged. Try another card.',
  slot_taken: 'That time was just booked by someone else. Nothing was charged. Pick another time.',
  sold_out: 'That time was just booked by someone else. Nothing was charged. Pick another time.',
  already_booked: 'You’re already booked for this time. Check your email for the confirmation.',
  not_open: 'That date isn’t open for booking yet. Nothing was charged. Pick one of the dates shown.',
  unavailable: `Something went wrong on our end and nothing was charged. Please try again, or ${TEXT_US}.`,
  unknown_outcome: UNKNOWN_OUTCOME_MESSAGE,
  gift_card_short: 'That gift card doesn’t have enough on it for this booking. Nothing was charged. Use a card instead.',
}

/** A gift card that can't cover the booking. Said before anything is held or charged. */
export function giftCardShortMessage(balanceCents: number, totalCents: number): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return `That gift card has ${dollars(balanceCents)} on it — this booking is ${dollars(totalCents)}. Nothing was charged. Use a card instead.`
}

/** The payment form could not load at all (script blocked, network down). */
export const PAYMENT_FORM_UNAVAILABLE = `We couldn’t load the payment form. Refresh the page, or ${TEXT_US}.`

/**
 * Is it still unknown whether a failed booking request charged the card?
 * While it is, the booking panel keeps its attempt ID, so the server can
 * recognise a retry. Once the server has said plainly what happened, the
 * attempt is over and the next try starts fresh.
 */
export function outcomeUnknown(
  response: { status: number; body: { code?: string; detail?: string } | null } | null,
): boolean {
  if (!response || !response.body) return true
  const { code } = response.body
  if (code === 'unknown_outcome') return true
  if (code) return false
  return response.status >= 500
}

/**
 * What to show for a failed booking request.
 *  - No usable answer from the server (dropped connection, timeout, a gateway
 *    error page) → the outcome is unknown.
 *  - Otherwise the server's own plain sentence, which it chose knowing what happened.
 */
export function messageForFailure(
  response: { status: number; body: { code?: string; detail?: string } | null } | null,
  messages: Record<CheckoutErrorCode, string>,
): string {
  if (!response || !response.body) return UNKNOWN_OUTCOME_MESSAGE
  const { code, detail } = response.body
  if (code && code in messages) return detail || messages[code as CheckoutErrorCode]
  // An answer without a code is from a gateway or an older build: we can't vouch for it.
  if (response.status >= 500) return UNKNOWN_OUTCOME_MESSAGE
  return detail || messages.unavailable
}
