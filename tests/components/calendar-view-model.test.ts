import { describe, it, expect } from 'vitest'
import {
  buildCalendarEvents,
  collapseBookedParties,
  formatClock,
  formatPrice,
  formatTimeRange,
  groupEventsByDay,
  listRowAction,
  listRowMeta,
  matchesFilter,
  seatsLeftLabel,
} from '@components/calendar/calendar-view-model'
import type { CalendarEvent } from '@components/calendar/calendar-view-model'

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'x',
  kind: 'workshop',
  title: 'T',
  date: '2026-07-18',
  bookable: true,
  ...over,
})

describe('groupEventsByDay', () => {
  it('groups events by date ascending and drops past days', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'a', date: '2026-07-18' }),
        ev({ id: 'b', date: '2026-07-12' }),
        ev({ id: 'c', date: '2026-07-18', kind: 'open-studio' }),
        ev({ id: 'past', date: '2026-07-01' }),
      ],
      '2026-07-11' // "today"
    )
    expect(days.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-18'])
    expect(days[1].events.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('collapses multiple party-available slots into one summary entry per day', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'p2', date: '2026-07-18', kind: 'party-available', startTime: '11:30', href: '/book?start=b' }),
        ev({ id: 'p1', date: '2026-07-18', kind: 'party-available', startTime: '09:00', href: '/book?start=a' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events).toHaveLength(1)
    const row = days[0].events[0]
    expect(row.kind).toBe('party-available')
    expect(row.title).toBe('Private party times')
    expect(row.openCount).toBe(2)
    // The summary carries the EARLIEST open start, whatever order slots arrive in.
    expect(row.startTime).toBe('09:00')
    // Collapsed summary must link to the DAY, not inherit the first slot's
    // slot-specific href — same convention as the month grid's aggregation.
    expect(row.href).toBe('/book?date=2026-07-18')
  })

  it('gives a lone party slot the same row title but keeps its slot-specific link', () => {
    const days = groupEventsByDay(
      [
        ev({
          id: 'party-available-2026-07-18T19:00:00.000Z',
          date: '2026-07-18',
          kind: 'party-available',
          title: 'Party available · 2:00 PM',
          startTime: '14:00',
          href: '/book?start=2026-07-18T19%3A00%3A00.000Z',
        }),
      ],
      '2026-07-11'
    )
    const row = days[0].events[0]
    expect(row.title).toBe('Private party times')
    expect(row.openCount).toBe(1)
    expect(row.href).toBe('/book?start=2026-07-18T19%3A00%3A00.000Z')
  })

  it('never puts an emoji on a party row', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'p1', kind: 'party-available', startTime: '09:00' }),
        ev({ id: 'p2', kind: 'party-available', startTime: '11:30' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events[0].title).not.toMatch(/🎉/)
  })

  it('orders a day by start time, earliest first, with party times at their first open slot', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'booked', kind: 'party-booked', bookable: false, startTime: '14:00' }),
        ev({ id: 'w-late', kind: 'workshop', startTime: '19:00' }),
        ev({ id: 'p1', kind: 'party-available', startTime: '09:00' }),
        ev({ id: 'studio', kind: 'open-studio', bookable: false, startTime: '10:00' }),
        ev({ id: 'p2', kind: 'party-available', startTime: '11:30' }),
        ev({ id: 'w-early', kind: 'workshop', startTime: '16:00' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events.map((e) => e.id)).toEqual([
      'party-available-agg-2026-07-18', // 9:00 AM, its earliest open slot
      'studio', // 10:00 AM
      'party-booked-agg-2026-07-18', // 2:00 PM, the one booked party
      'w-early', // 4:00 PM
      'w-late', // 7:00 PM
    ])
  })

  it('treats every kind of row the same: only the start time decides', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'w-closed', kind: 'workshop', bookable: false, startTime: '10:00' }),
        ev({ id: 'w-open', kind: 'workshop', startTime: '19:00' }),
        ev({ id: 'p1', kind: 'party-available', startTime: '14:00' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events.map((e) => e.id)).toEqual(['w-closed', 'p1', 'w-open'])
  })

  it('puts the party first when it starts at the same time as something else', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'w', kind: 'workshop', startTime: '16:30' }),
        ev({ id: 'p1', kind: 'party-available', startTime: '16:30' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events.map((e) => e.id)).toEqual(['p1', 'w'])
  })

  it('collapses booked parties into one row per day, at the earliest one\'s time', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'b2', kind: 'party-booked', bookable: false, title: 'Booked · private party', startTime: '14:00' }),
        ev({ id: 'b1', kind: 'party-booked', bookable: false, title: 'Booked · private party', startTime: '09:00' }),
        ev({ id: 'b3', kind: 'party-booked', bookable: false, title: 'Booked · private party', startTime: '16:30' }),
        ev({ id: 'w', kind: 'workshop', startTime: '19:00' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events.map((e) => e.id)).toEqual(['party-booked-agg-2026-07-18', 'w'])
    const row = days[0].events[0]
    expect(row).toMatchObject({
      kind: 'party-booked',
      title: '3 parties booked',
      bookedCount: 3,
      startTime: '09:00',
      bookable: false,
    })
    expect(row.href).toBeUndefined()
  })

  it('says "1 party booked" for a single booked party', () => {
    const days = groupEventsByDay(
      [ev({ id: 'b1', kind: 'party-booked', bookable: false, title: 'Booked · private party', startTime: '13:00' })],
      '2026-07-11'
    )
    expect(days[0].events).toHaveLength(1)
    expect(days[0].events[0]).toMatchObject({ title: '1 party booked', bookedCount: 1, startTime: '13:00' })
  })

  it('keeps booked parties on different days apart', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'b1', kind: 'party-booked', bookable: false, date: '2026-07-18', startTime: '13:00' }),
        ev({ id: 'b2', kind: 'party-booked', bookable: false, date: '2026-07-19', startTime: '14:00' }),
      ],
      '2026-07-11'
    )
    expect(days.map((d) => d.events.map((e) => e.title))).toEqual([['1 party booked'], ['1 party booked']])
  })

  it('leads the day with a row that has no time, such as the Grand Opening', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'w', kind: 'workshop', startTime: '19:00' }),
        ev({ id: 'opening', kind: 'event', bookable: false, startTime: undefined }),
        ev({ id: 'p1', kind: 'party-available', startTime: '09:00' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events.map((e) => e.id)).toEqual(['opening', 'p1', 'w'])
  })
})

describe('formatTimeRange', () => {
  it('shows AM/PM once when both ends share it, and drops ":00"', () => {
    expect(formatTimeRange('19:00', '21:00')).toBe('7–9 PM')
    expect(formatTimeRange('09:00', '11:00')).toBe('9–11 AM')
  })

  it('shows AM/PM on both ends when they differ', () => {
    expect(formatTimeRange('09:00', '12:30')).toBe('9:00 AM–12:30 PM')
    expect(formatTimeRange('11:30', '13:00')).toBe('11:30 AM–1 PM')
    expect(formatTimeRange('09:00', '12:00')).toBe('9 AM–12 PM')
  })

  it('keeps minutes that are not ":00"', () => {
    expect(formatTimeRange('16:30', '18:00')).toBe('4:30–6 PM')
    expect(formatTimeRange('16:30', '18:45')).toBe('4:30–6:45 PM')
  })

  it('keeps ":00" on the start when the end carries minutes', () => {
    expect(formatTimeRange('19:00', '21:30')).toBe('7:00–9:30 PM')
  })

  it('treats noon and midnight as 12', () => {
    expect(formatTimeRange('12:00', '14:00')).toBe('12–2 PM')
    expect(formatTimeRange('00:00', '01:00')).toBe('12–1 AM')
  })

  it('uses an en dash, never a hyphen', () => {
    expect(formatTimeRange('19:00', '21:00')).toContain('–')
    expect(formatTimeRange('19:00', '21:00')).not.toContain('-')
  })

  it('falls back to a single clock time when there is no end', () => {
    expect(formatTimeRange('14:00')).toBe('2:00 PM')
  })

  it('returns an empty string without a usable start', () => {
    expect(formatTimeRange()).toBe('')
    expect(formatTimeRange('', '21:00')).toBe('')
    expect(formatTimeRange('nonsense', '21:00')).toBe('')
  })
})

describe('formatClock', () => {
  it('formats a 24h "HH:MM" as a 12-hour clock time', () => {
    expect(formatClock('09:00')).toBe('9:00 AM')
    expect(formatClock('16:30')).toBe('4:30 PM')
    expect(formatClock('12:00')).toBe('12:00 PM')
    expect(formatClock('00:15')).toBe('12:15 AM')
  })

  it('returns an empty string for a missing time', () => {
    expect(formatClock()).toBe('')
  })
})

describe('formatPrice', () => {
  it('drops the cents on whole dollars', () => {
    expect(formatPrice(3500)).toBe('$35')
    expect(formatPrice(10000, 'USD')).toBe('$100')
  })

  it('shows two decimals otherwise', () => {
    expect(formatPrice(3250)).toBe('$32.50')
    expect(formatPrice(3205)).toBe('$32.05')
  })

  it('returns an empty string when there is no price to show', () => {
    expect(formatPrice()).toBe('')
    expect(formatPrice(0)).toBe('')
  })
})

describe('seatsLeftLabel', () => {
  it('is shown only when 8 or fewer seats remain', () => {
    expect(seatsLeftLabel(8)).toBe('8 seats left')
    expect(seatsLeftLabel(3)).toBe('3 seats left')
    expect(seatsLeftLabel(9)).toBe('')
    expect(seatsLeftLabel(20)).toBe('')
  })

  it('uses the singular for one seat', () => {
    expect(seatsLeftLabel(1)).toBe('1 seat left')
  })

  it('is empty when the count is unknown or not positive', () => {
    expect(seatsLeftLabel()).toBe('')
    expect(seatsLeftLabel(0)).toBe('')
  })
})

describe('listRowMeta', () => {
  it('reads "Workshop · time range · price" for a workshop', () => {
    const e = ev({ startTime: '19:00', endTime: '21:00', price: 3500, currency: 'USD', remainingSeats: 12 })
    expect(listRowMeta(e)).toBe('Workshop · 7–9 PM · $35')
  })

  it('adds seats left when 8 or fewer remain', () => {
    const e = ev({ startTime: '19:00', endTime: '21:00', price: 3250, currency: 'USD', remainingSeats: 1 })
    expect(listRowMeta(e)).toBe('Workshop · 7–9 PM · $32.50 · 1 seat left')
  })

  it('reads "{n} open · from {first open time}" for party times', () => {
    const e = ev({ kind: 'party-available', title: 'Private party times', startTime: '09:00', openCount: 4 })
    expect(listRowMeta(e)).toBe('4 open · from 9:00 AM')
  })

  it('counts an uncollapsed party slot as one open time', () => {
    const e = ev({ kind: 'party-available', startTime: '14:00' })
    expect(listRowMeta(e)).toBe('1 open · from 2:00 PM')
  })

  it('reads "Walk-in · time range" for open studio', () => {
    const e = ev({ kind: 'open-studio', title: 'Craft Café', bookable: false, startTime: '16:00', endTime: '21:00' })
    expect(listRowMeta(e)).toBe('Walk-in · 4–9 PM')
  })

  it('shows just the start time for a booked party', () => {
    const e = ev({ kind: 'party-booked', title: '1 party booked', bookedCount: 1, bookable: false, startTime: '14:00' })
    expect(listRowMeta(e)).toBe('2:00 PM')
  })

  it('reads "from {earliest}" when several parties are booked that day', () => {
    const e = ev({ kind: 'party-booked', title: '3 parties booked', bookedCount: 3, bookable: false, startTime: '09:00' })
    expect(listRowMeta(e)).toBe('from 9:00 AM')
  })

  it('reads "Event" for a marker with nothing else to say', () => {
    const e = ev({ kind: 'event', title: 'Holiday market', bookable: false })
    expect(listRowMeta(e)).toBe('Event')
  })

  it('reads the event\'s own line, with no time, when it has one (the Grand Opening)', () => {
    const e = ev({
      kind: 'event',
      title: 'Grand Opening',
      detail: 'Doors open. Come see the studio.',
      bookable: false,
      href: '/',
    })
    expect(listRowMeta(e)).toBe('Doors open. Come see the studio.')
  })

  it('reads "Sold out" after the price when no seats are left', () => {
    const e = ev({
      startTime: '19:00',
      endTime: '21:00',
      price: 3500,
      currency: 'USD',
      remainingSeats: 0,
      soldOut: true,
      bookable: false,
    })
    expect(listRowMeta(e)).toBe('Workshop · 7–9 PM · $35 · Sold out')
  })
})

describe('listRowAction', () => {
  it('is "Book ›" for a bookable workshop', () => {
    expect(listRowAction(ev({ href: '/workshops?w=abc' }))).toBe('Book ›')
  })

  it('is "Pick a time ›" for party availability', () => {
    expect(listRowAction(ev({ kind: 'party-available', href: '/book?date=2026-07-18' }))).toBe('Pick a time ›')
  })

  it('is nothing for rows that cannot be booked, even when they link somewhere', () => {
    expect(listRowAction(ev({ kind: 'open-studio', bookable: false, href: '/craft-cafe' }))).toBeNull()
    expect(listRowAction(ev({ kind: 'party-booked', bookable: false }))).toBeNull()
    expect(listRowAction(ev({ kind: 'event', bookable: false }))).toBeNull()
  })

  it('is nothing for a bookable row with nowhere to go', () => {
    expect(listRowAction(ev({ href: undefined }))).toBeNull()
  })
})

const workshop = (over: Record<string, unknown> = {}) =>
  ({
    id: 'w1',
    scheduleId: 's1',
    name: 'Fall Earring Bar',
    description: '',
    descriptionHtml: '',
    startAt: '2026-10-24T00:00:00.000Z', // 7 PM CDT on Oct 23
    durationMinutes: 120,
    priceCents: 3500,
    priceCurrency: 'USD',
    availableCapacity: 6,
    staffName: '',
    teamMemberId: '',
    ...over,
  }) as any

describe('buildCalendarEvents — workshop details', () => {
  it('carries price, currency, end time and remaining seats from the provider', () => {
    const [e] = buildCalendarEvents([workshop()], [])
    expect(e).toMatchObject({
      id: 'workshop-w1',
      kind: 'workshop',
      title: 'Fall Earring Bar',
      date: '2026-10-23',
      startTime: '19:00',
      endTime: '21:00',
      price: 3500,
      currency: 'USD',
      remainingSeats: 6,
      bookable: true,
      href: '/workshops?w=w1',
    })
  })
})

describe('buildCalendarEvents — links and titles', () => {
  it('makes Craft Café tappable at the source without making it bookable', () => {
    const [e] = buildCalendarEvents([], [{ date: '2026-12-03', startTime: '16:00', endTime: '21:00' }])
    expect(e.kind).toBe('open-studio')
    expect(e.href).toBe('/craft-cafe')
    expect(e.bookable).toBe(false)
  })

  it('keeps party deep links slot-specific', () => {
    const [e] = buildCalendarEvents([], [], [{ startAt: '2026-10-17T14:00:00.000Z' }])
    expect(e.href).toBe('/book?start=2026-10-17T14%3A00%3A00.000Z')
  })

  it('has no emoji on booked party rows', () => {
    const [e] = buildCalendarEvents([], [], [], [{ startAt: '2026-10-17T19:00:00.000Z' }])
    expect(e.kind).toBe('party-booked')
    expect(e.title).not.toMatch(/🎉/)
    expect(e.href).toBeUndefined()
  })
})

// Server runs in UTC (Netlify) — studio-local rendering must not depend on the
// process timezone. 6 PM CDT = 23:00 UTC same day; 8 PM CDT = 01:00 UTC NEXT day.
describe('buildCalendarEvents — studio timezone', () => {
  it('renders workshop times and dates in America/Chicago regardless of server TZ', async () => {
    const events = buildCalendarEvents(
      [
        { id: 'w1', name: 'Evening 6pm', startAt: '2026-08-21T23:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', durationMinutes: 180, priceCents: 3000, seatsLeft: 10 },
        { id: 'w2', name: 'Evening 8pm', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T03:00:00.000Z', durationMinutes: 120, priceCents: 3000, seatsLeft: 10 },
      ] as any,
      [],
      [],
      [],
    )
    const w1 = events.find((e: any) => e.id?.includes('w1') || e.title?.includes('6pm'))
    const w2 = events.find((e: any) => e.id?.includes('w2') || e.title?.includes('8pm'))
    expect(w1?.startTime).toBe('18:00')
    expect(w1?.date).toBe('2026-08-21')
    expect(w2?.startTime).toBe('20:00') // NOT 01:00
    expect(w2?.date).toBe('2026-08-21') // NOT the UTC next day
  })
})

describe('a workshop with no price yet', () => {
  it('is on the calendar but cannot be booked from it', () => {
    const [e] = buildCalendarEvents([workshop({ priceCents: 0 })], [])
    expect(e).toMatchObject({ kind: 'workshop', comingSoon: true, bookable: false, href: '/workshops' })
  })

  it('reads "Coming soon" where the price would be, with no booking cue', () => {
    const [e] = buildCalendarEvents([workshop({ priceCents: 0 })], [])
    expect(listRowMeta(e).replaceAll('\u00a0', ' ')).toBe('Workshop · 7–9 PM · Coming soon')
    expect(listRowAction(e)).toBeNull()
  })

  it('leaves a priced workshop bookable', () => {
    const [e] = buildCalendarEvents([workshop()], [])
    expect(e.comingSoon).toBeUndefined()
    expect(listRowAction(e)).toBe('Book ›')
  })
})

describe('a workshop with no seats left (HOM-190)', () => {
  it('stays on the calendar, marked sold out, and leads to its own panel on the workshops page', () => {
    const [e] = buildCalendarEvents([workshop({ availableCapacity: 0 })], [])
    expect(e).toMatchObject({
      kind: 'workshop',
      soldOut: true,
      bookable: false,
      href: '/workshops?w=w1',
      remainingSeats: 0,
    })
    expect(e.comingSoon).toBeUndefined()
  })

  it('reads "Workshop · 7–9 PM · $35 · Sold out" with no booking cue', () => {
    const [e] = buildCalendarEvents([workshop({ availableCapacity: 0 })], [])
    expect(listRowMeta(e)).toBe('Workshop · 7–9 PM · $35 · Sold out')
    expect(listRowAction(e)).toBeNull()
  })

  it('is "Coming soon", not "Sold out", when it has no price either', () => {
    const [e] = buildCalendarEvents([workshop({ priceCents: 0, availableCapacity: 0 })], [])
    expect(e).toMatchObject({ comingSoon: true, bookable: false, href: '/workshops' })
    expect(e.soldOut).toBeUndefined()
    expect(listRowMeta(e)).toBe('Workshop · 7–9 PM · Coming soon')
  })

  it('does not mark a workshop with seats as sold out', () => {
    const [e] = buildCalendarEvents([workshop({ availableCapacity: 1 })], [])
    expect(e.soldOut).toBeUndefined()
    expect(e.bookable).toBe(true)
  })
})

describe('matchesFilter (HOM-192)', () => {
  const rows = [
    ev({ id: 'w', kind: 'workshop' }),
    ev({ id: 'pa', kind: 'party-available' }),
    ev({ id: 'pb', kind: 'party-booked', bookable: false }),
    ev({ id: 'os', kind: 'open-studio', bookable: false }),
    ev({ id: 'go', kind: 'event', bookable: false }),
  ]
  const shown = (filter: Parameters<typeof matchesFilter>[1]) =>
    rows.filter((e) => matchesFilter(e, filter)).map((e) => e.id)

  it('"Everything" shows every kind of row', () => {
    expect(shown('all')).toEqual(['w', 'pa', 'pb', 'os', 'go'])
  })

  it('"Workshops" shows workshops only', () => {
    expect(shown('workshops')).toEqual(['w'])
  })

  it('"Party dates" shows open party times and booked parties, nothing else', () => {
    expect(shown('parties')).toEqual(['pa', 'pb'])
  })
})

describe('collapseBookedParties', () => {
  it('turns a day\'s booked parties into one entry and leaves the rest alone', () => {
    const out = collapseBookedParties([
      ev({ id: 'b1', kind: 'party-booked', bookable: false, startTime: '09:00' }),
      ev({ id: 'b2', kind: 'party-booked', bookable: false, startTime: '11:30' }),
      ev({ id: 'b3', kind: 'party-booked', bookable: false, startTime: '14:00' }),
      ev({ id: 'b4', kind: 'party-booked', bookable: false, startTime: '16:30' }),
      ev({ id: 'w', kind: 'workshop', startTime: '19:00' }),
    ])
    expect(out.map((e) => e.title)).toEqual(['4 parties booked', 'T'])
    expect(out[0]).toMatchObject({ id: 'party-booked-agg-2026-07-18', startTime: '09:00', bookedCount: 4 })
  })

  it('returns the day unchanged when no party is booked', () => {
    const day = [ev({ id: 'w', kind: 'workshop', startTime: '19:00' })]
    expect(collapseBookedParties(day)).toEqual(day)
  })
})
