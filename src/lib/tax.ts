/**
 * Sales tax shown at checkout, from the percent Square applies (read from its
 * catalog — see the Square workshop provider). Square works tax out on each
 * line, rounding to the cent; our prices are whole dollars, so at 9% there is
 * never a half cent to round. The charged total from Square is what the
 * confirmation email reports.
 *
 * Client-safe: no imports.
 */
export function taxCents(subtotalCents: number, percent: number | undefined): number {
  if (!percent || percent <= 0 || subtotalCents <= 0) return 0
  return Math.round((subtotalCents * percent) / 100)
}

/**
 * Tax on a booking whose seats are charged one by one (every class seat is its
 * own Square order): each seat's tax rounded to the cent, then added, exactly
 * as Square charges it. Can differ by a cent from taxing the subtotal once
 * (3 × $12.50 at 9%: $3.39, not $3.38).
 */
export function seatsTaxCents(seatPricesCents: number[], percent: number | undefined): number {
  return seatPricesCents.reduce((sum, price) => sum + taxCents(price, percent), 0)
}

/** "9%" / "9.5%" */
export function percentLabel(percent: number): string {
  return `${Number(percent.toFixed(3))}%`
}
