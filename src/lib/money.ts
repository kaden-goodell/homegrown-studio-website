/**
 * THE price formatter. Every price a customer sees goes through here, so the
 * site never shows "$40.00" in one place and "$40" in another.
 *
 * Client-safe: no imports, no env.
 */

/** Cents → "$40" for whole dollars, "$32.50" otherwise. Never rounds a price. */
export function formatMoney(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
