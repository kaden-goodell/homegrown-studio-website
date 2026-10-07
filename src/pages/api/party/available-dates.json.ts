import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { partyStartsInRange, removeBooked, localDate } from '@lib/party-slots'
import { classSpansOrNone } from '@lib/party-availability'
import { removeClassBlocked } from '@lib/conflicts'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:available-dates')

const DAY_MS = 86_400_000

export const POST: APIRoute = async ({ request }) => {
  if (!bookingsOpen(request)) return bookingsClosedResponse()
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { serviceVariationId } = body

    const windowDays = Math.min(Math.max(Number(body.days) || partyConfig.bookingWindowDays, 1), 120)
    const locationId = siteConfig.providers.booking.config.locationId || ''

    const now = new Date()
    const windowEnd = new Date(now.getTime() + windowDays * DAY_MS)

    // Offered starts across the window come from config (per-weekday schedule).
    const starts = partyStartsInRange(now.toISOString(), windowEnd.toISOString())

    // Parties yield to classes (spec E). The panel takes its times from here,
    // so the rule must hold here as well as in availability.json. A failed
    // class lookup offers every time (logged inside classSpansOrNone).
    const classes = starts.length > 0 ? await classSpansOrNone(now.toISOString(), windowEnd.toISOString()) : []
    const unblocked = removeClassBlocked(starts, classes)

    // Remove starts already booked (one bookings lookup for the whole window).
    let bookedStarts: string[] = []
    if (starts.length > 0 && providers.booking.listBookings) {
      try {
        const bookings = await providers.booking.listBookings({
          startDate: now.toISOString(),
          endDate: windowEnd.toISOString(),
          locationId,
        })
        bookedStarts = bookings
          .filter(
            (b) =>
              b.status !== 'cancelled' &&
              (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId)
          )
          .map((b) => b.slot.startAt)
      } catch (err) {
        logger.error('Party booking lookup failed (showing all dates)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // The open times ride along with each date, so picking a date in the
    // panel shows its times at once instead of waiting on a second request.
    const durationMinutes = partyConfig.durationMinutes
    const times: Record<string, { startAt: string; endAt: string; durationMinutes: number }[]> = {}
    for (const startAt of removeBooked(unblocked, bookedStarts)) {
      const date = localDate(startAt)
      ;(times[date] ??= []).push({
        startAt,
        endAt: new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString(),
        durationMinutes,
      })
    }
    const dates = Object.keys(times).sort()

    // Dates we offer that have no time left: shown as "Booked", so a customer
    // can tell "taken" from "not offered".
    const bookedDates = Array.from(new Set(starts.map((s) => localDate(s))))
      .filter((d) => !times[d])
      .sort()

    logger.info('Party available-dates complete', {
      duration_ms: Date.now() - startTime,
      windowDays,
      dateCount: dates.length,
    })

    return new Response(
      JSON.stringify({ data: { dates, times, bookedDates, windowDays } }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    logger.error('Party available-dates failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to load available dates' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
