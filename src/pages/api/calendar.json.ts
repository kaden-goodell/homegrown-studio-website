import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { createSquareClient } from '@providers/square/client'
import { partyConfig } from '@config/party.config'
import type { SquareConfig } from '@config/site.config'
import { parseOpenStudioWindows } from '@lib/open-studio'
import { offeredPartyStarts } from '@lib/party-slots'
import {
  buildCalendarEvents,
  type PartyAvailabilitySlot,
  type PartyBookedSlot,
} from '@components/calendar/calendar-view-model'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:calendar')

/**
 * Returns calendar events for a single month (?month=YYYY-MM): workshops,
 * Open Studio walk-in windows, available party slots, and booked (reserved)
 * parties. Scoped to one month so each Square availability query stays under
 * Square's 32-day range cap.
 */
export const GET: APIRoute = async ({ url }) => {
  const month = url.searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new Response(JSON.stringify({ error: 'month=YYYY-MM required' }), { status: 400 })
  }

  const monthStart = new Date(`${month}-01T00:00:00Z`)
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59))
  const now = new Date()
  const locationId = siteConfig.providers.booking.config.locationId || ''

  // Workshops (filter the full list to this month)
  let workshops: any[] = []
  try {
    const all = await providers.workshop.listWorkshops()
    workshops = all.filter((w: any) => {
      const t = new Date(w.startAt).getTime()
      return t >= monthStart.getTime() && t <= monthEnd.getTime()
    })
  } catch (err) {
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }

  // Open Studio windows (non-bookable display item), filtered to this month
  let openStudioWindows: { date: string; startTime: string; endTime: string }[] = []
  try {
    const eventTypes = await providers.catalog.getEventTypes()
    const openStudio =
      eventTypes.find((et: any) => et.id === partyConfig.square.openStudioItemId) ??
      eventTypes.find((et: any) => (et.flow as string) === 'display')
    openStudioWindows = parseOpenStudioWindows(openStudio?.programDates ?? '').filter((w) =>
      w.date.startsWith(month)
    )
  } catch (err) {
    logger.error('open studio fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }

  // Resolve the party service variation id once.
  let partyVariationId = ''
  try {
    const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
    const resp = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
    const item = ((resp as any)?.object ?? resp) as any
    partyVariationId = item?.itemData?.variations?.[0]?.id ?? ''
  } catch (err) {
    logger.error('party variation resolve failed', { error: err instanceof Error ? err.message : String(err) })
  }

  // Available party slots — only query future, in-range dates (Square: 32-day cap,
  // 90-day lead). Clamp the start to now and skip wholly-past months.
  const partyAvailable: PartyAvailabilitySlot[] = []
  const availStart = new Date(Math.max(monthStart.getTime(), now.getTime() + 60_000))
  if (partyVariationId && availStart.getTime() < monthEnd.getTime()) {
    try {
      const slots = await providers.booking.searchAvailability({
        startDate: availStart.toISOString(),
        endDate: monthEnd.toISOString(),
        locationId,
        serviceVariationId: partyVariationId,
        teamMemberId: partyConfig.square.defaultTeamMemberId,
      })
      for (const s of offeredPartyStarts(slots)) partyAvailable.push({ startAt: s.startAt })
    } catch (err) {
      logger.error('party availability failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Booked (reserved) parties — identified by the party service variation id.
  const partyBooked: PartyBookedSlot[] = []
  if (partyVariationId && providers.booking.listBookings) {
    try {
      const bookings = await providers.booking.listBookings({
        startDate: monthStart.toISOString(),
        endDate: monthEnd.toISOString(),
        locationId,
      })
      for (const b of bookings) {
        if (b.status !== 'cancelled' && b.slot?.serviceVariationId === partyVariationId) {
          partyBooked.push({ startAt: b.slot.startAt })
        }
      }
    } catch (err) {
      logger.error('party bookings failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const events = buildCalendarEvents(workshops, openStudioWindows, partyAvailable, partyBooked)
  return new Response(JSON.stringify({ events }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
