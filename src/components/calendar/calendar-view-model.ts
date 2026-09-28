import type { Workshop } from '@providers/interfaces/workshop'
import type { OpenStudioWindow } from '@lib/open-studio'
import { localDate, localHour } from '@lib/party-slots'
import { canBeBooked, isSoldOut, seatsLeftLabel } from '@lib/workshop-rules'
import { formatMoney } from '@lib/money'

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
  /** Workshops: price per seat, in cents. */
  price?: number
  /** Workshops: ISO 4217 code for `price`, e.g. "USD". */
  currency?: string
  /** Workshops: seats still open. */
  remainingSeats?: number
  /** Workshops: no price yet, so not for sale. Shown as "Coming soon". */
  comingSoon?: boolean
  /** Workshops: priced, but no seats left. Shown as "Sold out". Never set with `comingSoon`. */
  soldOut?: boolean
  /** List-view party row: how many party starts are open that day. */
  openCount?: number
  /** Collapsed booked-party row: how many parties are booked that day. */
  bookedCount?: number
  /** Events: line two in its own words, in place of "Event · time". */
  detail?: string
  /** A closure for a holiday: shown in that holiday's colours. */
  holiday?: 'halloween' | 'christmas'
  /** Whether this event can be acted on (links to a booking flow). */
  bookable: boolean
  /** Where tapping the event goes: a booking deeplink (workshop modal, party
   *  prefill) or, for Open Studio, its info page. Absent = not tappable. */
  href?: string
}

/** Format an ISO datetime's STUDIO-local (America/Chicago) time as HH:MM.
 *  Must not use Date#getHours(): this runs in the API route, where the server
 *  clock is UTC — a 6 PM CDT workshop would render "23:00" (and evening events
 *  would land on the next calendar day). */
function isoToLocalHHMM(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Chicago',
  }).format(d)
}

/** Studio-local (America/Chicago) YYYY-MM-DD from an ISO datetime. */
function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.split('T')[0] ?? iso
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
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
    const forSale = canBeBooked(w.priceCents)
    // "Coming soon" (no price) wins over "Sold out" when both apply.
    const soldOut = forSale && isSoldOut(w.availableCapacity)
    events.push({
      id: `workshop-${w.id}`,
      kind: 'workshop',
      title: w.name,
      date: isoToLocalDate(w.startAt),
      startTime: isoToLocalHHMM(w.startAt),
      endTime: isoToLocalHHMM(end.toISOString()),
      price: w.priceCents,
      currency: w.priceCurrency,
      remainingSeats: w.availableCapacity,
      ...(forSale ? {} : { comingSoon: true }),
      ...(soldOut ? { soldOut: true } : {}),
      bookable: forSale && !soldOut,
      // Not for sale yet: the row leads to the workshops page, not a booking panel.
      // Sold out: it still leads to its own panel, which says so.
      href: forSale ? `/workshops?w=${encodeURIComponent(w.id)}` : '/workshops',
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
      // Walk-in, so not bookable — but still tappable, in both views.
      bookable: false,
      href: '/open-studio',
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
      title: 'Booked · private party',
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

/** Display-format an "HH:MM" 24h string as 12-hour, e.g. "13:00" → "1:00 PM". */
export function formatClock(t?: string): string {
  const c = parseClock(t)
  return c ? `${c.hour12}:${c.minutes} ${c.suffix}` : ''
}

function parseClock(t?: string) {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  return {
    hour12: h % 12 === 0 ? 12 : h % 12,
    minutes: m[2],
    suffix: h >= 12 ? 'PM' : 'AM',
  }
}

/**
 * A compact range from two "HH:MM" 24h strings: "7–9 PM", "11:30 AM–1 PM",
 * "9:00 AM–12:30 PM". En dash; AM/PM once when both ends share it; ":00" is
 * dropped, except on a start whose end carries minutes ("7:00–9:30 PM").
 * With no end it is a single clock time ("2:00 PM").
 */
export function formatTimeRange(start?: string, end?: string): string {
  const s = parseClock(start)
  if (!s) return ''
  const e = parseClock(end)
  if (!e) return formatClock(start)
  const onTheHour = e.minutes === '00'
  const from = onTheHour && s.minutes === '00' ? `${s.hour12}` : `${s.hour12}:${s.minutes}`
  const to = onTheHour ? `${e.hour12}` : `${e.hour12}:${e.minutes}`
  return s.suffix === e.suffix ? `${from}–${to} ${e.suffix}` : `${from} ${s.suffix}–${to} ${e.suffix}`
}

/** Cents → "$35" for whole dollars, "$32.50" otherwise. Empty when there is no price. */
export function formatPrice(cents?: number, currency: string = 'USD'): string {
  if (!cents || cents < 0) return ''
  return formatMoney(cents, currency)
}

// One wording for seat counts, shared with the workshop cards.
export { seatsLeftLabel }

/**
 * Line two of a list row, under the title:
 *   workshop        "Workshop · 7–9 PM · $35 · 3 seats left" (or "· Sold out", or "· Coming soon")
 *   party-available "4 open · from 9:00 AM"
 *   open-studio     "Walk-in · 4–9 PM"
 *   party-booked    "2:00 PM" for one party, "from 9:00 AM" for several
 *   event           its own `detail` when it has one, otherwise "Event · time"
 */
export function listRowMeta(e: CalendarEvent): string {
  const parts: string[] = []
  switch (e.kind) {
    case 'workshop':
      parts.push('Workshop', formatTimeRange(e.startTime, e.endTime))
      if (e.comingSoon) parts.push('Coming soon')
      else parts.push(formatPrice(e.price, e.currency), e.soldOut ? 'Sold out' : seatsLeftLabel(e.remainingSeats))
      break
    case 'party-available':
      parts.push(`${e.openCount ?? 1} open`, e.startTime ? `from ${formatClock(e.startTime)}` : '')
      break
    case 'open-studio':
      parts.push('Walk-in', formatTimeRange(e.startTime, e.endTime))
      break
    case 'party-booked':
      if ((e.bookedCount ?? 1) > 1) parts.push(e.startTime ? `from ${formatClock(e.startTime)}` : '')
      else parts.push(formatTimeRange(e.startTime, e.endTime))
      break
    case 'event':
      if (e.detail) parts.push(e.detail)
      else parts.push('Event', formatTimeRange(e.startTime, e.endTime))
      break
  }
  return parts.filter(Boolean).join(' · ')
}

/** The call to action on the right of a list row; null when the row can't be booked. */
export function listRowAction(e: CalendarEvent): string | null {
  if (!e.bookable || !e.href) return null
  if (e.kind === 'workshop') return 'Book ›'
  if (e.kind === 'party-available') return 'Pick a time ›'
  return null
}

export interface DayGroup {
  /** YYYY-MM-DD */
  date: string
  events: CalendarEvent[]
}

/** The filter chips above the calendar. */
export type CalendarFilter = 'all' | 'workshops' | 'parties'

export const CALENDAR_FILTERS: { id: CalendarFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'workshops', label: 'Workshops' },
  { id: 'parties', label: 'Party dates' },
]

const isPartyTime = (e: CalendarEvent) => e.kind === 'party-available'
const isBookedParty = (e: CalendarEvent) => e.kind === 'party-booked'
const isParty = (e: CalendarEvent) => isPartyTime(e) || isBookedParty(e)

/**
 * Whether a row shows under a filter. The Grand Opening and Open Studio show
 * under "Everything" only.
 */
export function matchesFilter(e: CalendarEvent, filter: CalendarFilter): boolean {
  if (filter === 'workshops') return e.kind === 'workshop'
  if (filter === 'parties') return isParty(e)
  return true
}

/**
 * Earliest first. A row with no time (an all-day marker such as the Grand
 * Opening) leads the day. When two rows start together, the party goes first.
 */
const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  (a.startTime ?? '').localeCompare(b.startTime ?? '') || Number(isParty(b)) - Number(isParty(a))

/** "1 party booked" / "3 parties booked" */
export function bookedPartiesLabel(count: number): string {
  return count === 1 ? '1 party booked' : `${count} parties booked`
}

/**
 * One day's events with its booked parties collapsed to a single entry,
 * "3 parties booked", at the time of the earliest one. It is not tappable.
 * Used by the list and by the month grid, where four booked parties would
 * otherwise push an evening workshop out of the cell. In start-time order.
 */
export function collapseBookedParties(dayEvents: CalendarEvent[]): CalendarEvent[] {
  const booked = dayEvents.filter(isBookedParty).sort(byStart)
  if (booked.length === 0) return dayEvents
  const { href: _notTappable, ...earliest } = booked[0]
  const summary: CalendarEvent = {
    ...earliest,
    id: `party-booked-agg-${earliest.date}`,
    title: bookedPartiesLabel(booked.length),
    bookedCount: booked.length,
    bookable: false,
  }
  return [...dayEvents.filter((e) => !isBookedParty(e)), summary].sort(byStart)
}

/**
 * List-view shape: upcoming days only (>= today), ascending, with each day's
 * party-available slots collapsed to a single "Private party times" entry
 * (mirrors the month grid's aggregation — detail lives on /book) and its
 * booked parties collapsed to a single "3 parties booked" entry.
 *
 * Within a day: by start time, earliest at the top (Kaden, 27 Sep 2026).
 * Each party entry takes the time of its earliest slot.
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
      const partySlots = dayEvents.filter(isPartyTime).sort(byStart)
      const rest = dayEvents.filter((e) => !isPartyTime(e))
      const party: CalendarEvent[] = []
      if (partySlots.length > 0) {
        const collapsed = partySlots.length > 1
        party.push({
          ...partySlots[0],
          title: 'Private party times',
          openCount: partySlots.length,
          // A collapsed row links date-scoped, matching aggregatePartySlots;
          // a lone slot keeps its own slot-specific link (/book?start=<ts>).
          ...(collapsed && {
            id: `party-available-agg-${date}`,
            href: `/book?date=${encodeURIComponent(date)}`,
          }),
        })
      }
      return { date, events: collapseBookedParties([...party, ...rest]).sort(byStart) }
    })
}
