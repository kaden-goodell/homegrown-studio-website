/**
 * What an owner reads in /admin when booking a party by card, or taking a
 * card on one, doesn't go through. The booking and payment code answers in
 * the customer's words (for /book and the payment link: "text us", "check
 * your email"); Catherine is the one at the counter or on the phone, so the
 * admin routes swap those for what happened and exactly what to do.
 *
 * Anything not listed here (a clash naming who is in the way, a past time,
 * a guest count, the test-site refusal) is already written for owners and
 * passes through unchanged.
 *
 * Server only.
 */
import { partyMessages, workshopMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { formatMoney } from '@lib/money'
import {
  CHOICES_CHANGED_MESSAGE, IN_PROGRESS_MESSAGE, PARTY_CANCELLED_MESSAGE, PRICE_MISMATCH_MESSAGE,
} from './checkout'
import {
  LINK_AMOUNT_CHANGED_MESSAGE, LINK_BUSY_MESSAGE, LINK_CANCELLED_MESSAGE, LINK_NOT_FOUND_MESSAGE,
  LINK_ORDER_FAILED_MESSAGE, LINK_PRICE_MISMATCH_MESSAGE,
} from './pay-balance'

const ORDER_FAILED_BOOK = "We couldn't start the payment, so we released the date. Your card was not charged — please try again."
const THEME_NOT_RESERVED = "We couldn't reserve the themed table. Your card was not charged — please try again."

const first = (name: string) => name.trim().split(/\s+/)[0] || 'the host'

/** Book by card in /admin (`bookParty`, audience admin). */
export function ownerBookMessage(code: string, message: string, hostFirst: string): string {
  const who = first(hostFirst)
  if (code === 'unknown_outcome' || message === UNKNOWN_OUTCOME_MESSAGE) return ownerBookUnknown(who)
  if (code === 'in_progress' || message === IN_PROGRESS_MESSAGE) {
    return `That booking is still going through from your last tap. Wait a minute, then look for ${who}’s party on the calendar before trying again.`
  }
  if (code === 'card_declined') return 'The card was declined, so nothing was charged and the time was let go. Try another card, or book with Send payment link.'
  switch (message) {
    case PRICE_MISMATCH_MESSAGE:
      return 'Square’s total didn’t match our price, so nothing was charged and the time was let go. The owners got a text with both amounts. Check the prices in Parties setup, then book again.'
    case ORDER_FAILED_BOOK:
      return 'Square couldn’t start the payment, so nothing was charged and the time was let go. Try again.'
    case THEME_NOT_RESERVED:
      return 'The themed table couldn’t be reserved, so nothing was charged. Try again.'
    case PARTY_CANCELLED_MESSAGE:
      return 'This booking was already made and then cancelled. Close this and start a new booking.'
    case CHOICES_CHANGED_MESSAGE:
      return 'Something changed since your first try, so nothing was charged. Close this and start the booking again.'
    case partyMessages.unavailable:
    case workshopMessages.unavailable:
      return 'Something on our side didn’t answer, so nothing was charged and nothing was booked. Try again in a minute.'
  }
  return message
}

/** Book by card: Square never answered the charge. The time is held and the party waits in To decide. */
export function ownerBookUnknown(hostFirst: string): string {
  const who = first(hostFirst)
  return `Square didn’t answer, so we can’t tell yet if ${who}’s card was charged. Don’t charge it again. The time stays held for ${who}. In a few minutes, look in Square under Payments. The party is also listed in To decide, where you confirm it or say it wasn’t paid.`
}

/**
 * Take a card on an existing party (payBalance with `owner`). `busy` is the
 * plain "who is paying and how long" sentence from the party itself.
 */
export function ownerTakeCardMessage(code: string, message: string, busy: string | null): string {
  if (code === 'in_progress' || message === LINK_BUSY_MESSAGE) {
    return busy ?? 'Another payment on this party is going through. Wait a few minutes, then check Payments on this party before trying again.'
  }
  if (code === 'card_declined') return 'The card was declined, so nothing was charged. Try another card, or use Send payment link.'
  if (code === 'not_found' || message === LINK_NOT_FOUND_MESSAGE) return 'That party does not exist.'
  switch (message) {
    case LINK_CANCELLED_MESSAGE:
      return 'This party was cancelled, so nothing was charged. Nothing is due on a cancelled party.'
    case LINK_AMOUNT_CHANGED_MESSAGE:
      return 'What’s due changed since you opened this (an extra was added or paid). Nothing was charged. Check Payments for the new amount, then take the card again.'
    case LINK_PRICE_MISMATCH_MESSAGE:
      return 'Square’s total didn’t match our price, so nothing was charged. The owners got a text with both amounts. Check the prices in Parties setup, then try again.'
    case LINK_ORDER_FAILED_MESSAGE:
      return 'Square couldn’t start the payment, so nothing was charged. Try again.'
    case workshopMessages.unavailable:
    case partyMessages.unavailable:
      return 'Something on our side didn’t answer, so nothing was charged. Try again in a minute.'
  }
  return message
}

/** Take a card: Square never answered. The party keeps its time; its payment slot waits up to 24 hours. */
export function ownerTakeCardUnknown(hostFirst: string, cents: number, until: string | null): string {
  const who = first(hostFirst)
  return `Square didn’t answer, so we can’t tell yet if ${who}’s card was charged${cents > 0 ? ` ${formatMoney(cents)}` : ''}. Don’t charge it again. The party keeps its time. In a few minutes, look in Square under Payments. If it was paid, it shows up on this party by itself. Until then, Move, Cancel and new payments on this party wait${until ? ` (at most until ${until})` : ''}.`
}
