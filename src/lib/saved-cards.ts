/**
 * Saved cards (stage 4, waitlist): what a refusal from Square's Cards API or a
 * saved-card charge means, in plain words. Square's codes stay in the log;
 * people read these. Whether money moved is chargeOutcomeOf's call (a 4xx is
 * "not charged", no answer is "unknown"); this only says why.
 *
 * Client-safe: no imports beyond checkout-attempt, no env.
 */
import { chargeOutcomeOf, squareErrorCodes } from './checkout-attempt'

export type CardTrouble = 'declined' | 'no-funds' | 'expired' | 'verify' | 'card-gone' | 'try-again' | 'unknown'

const DECLINED = new Set([
  'CARD_DECLINED', 'GENERIC_DECLINE', 'CVV_FAILURE', 'VERIFY_CVV_FAILURE', 'ADDRESS_VERIFICATION_FAILURE', 'VERIFY_AVS_FAILURE',
  'INVALID_ACCOUNT', 'CARD_DECLINED_CALL_ISSUER', 'CARD_NOT_SUPPORTED', 'INVALID_CARD', 'INVALID_CARD_DATA', 'PAN_FAILURE',
  'TRANSACTION_LIMIT', 'ALLOWABLE_PIN_TRIES_EXCEEDED', 'BAD_EXPIRATION', 'CHIP_INSERTION_REQUIRED', 'PAYMENT_LIMIT_EXCEEDED',
  'INVALID_POSTAL_CODE', 'INVALID_PIN', 'MANUALLY_ENTERED_PAYMENT_NOT_SUPPORTED',
])
const NO_FUNDS = new Set(['INSUFFICIENT_FUNDS'])
const EXPIRED = new Set(['CARD_EXPIRED', 'INVALID_EXPIRATION', 'EXPIRATION_FAILURE'])
const VERIFY = new Set(['CARD_DECLINED_VERIFICATION_REQUIRED', 'BUYER_VERIFICATION_REQUIRED', 'INVALID_VERIFICATION_TOKEN'])
const GONE = new Set(['NOT_FOUND', 'CARD_NOT_FOUND', 'CARD_DISABLED', 'CUSTOMER_NOT_FOUND'])
/** The one-time token from the card form is spent or stale: typing the card again fixes it. */
const TRY_AGAIN = new Set(['CARD_TOKEN_EXPIRED', 'CARD_TOKEN_USED', 'SOURCE_USED', 'SOURCE_EXPIRED'])

/** Why a save or a saved-card charge didn't work. Unknown whenever we never heard back. */
export function cardTroubleOf(error: unknown): CardTrouble {
  if (chargeOutcomeOf(error) === 'unknown') return 'unknown'
  const codes = squareErrorCodes(error)
  const has = (set: Set<string>) => codes.some((c) => set.has(c))
  if (has(NO_FUNDS)) return 'no-funds'
  if (has(EXPIRED)) return 'expired'
  if (has(VERIFY)) return 'verify'
  if (has(GONE) || (error as { statusCode?: unknown })?.statusCode === 404) return 'card-gone'
  if (has(TRY_AGAIN)) return 'try-again'
  if (has(DECLINED)) return 'declined'
  // Any other refusal: the card wasn't accepted.
  return 'declined'
}

/** What the customer reads when their card couldn't be saved (joining the waitlist). Saving never charges. */
export const SAVE_CARD_MESSAGES: Record<CardTrouble, string> = {
  declined: 'Your bank didn’t accept that card. Nothing was charged. Try another card.',
  'no-funds': 'Your bank didn’t accept that card. Nothing was charged. Try another card.',
  expired: 'That card has expired. Nothing was charged. Try another card.',
  verify: 'Your bank couldn’t confirm that card. Nothing was charged. Try again, or use another card.',
  'card-gone': 'We couldn’t save that card. Nothing was charged. Try again.',
  'try-again': 'We couldn’t save that card. Nothing was charged. Type the card in again and try once more.',
  unknown: 'We couldn’t save that card. Nothing was charged. Try again.',
}

/** Why a saved-card charge didn't go through, for the owners' alert ("…didn't go through: the card was declined."). */
export const CHARGE_TROUBLE_WORDS: Record<CardTrouble, string> = {
  declined: 'the card was declined',
  'no-funds': 'the card didn’t have enough money on it',
  expired: 'the card has expired',
  verify: 'the bank wanted the card holder to confirm it',
  'card-gone': 'the card isn’t on file any more',
  'try-again': 'Square refused the saved card',
  unknown: 'Square didn’t answer, so we don’t know yet',
}
