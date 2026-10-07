/**
 * Server side of "no class over a booked party" (spec F). Read-only: it lists
 * bookings and reports; it never changes one.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { getPartyRecord } from '@lib/party-store'
import { studioDate, studioDayUtcRange } from '@lib/studio-time'
import { partyBlocksClass, partySpanOf, type PartySpan } from '@lib/conflicts'

const MINUTE_MS = 60_000

/**
 * Non-cancelled parties a class running [classStartIso, +minutes) would
 * overlap, with host names when we hold the party's record. Throws when
 * bookings can't be read: callers refuse to schedule rather than guess.
 */
export async function findPartyClashes(classStartIso: string, minutes: number): Promise<PartySpan[]> {
  if (!providers.booking.listBookings) throw new Error('This booking provider cannot list bookings')
  const { startIso, endIso } = studioDayUtcRange(studioDate(classStartIso))
  const bookings = await providers.booking.listBookings({
    startDate: startIso,
    endDate: endIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const parties = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => {
        const record = await getPartyRecord(b.id).catch(() => null)
        return partySpanOf(b, record?.hostName)
      }),
  )
  const classEndIso = new Date(Date.parse(classStartIso) + minutes * MINUTE_MS).toISOString()
  return partyBlocksClass(classStartIso, classEndIso, parties)
}
