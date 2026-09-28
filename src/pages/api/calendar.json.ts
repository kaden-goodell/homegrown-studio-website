import type { APIRoute } from 'astro'
import { bookingsOpen } from '@lib/bookings-gate'
import { OPENING_DATE } from '@config/opening'
import { closures, daysOf, reopensOn } from '@config/closures'
import { longDate } from '@lib/notify-context'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { createSquareClient } from '@providers/square/client'
import { partyConfig } from '@config/party.config'
import type { SquareConfig } from '@config/site.config'
import { parseOpenStudioWindows } from '@lib/open-studio'
import { localDate, localToUtcISO, partyStartsInRange, removeBooked } from '@lib/party-slots'
import {
  buildCalendarEvents,
  type PartyAvailabilitySlot,
  type PartyBookedSlot,
} from '@components/calendar/calendar-view-model'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false
const logger = createLogger('api:calendar')

/** The list view asks for a few months at once; more than this is refused. */
const MAX_MONTHS = 6

type OpenStudioWindow = { date: string; startTime: string; endTime: string }

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** "2026-10", 3 → ["2026-10", "2026-11", "2026-12"] */
function monthsFrom(first: string, count: number): string[] {
  const [y, m] = first.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

async function loadOpenStudioWindows(): Promise<OpenStudioWindow[]> {
  const eventTypes = await providers.catalog.getEventTypes()
  const openStudio =
    eventTypes.find((et: any) => et.id === partyConfig.square.openStudioItemId) ??
    eventTypes.find((et: any) => (et.flow as string) === 'display')
  return parseOpenStudioWindows(openStudio?.programDates ?? '')
}

async function loadPartyVariationId(): Promise<string> {
  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
  const resp = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  const item = ((resp as any)?.object ?? resp) as any
  return item?.itemData?.variations?.[0]?.id ?? ''
}

/**
 * Returns calendar events for one month (?month=YYYY-MM) or for several in a
 * row (?month=YYYY-MM&months=3): workshops, Open Studio walk-in windows,
 * available party slots, and booked (reserved) parties.
 *
 * Speed: Square is asked each question once, all at the same time, however
 * many months are wanted. Answers that change rarely are remembered for a
 * short while (see short-memory.ts), and the response is cached at the edge
 * (see cache-headers.ts).
 */
export const GET: APIRoute = async ({ url, request }) => {
  const month = url.searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return new Response(JSON.stringify({ error: 'month=YYYY-MM required' }), { status: 400 })
  }
  const wanted = Number(url.searchParams.get('months') ?? 1)
  const count = Number.isInteger(wanted) ? Math.min(Math.max(wanted, 1), MAX_MONTHS) : 1
  const months = monthsFrom(month, count)
  const afterLast = monthsFrom(month, count + 1)[count]

  // Months are STUDIO-LOCAL months (America/Chicago), not UTC ones: 7 PM CDT
  // on Oct 31 is already Nov 1 in UTC. Range queries run from local midnight
  // on the 1st to the last instant before the following month's, and
  // membership is decided on each event's local YYYY-MM-DD.
  const rangeStart = new Date(localToUtcISO(`${month}-01`, '00:00'))
  const rangeEnd = new Date(new Date(localToUtcISO(`${afterLast}-01`, '00:00')).getTime() - 1)
  const inRange = (date: string) => months.includes(date.slice(0, 7))
  const inRangeIso = (iso: string) => inRange(localDate(iso))
  const now = new Date()
  const locationId = siteConfig.providers.booking.config.locationId || ''

  // Everything Square is asked, asked at once. Each lookup fails on its own:
  // the rest of the calendar still shows.
  let failed = false
  const orElse = <T,>(what: string, fallback: T) => (err: unknown): T => {
    failed = true
    logger.error(`${what} failed`, { error: errorText(err) })
    return fallback
  }
  const [allWorkshops, allOpenStudioWindows, partyVariationId, bookings] = await Promise.all([
    remember('calendar:workshops', 30_000, () => providers.workshop.listWorkshops()).catch(
      orElse('workshops fetch', [] as any[]),
    ),
    remember('calendar:open-studio', 60_000, loadOpenStudioWindows).catch(
      orElse('open studio fetch', [] as OpenStudioWindow[]),
    ),
    // The party service's variation id changes only when the item is rebuilt.
    remember('calendar:party-variation', 10 * 60_000, loadPartyVariationId).catch(
      orElse('party variation resolve', ''),
    ),
    providers.booking.listBookings
      ? providers.booking
          .listBookings({ startDate: rangeStart.toISOString(), endDate: rangeEnd.toISOString(), locationId })
          .catch(orElse('party bookings', [] as any[]))
      : Promise.resolve([] as any[]),
  ])

  const workshops = allWorkshops.filter((w: any) => inRangeIso(w.startAt))
  const openStudioWindows = allOpenStudioWindows.filter((w) => inRange(w.date))

  // Booked (reserved) parties — identified by the party service variation id.
  const partyBooked: PartyBookedSlot[] = []
  if (partyVariationId) {
    for (const b of bookings) {
      if (
        b.status !== 'cancelled' &&
        b.slot?.serviceVariationId === partyVariationId &&
        inRangeIso(b.slot.startAt)
      ) {
        partyBooked.push({ startAt: b.slot.startAt })
      }
    }
  }

  // Available party slots — generated from the per-weekday schedule (config),
  // minus any already booked. Only future, in-range starts.
  const availStart = new Date(Math.max(rangeStart.getTime(), now.getTime() + 60_000))
  const offeredStarts =
    availStart.getTime() < rangeEnd.getTime()
      ? partyStartsInRange(availStart.toISOString(), rangeEnd.toISOString())
      : []
  const partyAvailable: PartyAvailabilitySlot[] = removeBooked(
    offeredStarts,
    partyBooked.map((b) => b.startAt)
  )
    .filter(inRangeIso)
    .map((startAt) => ({ startAt }))

  // The calendar stays viewable pre-opening (marketing "What's On"), but:
  //  - nothing before opening day is shown (no stale pre-opening dates), and
  //  - schedule-generated "party available" booking slots are withheld until
  //    bookings actually open, so we never advertise a bookable slot the gate
  //    would then refuse. Real created content (workshops, open studio, booked
  //    parties) still shows as "what's coming". A Grand Opening marker anchors
  //    the opening month.
  const includePartySlots = bookingsOpen(request)
  const built = buildCalendarEvents(
    workshops,
    openStudioWindows,
    includePartySlots ? partyAvailable : [],
    partyBooked,
  )
  const events = built.filter((e) => e.date >= OPENING_DATE && inRange(e.date))
  if (months.includes(OPENING_DATE.slice(0, 7))) {
    events.unshift({
      id: 'grand-opening',
      kind: 'event',
      title: 'Grand Opening',
      detail: 'Doors open. Come see the studio.',
      date: OPENING_DATE,
      // Not bookable, but tappable: it leads to the homepage.
      bookable: false,
      href: '/',
    })
  }
  // Days the studio has closed: a row on every one of them, so a whole
  // closed week reads as a whole closed week.
  for (const closure of closures) {
    const reopens = `We reopen ${longDate(reopensOn(closure))}.`
    for (const day of daysOf(closure)) {
      if (day < OPENING_DATE || !inRange(day)) continue
      events.push({
        id: `closed-${day}`,
        kind: 'event',
        title: `Closed for ${closure.name}`,
        detail: reopens,
        date: day,
        bookable: false,
        ...(closure.holiday ? { holiday: closure.holiday } : {}),
      })
    }
  }
  return new Response(JSON.stringify({ events, ...(failed ? { incomplete: true } : {}) }), {
    status: 200,
    headers: publicListHeaders(request, { failed }),
  })
}
