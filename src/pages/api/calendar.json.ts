import type { APIRoute } from 'astro'
import { bookingsOpen } from '@lib/bookings-gate'
import { OPENING_DATE, GRAND_OPENING_DATE } from '@config/opening'
import { closureOn, daysOf, reopensOn } from '@config/closures'
import { getStudioDays } from '@lib/studio-settings'
import { longDate } from '@lib/notify-context'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { parseOpenStudioWindows } from '@lib/open-studio'
import { localDate, localToUtcISO } from '@lib/party-slots'
import { partyStartsInRange } from '@lib/parties/party-times'
import { getPartySettings } from '@lib/parties/settings-store'
import { partyMinutes } from '@lib/parties/open-times'
import { clashes, partyBusy, type Busy } from '@lib/classes/studio-schedule'
import {
  buildCalendarEvents,
  type PartyAvailabilitySlot,
  type PartyBookedSlot,
} from '@components/calendar/calendar-view-model'
import { classSpanOf, removeClassBlocked, type ClassSpan } from '@lib/conflicts'
import { listClasses } from '@lib/classes/class-store'
import type { ScheduledClass } from '@lib/classes/types'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'
import { isNotFound, onSandbox } from '@lib/parties/legacy-square'

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
  let eventTypes: any[]
  try {
    eventTypes = await providers.catalog.getEventTypes()
  } catch (err) {
    // The sandbox has no live Craft Café item: no windows, not a failure.
    if (onSandbox() && isNotFound(err)) return []
    throw err
  }
  const openStudio =
    eventTypes.find((et: any) => et.id === partyConfig.square.openStudioItemId) ??
    eventTypes.find((et: any) => (et.flow as string) === 'display')
  return parseOpenStudioWindows(openStudio?.programDates ?? '')
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

  // Everything Square is asked, asked at once. Each lookup fails on its own:
  // the rest of the calendar still shows.
  let failed = false
  const orElse = <T,>(what: string, fallback: T) => (err: unknown): T => {
    failed = true
    logger.error(`${what} failed`, { error: errorText(err) })
    return fallback
  }
  const [allWorkshops, allOpenStudioWindows, parties, ourClasses, studio, partySettings] = await Promise.all([
    remember('calendar:workshops', 30_000, () => providers.workshop.listWorkshops()).catch(
      orElse('workshops fetch', [] as any[]),
    ),
    remember('calendar:open-studio', 60_000, loadOpenStudioWindows).catch(
      orElse('open studio fetch', [] as OpenStudioWindow[]),
    ),
    // Parties holding the room: our party book (held and booked) and Square-booked
    // ones (party service only). null = couldn't be read: no party time is offered.
    partyBusy(rangeStart.toISOString(), rangeEnd.toISOString(), now).catch(orElse('parties', null as Busy[] | null)),
    listClasses({ fromIso: rangeStart.toISOString(), toIso: rangeEnd.toISOString() }).catch(
      orElse('our classes', [] as ScheduledClass[]),
    ),
    // The owners' closed days and café hours (config until they first save on /admin).
    getStudioDays(),
    // The owners' party times (config until they first save Parties setup).
    getPartySettings(),
  ])
  const closures = studio.closures
  // Only open/closed, not link-only, ones are public; the same ones block parties.
  const publicClasses = ourClasses.filter(
    (c) => (c.status === 'open' || c.status === 'closed') && !c.content.rules.linkOnly,
  )
  const ourSpans: ClassSpan[] = publicClasses.flatMap((c) =>
    c.sessions.map((s) => ({ id: s.id, name: c.content.name, startIso: s.startIso, endIso: s.endIso })),
  )

  const workshops = allWorkshops.filter((w: any) => inRangeIso(w.startAt))
  const openStudioWindows = allOpenStudioWindows.filter((w) => inRange(w.date))

  // Booked (reserved) parties: held or booked in our party book, or booked in Square.
  const partyBooked: PartyBookedSlot[] = (parties ?? [])
    .filter((p) => inRangeIso(p.startIso))
    .map((p) => ({ startAt: p.startIso }))

  // Available party slots: the owners' party times (closed days and café gap
  // out), less any a class or a party is in the way of. Only future, in-range
  // starts; none at all when the parties couldn't be read.
  const availStart = new Date(Math.max(rangeStart.getTime(), now.getTime() + 60_000))
  const minutes = partyMinutes(partySettings)
  const offeredStarts =
    parties && availStart.getTime() < rangeEnd.getTime()
      ? partyStartsInRange(partySettings, availStart.toISOString(), rangeEnd.toISOString(), now, studio, { minutes })
      : []
  const partyFree = (startAt: string) =>
    clashes({ kind: 'party', startIso: startAt, endIso: new Date(Date.parse(startAt) + minutes * 60_000).toISOString() }, parties ?? []).length === 0
  // Parties yield to classes (spec E), then booked parties come off.
  const partyAvailable: PartyAvailabilitySlot[] = removeClassBlocked(offeredStarts, [...allWorkshops.map(classSpanOf), ...ourSpans])
    .filter(partyFree)
    .filter(inRangeIso)
    .map((startAt) => ({ startAt }))

  // The calendar stays viewable pre-opening (marketing "What's On"), but:
  //  - nothing before opening day is shown (no stale pre-opening dates), and
  //  - schedule-generated "party available" booking slots are withheld until
  //    bookings actually open, so we never advertise a bookable slot the gate
  //    would then refuse. Real created content (workshops, open studio, booked
  //    parties) still shows as "what's coming". A Grand Opening marker anchors
  //    the opening month.
  const includePartySlots = bookingsOpen(request, 'parties')
  const built = buildCalendarEvents(
    workshops,
    openStudioWindows,
    includePartySlots ? partyAvailable : [],
    partyBooked,
    publicClasses,
  )
  // Walk-in hours come from Square and don't know about closures: a closed day
  // never shows Craft Café (e.g. Sat 26 Dec, the Christmas holidays).
  const events = built.filter((e) => e.date >= OPENING_DATE && inRange(e.date) && !(e.kind === 'open-studio' && closureOn(e.date, closures)))
  if (months.includes(GRAND_OPENING_DATE.slice(0, 7))) {
    events.unshift({
      id: 'grand-opening',
      kind: 'event',
      title: 'Grand Opening',
      detail: 'Doors open. Come see the studio.',
      date: GRAND_OPENING_DATE,
      // Not bookable, but tappable: it leads to the homepage.
      bookable: false,
      href: '/',
    })
  }
  // Days the studio has closed: a row on every one of them, so a whole
  // closed week reads as a whole closed week.
  for (const closure of closures) {
    const reopens = `We reopen ${longDate(reopensOn(closure, closures))}.`
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
  // The closed days themselves ride along: the calendar shades and dresses them (WhatsOnCalendar).
  const shut = closures
    .filter((c) => c.to >= `${month}-01` && c.from < `${afterLast}-01`)
    .map((c) => ({ from: c.from, to: c.to, name: c.name, ...(c.holiday ? { holiday: c.holiday } : {}) }))
  return new Response(JSON.stringify({ events, closures: shut, ...(failed ? { incomplete: true } : {}) }), {
    status: 200,
    headers: publicListHeaders(request, { failed }),
  })
}
