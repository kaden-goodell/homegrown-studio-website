/**
 * The party times a customer could book right now, across the whole booking
 * window: the schedule, less closed days (both inside partyStartsInRange),
 * less times already booked.
 *
 * Used where an answer is sent to someone rather than shown on a page, so it
 * never guesses: if the bookings can't be read, it throws, and the caller
 * says nothing about party dates this time round.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import type { SquareConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { createSquareClient } from '@providers/square/client'
import { removeClassBlocked } from '@lib/conflicts'
import { classSpansOrNone } from '@lib/party-availability'
import { bookableDates, localToUtcISO, partyStartsInRange, removeBooked } from '@lib/party-slots'
import { getStudioDays } from '@lib/studio-settings'

/** A Square "no such object" answer (404 / NOT_FOUND). */
export function isNotFound(err: unknown): boolean {
  const e = err as any
  if (e?.statusCode === 404 || e?.status === 404) return true
  return /not[ _]?found|404/i.test(err instanceof Error ? err.message : String(err))
}

/** True on the sandbox, which has none of the live-only catalog items. */
export function onSandbox(): boolean {
  return (siteConfig.providers.catalog.config as SquareConfig).environment === 'sandbox'
}

/** The party service's variation id: what marks a booking as a party. */
export async function loadPartyVariationId(): Promise<string> {
  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
  let resp: unknown
  try {
    resp = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  } catch (err) {
    // The sandbox has no live party item: that is "no party variation", not a failure.
    if (onSandbox() && isNotFound(err)) return ''
    throw err
  }
  const item = ((resp as any)?.object ?? resp) as any
  return item?.itemData?.variations?.[0]?.id ?? ''
}

export async function openPartyStartsInWindow(now: Date = new Date()): Promise<string[]> {
  const { first, last } = bookableDates(now)
  if (first > last) return []
  const from = new Date(Math.max(new Date(localToUtcISO(first, '00:00')).getTime(), now.getTime()))
  const to = new Date(localToUtcISO(last, '23:59'))
  const allOffered = partyStartsInRange(from.toISOString(), to.toISOString(), now, await getStudioDays())
  // Parties yield to classes (spec E). A failed class lookup never blocks.
  const offered =
    allOffered.length === 0
      ? allOffered
      : removeClassBlocked(allOffered, await classSpansOrNone(from.toISOString(), to.toISOString()))
  if (offered.length === 0 || !providers.booking.listBookings) return offered

  const [variationId, bookings] = await Promise.all([
    loadPartyVariationId(),
    providers.booking.listBookings({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
      locationId: siteConfig.providers.booking.config.locationId || '',
    }),
  ])
  const booked = bookings
    .filter((b) => b.status !== 'cancelled' && (!variationId || b.slot?.serviceVariationId === variationId))
    .map((b) => b.slot.startAt)
  return removeBooked(offered, booked)
}
