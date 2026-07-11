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
