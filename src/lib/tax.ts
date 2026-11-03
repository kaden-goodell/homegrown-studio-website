/**
 * Sales tax the way Square works it out (measured with Square's CalculateOrder
 * in the sandbox, 2 Nov 2026 — fixtures in tests/lib/tax-square-rounding.test.ts):
 *
 * - A half cent is rounded to the EVEN cent (banker's rounding), not up:
 *   9% of $10.50 = 94.5¢ → 94¢; 9% of $9.50 = 85.5¢ → 86¢.
 * - One order's tax at one rate is worked out ONCE on the sum of its taxed
 *   lines (after line discounts), then shared out over the lines: three $1.50
 *   lines are 40.5¢ → 40¢ in all, not 3 × 14¢.
 *
 * Square's own split of that total over the lines can differ from ours by a
 * cent on a line when halves tie; the order total always matches. Where
 * Square's per-line numbers are known (lineTotals) they are what is saved.
 *
 * Client-safe: no imports.
 */

/** percent × cents / 100 rounded half to even, done in whole numbers (percent to 3 decimals). */
function halfEvenTax(cents: number, percent: number): number {
  const p = Math.round(percent * 1000) // 9 → 9000, 9.5 → 9500
  const num = cents * p
  const den = 100_000
  const q = Math.floor(num / den)
  const r = num - q * den
  if (r * 2 < den) return q
  if (r * 2 > den) return q + 1
  return q % 2 === 0 ? q : q + 1
}

/** The tax on one amount (one taxed line, or one order with a single line), as Square rounds it. */
export function taxCents(subtotalCents: number, percent: number | undefined): number {
  if (!percent || percent <= 0 || subtotalCents <= 0) return 0
  return halfEvenTax(subtotalCents, percent)
}

/**
 * One order's lines (after their discounts) → each line's tax, adding up to
 * exactly what Square charges for the order: the order's tax is rounded once
 * (half to even), each line gets its own half-even share, and any cent left
 * over is put on (or taken off) lines from the last one back.
 */
export function orderLineTaxes(lineNetCents: number[], percent: number | undefined): number[] {
  if (!percent || percent <= 0) return lineNetCents.map(() => 0)
  const nets = lineNetCents.map((c) => Math.max(0, c))
  const total = taxCents(nets.reduce((s, c) => s + c, 0), percent)
  const each = nets.map((c) => taxCents(c, percent))
  let diff = total - each.reduce((s, c) => s + c, 0)
  // Each line is within half a cent of its exact share, so one pass from the last line back always settles it.
  for (let i = each.length - 1; i >= 0 && diff !== 0; i--) {
    if (diff > 0) { each[i]++; diff-- }
    else if (each[i] > 0) { each[i]--; diff++ }
  }
  return each
}

/** One order's whole tax (the sum of orderLineTaxes). */
export function orderTaxCents(lineNetCents: number[], percent: number | undefined): number {
  return orderLineTaxes(lineNetCents, percent).reduce((s, c) => s + c, 0)
}

/**
 * Tax on a booking whose seats are charged one by one (every legacy Square
 * class seat is its own Square order): each seat's tax rounded on its own,
 * then added, exactly as Square charges it.
 */
export function seatsTaxCents(seatPricesCents: number[], percent: number | undefined): number {
  return seatPricesCents.reduce((sum, price) => sum + taxCents(price, percent), 0)
}

/** "9%" / "9.5%" */
export function percentLabel(percent: number): string {
  return `${Number(percent.toFixed(3))}%`
}
