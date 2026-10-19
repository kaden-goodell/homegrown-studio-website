/**
 * Which book writes refunds for a saved request's scope: a static list, so
 * no booking kind depends on being imported first (a party refund Square
 * made is never written as plain money while our saved request waits).
 *
 *   'party'  → the party refund book (parties/refunds)
 *   'cls_…'  → the class refund book (classes/refunds)
 *   anything else throws: a wiring miss surfaces (the webhook logs it, the
 *   nightly run tries again) instead of recording a refund twice.
 *
 * `claimSquareRefund` lives here (not in classes/refunds, not in the runner)
 * because it is the one step that goes from a scope to a book. Square's
 * webhook and the nightly run (classes/square-events) import it from here.
 *
 * Server only.
 */
import { classRefundBook } from '@lib/classes/refunds'
import { partyRefundBook } from '@lib/parties/refunds'
import type { Cents } from '@lib/classes/types'
import { claimSquareRefundWith, PARTY_SCOPE, type RefundBook, type RefundScope } from './refund-runner'

/** A saved request whose scope no book knows (never written by our own code; a corrupted document). */
export class UnknownRefundScope extends Error {
  constructor(public scope: string) { super(`No refund book for the scope "${scope}"`) }
}

/**
 * The book for a scope. Its books are write-side only: resolved from the
 * scope alone they carry no ask, so they write, email and audit saved
 * requests but can't plan a new refund (never pass one to runRefund).
 * Null = nothing there to write to (no such party).
 */
export async function refundBookFor(scope: RefundScope, hint: { label?: string } = {}): Promise<RefundBook<unknown> | null> {
  if (scope.classId === PARTY_SCOPE) return partyRefundBook(scope.bookingId, hint) as Promise<RefundBook<unknown> | null>
  if (scope.classId.startsWith('cls_')) return classRefundBook(scope.classId, scope.bookingId, hint) as Promise<RefundBook<unknown>>
  throw new UnknownRefundScope(scope.classId)
}

/**
 * Square's webhook (or the nightly run) saw a COMPLETED refund on one of
 * these bookings' payment: when it is one of our saved requests it is saved
 * as that request through its scope's book, and true is returned (the caller
 * records nothing of its own). See the runner's claimSquareRefundWith.
 */
export function claimSquareRefund(
  refund: { id: string; paymentId: string; cents: Cents },
  bookings: { classId: string; bookingId: string; label?: string }[],
  opts: { requestIds?: string[]; exactOnly?: boolean } = {},
): Promise<boolean> {
  // A request no book can write is not claimed: the caller records Square's refund the usual way (every Square
  // refund recorded), and the stuck request shows up as "no answer" after a day. Every other caller still throws.
  return claimSquareRefundWith(async (scope, hint) => {
    try {
      return await refundBookFor(scope, hint)
    } catch (e) {
      if (!(e instanceof UnknownRefundScope)) throw e
      console.error(`[refund-books] ${e.message}: Square refund ${refund.id} recorded the usual way instead`)
      return null
    }
  }, refund, bookings, opts)
}
