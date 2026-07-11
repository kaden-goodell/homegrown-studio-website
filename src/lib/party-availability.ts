/**
 * Shared party availability logic — used by both the availability API endpoint
 * and the booking endpoint (pre-charge guard).
 *
 * The key fix over the previous inline implementation: booking lookups now use
 * `studioDayUtcRange(date)` rather than `${date}T00:00:00Z`/`T23:59:59Z`.
 * The UTC-midnight bounds miss evening slots in winter (CST = UTC-6): a 6 PM CT
 * slot starts at midnight UTC and falls outside the old window. The studio-local
 * range is always correct regardless of DST.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { partyStartsForDate, removeBooked } from '@lib/party-slots'
import { studioDayUtcRange } from '@lib/studio-time'

/** Studio-local YYYY-MM-DD for any ISO instant. */
export function studioDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: partyConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso)) // en-CA → YYYY-MM-DD
}

/**
 * Open start ISOs for a studio-local date (schedule minus booked minus past).
 *
 * Degrades gracefully: if listBookings is unavailable or throws, candidates
 * filtered to future are returned so booking is never blocked by a lookup failure.
 */
export async function openPartyStarts(date: string, serviceVariationId?: string): Promise<string[]> {
  const now = Date.now()
  const candidates = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)
  if (candidates.length === 0 || !providers.booking.listBookings) return candidates

  const { startIso, endIso } = studioDayUtcRange(date)
  const bookings = await providers.booking.listBookings({
    startDate: startIso,
    endDate: endIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const bookedStarts = bookings
    .filter(
      (b) =>
        b.status !== 'cancelled' &&
        (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId)
    )
    .map((b) => b.slot.startAt)

  return removeBooked(candidates, bookedStarts)
}

/**
 * Is this exact start still open?
 * Used by the book endpoint to guard against double-booking before charging.
 */
export async function isStartOpen(startIso: string, serviceVariationId?: string): Promise<boolean> {
  const open = await openPartyStarts(studioDateOf(startIso), serviceVariationId)
  const t = new Date(startIso).getTime()
  return open.some((s) => new Date(s).getTime() === t)
}
