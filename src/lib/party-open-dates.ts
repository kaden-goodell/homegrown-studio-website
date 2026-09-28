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
import { bookableDates, localToUtcISO, partyStartsInRange, removeBooked } from '@lib/party-slots'

/** The party service's variation id: what marks a booking as a party. */
export async function loadPartyVariationId(): Promise<string> {
  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
  const resp = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  const item = ((resp as any)?.object ?? resp) as any
  return item?.itemData?.variations?.[0]?.id ?? ''
}

export async function openPartyStartsInWindow(now: Date = new Date()): Promise<string[]> {
  const { first, last } = bookableDates(now)
  if (first > last) return []
  const from = new Date(Math.max(new Date(localToUtcISO(first, '00:00')).getTime(), now.getTime()))
  const to = new Date(localToUtcISO(last, '23:59'))
  const offered = partyStartsInRange(from.toISOString(), to.toISOString(), now)
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
