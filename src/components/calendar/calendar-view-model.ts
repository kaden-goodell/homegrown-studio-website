import type { Workshop } from '@providers/interfaces/workshop'
import type { OpenStudioWindow } from '@lib/open-studio'
import { localDate, localHour } from '@lib/party-slots'

/**
 * A normalized event rendered on the read-only "What's On" calendar.
 * Times are LOCAL wall-clock "HH:MM" strings (24h) when present.
 */
export interface CalendarEvent {
  id: string
  kind: 'open-studio' | 'workshop' | 'event' | 'party-available' | 'party-booked'
  title: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, local wall-clock */
  startTime?: string
  /** HH:MM, local wall-clock */
  endTime?: string
  /** Whether this event can be acted on (links to a booking flow). */
  bookable: boolean
  /** Deeplink target for bookable events (workshop modal or party prefill). */
  href?: string
}

/** Format a UTC-ish ISO datetime's wall-clock time as local HH:MM. */
function isoToLocalHHMM(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Local YYYY-MM-DD from an ISO datetime. */
function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.split('T')[0] ?? iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** A human-friendly local time for a party start, e.g. "2:00 PM". */
function partyTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    // Fall back to studio-local hour from the helper.
    return `${localHour(iso)}:00`
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }).format(d)
}

/** A party start expressed by its Square availability slot. */
export interface PartyAvailabilitySlot {
  startAt: string
}

/** A booked (whole-room) party occurrence read from listBookings. */
export interface PartyBookedSlot {
  startAt: string
}

/**
 * Combine workshops (domain shape from `providers.workshop.listWorkshops()`),
 * parsed open-studio windows, available party starts, and booked party slots
 * into a single normalized CalendarEvent[] for the WhatsOnCalendar, sorted by
 * date then start time.
 */
export function buildCalendarEvents(
  workshops: Workshop[],
  openStudioWindows: OpenStudioWindow[],
  partyAvailable: PartyAvailabilitySlot[] = [],
  partyBooked: PartyBookedSlot[] = []
): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const w of workshops) {
    const start = new Date(w.startAt)
    const end = new Date(start.getTime() + w.durationMinutes * 60_000)
    events.push({
      id: `workshop-${w.id}`,
      kind: 'workshop',
      title: w.name,
      date: isoToLocalDate(w.startAt),
      startTime: isoToLocalHHMM(w.startAt),
      endTime: isoToLocalHHMM(end.toISOString()),
      bookable: true,
      href: `/workshops?w=${encodeURIComponent(w.id)}`,
    })
  }

  openStudioWindows.forEach((win, i) => {
    events.push({
      id: `open-studio-${win.date}-${i}`,
      kind: 'open-studio',
      title: 'Open Studio',
      date: win.date,
      startTime: win.startTime,
      endTime: win.endTime,
      bookable: false,
    })
  })

  // Available party starts → green, clickable, deeplink into the party flow.
  for (const slot of partyAvailable) {
    const timeLabel = partyTimeLabel(slot.startAt)
    events.push({
      id: `party-available-${slot.startAt}`,
      kind: 'party-available',
      title: `Party available · ${timeLabel}`,
      date: localDate(slot.startAt),
      startTime: isoToLocalHHMM(slot.startAt),
      bookable: true,
      href: `/book?start=${encodeURIComponent(slot.startAt)}`,
    })
  }

  // Booked whole-room parties → warm social proof, not a closed door.
  for (const slot of partyBooked) {
    events.push({
      id: `party-booked-${slot.startAt}`,
      kind: 'party-booked',
      title: 'Booked · private party 🎉',
      date: localDate(slot.startAt),
      startTime: isoToLocalHHMM(slot.startAt),
      bookable: false,
    })
  }

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const at = a.startTime ?? ''
    const bt = b.startTime ?? ''
    return at < bt ? -1 : at > bt ? 1 : 0
  })

  return events
}

export interface DayGroup {
  /** YYYY-MM-DD */
  date: string
  events: CalendarEvent[]
}

/**
 * List-view shape: upcoming days only (>= today), ascending, with each day's
 * party-available slots collapsed to a single "N party times open" entry
 * (mirrors the month grid's aggregation — detail lives on /book).
 */
export function groupEventsByDay(events: CalendarEvent[], today: string): DayGroup[] {
  const byDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (e.date < today) continue
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEvents]) => {
      const partySlots = dayEvents.filter((e) => e.kind === 'party-available')
      if (partySlots.length <= 1) return { date, events: dayEvents }
      const rest = dayEvents.filter((e) => e.kind !== 'party-available')
      const summary: CalendarEvent = {
        ...partySlots[0],
        id: `party-available-agg-${date}`,
        title: `🎉 ${partySlots.length} party times open`,
        // Rebuild the href: partySlots[0].href is slot-specific (/book?start=<ts>);
        // the collapsed row must link date-scoped, matching aggregatePartySlots.
        href: `/book?date=${encodeURIComponent(date)}`,
      }
      return { date, events: [...rest, summary] }
    })
}
