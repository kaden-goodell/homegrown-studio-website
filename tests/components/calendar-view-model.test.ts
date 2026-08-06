import { describe, it, expect } from 'vitest'
import { groupEventsByDay } from '@components/calendar/calendar-view-model'
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
        ev({ id: 'p1', date: '2026-07-18', kind: 'party-available' }),
        ev({ id: 'p2', date: '2026-07-18', kind: 'party-available' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events).toHaveLength(1)
    expect(days[0].events[0].kind).toBe('party-available')
    expect(days[0].events[0].title).toMatch(/2 party times open/)
    // Collapsed summary must link to the DAY, not inherit the first slot's
    // slot-specific href — same convention as the month grid's aggregation.
    expect(days[0].events[0].href).toBe('/book?date=2026-07-18')
  })
})


// Server runs in UTC (Netlify) — studio-local rendering must not depend on the
// process timezone. 6 PM CDT = 23:00 UTC same day; 8 PM CDT = 01:00 UTC NEXT day.
describe('buildCalendarEvents — studio timezone', () => {
  it('renders workshop times and dates in America/Chicago regardless of server TZ', async () => {
    const { buildCalendarEvents } = await import('@components/calendar/calendar-view-model')
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
