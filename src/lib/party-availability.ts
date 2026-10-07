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
import { createLogger } from '@lib/logger'
import { classSpanOf, removeClassBlocked, type ClassSpan } from '@lib/conflicts'
import type { BookingWithMetadata } from '@providers/interfaces/booking'

const logger = createLogger('party-availability')

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
 * Classes on the calendar between two instants, in-progress and sold-out ones
 * included (`listAllWorkshops`). Never cached: the pre-charge re-check uses it
 * to decide a booking. Throws when classes can't be read.
 */
export async function classSpansBetween(fromIso: string, toIso: string): Promise<ClassSpan[]> {
  const w = providers.workshop
  const list = await (w.listAllWorkshops?.() ?? w.listWorkshops())
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  return list.map(classSpanOf).filter((c) => Date.parse(c.endIso) > from && Date.parse(c.startIso) < to)
}

/**
 * The same, but a failed lookup is logged and read as "no classes": party
 * availability is never blocked by it (spec E). The warnings panel catches
 * any overlap that slips through.
 */
export async function classSpansOrNone(fromIso: string, toIso: string): Promise<ClassSpan[]> {
  try {
    return await classSpansBetween(fromIso, toIso)
  } catch (err) {
    logger.error('Class lookup failed — party times not checked against classes', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Open start ISOs for a studio-local date: the schedule, minus past starts,
 * minus starts a class rules out (parties yield to classes, `@lib/conflicts`),
 * minus starts already booked.
 *
 * A failed class lookup is logged and ignored (never blocks booking). A failed
 * bookings lookup throws; callers decide (availability.json shows all
 * candidates; the book endpoint proceeds).
 */
export async function openPartyStarts(date: string, serviceVariationId?: string): Promise<string[]> {
  const now = Date.now()
  const candidates = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)
  if (candidates.length === 0) return candidates

  const { startIso, endIso } = studioDayUtcRange(date)
  const clear = removeClassBlocked(candidates, await classSpansOrNone(startIso, endIso))
  if (clear.length === 0 || !providers.booking.listBookings) return clear

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

  return removeBooked(clear, bookedStarts)
}

/**
 * The live booking this customer already holds at exactly this start, if any.
 *
 * Used when a checkout is retried: the time looks taken, and the question is
 * whether it was taken by this very customer's earlier attempt. Looked up in
 * the booking system itself; nothing is remembered on our side.
 */
export async function bookingHeldBy(
  startIso: string,
  customerId: string,
  serviceVariationId?: string,
): Promise<BookingWithMetadata | null> {
  if (!providers.booking.listBookings || !customerId) return null
  const { startIso: from, endIso: to } = studioDayUtcRange(studioDateOf(startIso))
  const bookings = await providers.booking.listBookings({
    startDate: from,
    endDate: to,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const t = new Date(startIso).getTime()
  return (
    bookings.find(
      (b) =>
        b.status !== 'cancelled' &&
        b.customerId === customerId &&
        new Date(b.slot.startAt).getTime() === t &&
        (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId),
    ) ?? null
  )
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
