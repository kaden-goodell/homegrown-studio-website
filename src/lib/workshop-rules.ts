/**
 * Rules about workshops that the pages and the server must agree on.
 *
 * Client-safe: no imports, no env.
 */

/**
 * A workshop can be booked only when it has a price.
 *
 * There is no such thing as a free workshop (Kaden, 27 Sep 2026). A class
 * with no price, or a price of zero, has been set up in Square but is not
 * ready to sell: it shows as "Coming soon" and the server refuses to book it.
 */
export function canBeBooked(priceCents: unknown): boolean {
  return typeof priceCents === 'number' && Number.isFinite(priceCents) && priceCents > 0
}

/** Seats are mentioned only once this few remain. Above that, a number reads as an empty room. */
export const SEATS_LEFT_THRESHOLD = 8

/** "3 seats left" / "1 seat left" when 8 or fewer remain, otherwise empty. Never for zero: that is "Sold out". */
export function seatsLeftLabel(remaining?: number | null): string {
  if (remaining == null || remaining <= 0 || remaining > SEATS_LEFT_THRESHOLD) return ''
  return remaining === 1 ? '1 seat left' : `${remaining} seats left`
}

/** No seats left. Distinct from "not for sale yet" (no price). */
export function isSoldOut(remaining?: number | null): boolean {
  return remaining === 0
}
