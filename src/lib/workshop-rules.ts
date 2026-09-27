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
