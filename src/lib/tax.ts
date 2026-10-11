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

/** "9%" / "9.5%" */
export function percentLabel(percent: number): string {
  return `${Number(percent.toFixed(3))}%`
}
