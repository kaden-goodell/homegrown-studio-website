/**
 * The seats line for a class still run from Square: "7 of 20 booked",
 * "7 booked", "13 seats left", or '' when nothing is known.
 * Client-safe. LEGACY: goes when the last Square class has run.
 */
export function legacyBookedLabel(c: { booked?: number; capacity?: number; remaining?: number }): string {
  if (typeof c.booked === 'number' && typeof c.capacity === 'number') return `${c.booked} of ${c.capacity} booked`
  if (typeof c.booked === 'number') return `${c.booked} booked`
  if (typeof c.remaining === 'number') return `${c.remaining} seats left`
  return ''
}
