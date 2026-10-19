/**
 * The words and keys every refund shares (classes, parties): the refusal
 * type, the messages the screens show, the Square idempotency key and the
 * plan a booking kind hands the runner. Lives here, not in a booking kind,
 * so the runner depends on no kind (classes/refunds re-exports these, so
 * older imports keep working).
 *
 * Server only (node:crypto).
 */
import { createHash } from 'node:crypto'
import type { Cents } from '@lib/classes/types'

/** Square allows this many refunds on one payment. */
export const SQUARE_REFUND_CAP = 20
export const NOT_PAID_HERE = 'Refund this one in Square, where it was paid.'
export const SQUARE_NO_ANSWER = "Square didn't confirm the refund. Try again. It won't refund twice."
export const SQUARE_TURNED_DOWN = "Square turned the refund down, so nothing was refunded. Try again."

export const NOT_WAITING = "That refund isn't waiting on Square any more."
export const STILL_WAITING_ON_SQUARE = 'A refund on this booking is still waiting on Square. Check it in Square first.'
export const AGAIN_IS_STALE = 'Someone already refunded this again. Check the list.'
export const AGAIN_NEEDS_THE_SCREEN = 'To repeat a refund, use "Refund again" on the refund screen.'
export const REFUND_JUST_MADE = 'Another refund was just made on this booking. Look at the booking again before refunding more.'
export const SAVED_SPLIT_NO_LONGER_FITS =
  "That refund no longer fits what's left on this booking, so nothing was sent to Square. Look at what's left and refund again."

/** "This payment has had 20 refunds, the most Square allows on one payment." */
export const refundCapMessage = () => `This payment has had ${SQUARE_REFUND_CAP} refunds, the most Square allows on one payment.`

export class RefundError extends Error {
  /** `extra` goes into the reply next to the error (e.g. the refund still waiting on Square) */
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message)
  }
}

/** What a booking kind's `plan()` hands the runner: the exact split, the payment, and what the key is built from. */
export interface RefundPlan {
  /** classes: seat lines; parties: the one charge */
  lines: { id: string; cents: Cents }[]
  totalCents: Cents
  paymentId: string
  freeSeat: boolean
  /** refunds already made on this booking (its payment), as counted for the idempotency key */
  prior: number
  /** times Square turned down this same request */
  failures: number
  /** the request's key before hashing, without the failure count */
  rawKey: string
}

/**
 * The Square idempotency key. Built from
 * `refund:${bookingId}:${sortedLineIds}:${totalCents}:${n}` (n = refunds already
 * made on the booking), so a retry is the same key and a deliberate second
 * identical refund is a new one. A refund Square turned down (FAILED or
 * REJECTED) bumps a failure count kept for that exact request (its raw key),
 * so only a retry of that request is new; no answer keeps the same key, and
 * other requests on the booking are untouched. Square caps keys at 45
 * characters, so the string is hashed.
 */
export function refundKeyRaw(bookingId: string, lineIds: string[], totalCents: Cents, n: number): string {
  return `refund:${bookingId}:${[...lineIds].sort().join(',')}:${totalCents}:${n}`
}
export function refundKey(bookingId: string, lineIds: string[], totalCents: Cents, n: number, failures = 0): string {
  const raw = `${refundKeyRaw(bookingId, lineIds, totalCents, n)}${failures ? `:f${failures}` : ''}`
  return `refund:${createHash('sha256').update(raw).digest('hex').slice(0, 38)}`
}
