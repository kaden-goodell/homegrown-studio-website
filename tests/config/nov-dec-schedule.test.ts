import { describe, it, expect } from 'vitest'
import { cafeHoursOn, cafeWindowsOn, formatWindows } from '@config/hours'
import { partyNoDates } from '@config/party.config'
import { cafeRunsOn } from '@lib/cafe-days'
import { localToUtcISO, partyStartsForDate } from '@lib/party-slots'
import { buildCalendarEvents } from '@components/calendar/calendar-view-model'
import { parseOpenStudioWindows } from '@lib/open-studio'

// Kaden, 15 Nov 2026: Nov 20 to Dec 20. Fridays and Saturdays are Craft Café
// (no parties); Sundays, Mon–Wed weeknights and Thursdays are unchanged.
// Noon Central on Tue 3 Nov: every date below is inside the booking window.
const NOW = new Date('2026-11-03T18:00:00.000Z')
const at = (day: string, hhmm: string) => localToUtcISO(day, hhmm)

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

const EXPECTED_CAFE: Record<string, { opens: string; closes: string }[]> = {
  '2026-11-21': [{ opens: '09:00', closes: '18:00' }],
  '2026-11-28': [{ opens: '09:00', closes: '13:00' }, { opens: '16:00', closes: '20:00' }],
  '2026-12-04': [{ opens: '16:00', closes: '20:00' }],
  '2026-12-05': [{ opens: '09:00', closes: '18:00' }],
  '2026-12-11': [{ opens: '16:00', closes: '20:00' }],
  '2026-12-12': [{ opens: '09:00', closes: '15:00' }],
  '2026-12-18': [{ opens: '16:00', closes: '20:00' }],
  '2026-12-19': [{ opens: '09:00', closes: '18:00' }],
}

/** What the schedule offers on each date (classes on the night take theirs away; see party-weeknight.test.ts). */
function expectedStarts(day: string): string[] {
  const wd = weekday(day)
  if (day === '2026-11-26') return [] // Thanksgiving (and a Thursday)
  if (wd === 0) return [at(day, '13:00'), at(day, '15:30')]
  if (wd >= 1 && wd <= 3) return [at(day, '18:00')]
  return [] // Thursday, and every Friday and Saturday in the run
}

describe('Nov 20 – Dec 20 schedule', () => {
  const days: string[] = []
  for (let d = '2026-11-20'; d <= '2026-12-20'; d = addDays(d, 1)) days.push(d)

  it.each(days)('%s offers the approved party starts', (day) => {
    expect(partyStartsForDate(day, NOW)).toEqual(expectedStarts(day))
  })

  it.each(days)('%s has the approved Craft Café windows', (day) => {
    const want = EXPECTED_CAFE[day] ?? []
    expect(cafeWindowsOn(day)).toEqual(want)
    expect(cafeRunsOn(day)).toBe(want.length > 0)
  })

  it('no Friday or Saturday party anywhere in the run, even Fri Nov 20 with no café', () => {
    const fridaysSaturdays = days.filter((d) => [5, 6].includes(weekday(d)))
    expect(fridaysSaturdays).toEqual([...partyNoDates])
    expect(cafeWindowsOn('2026-11-20')).toEqual([])
    for (const d of fridaysSaturdays) expect(partyStartsForDate(d, NOW)).toEqual([])
  })

  it('January weekends are back to normal', () => {
    expect(partyStartsForDate('2027-01-08', NOW)).toEqual([at('2027-01-08', '16:30')])
    expect(partyStartsForDate('2027-01-09', NOW)).toEqual([at('2027-01-09', '14:00'), at('2027-01-09', '16:30')])
    expect(cafeWindowsOn('2027-01-09')).toEqual([{ opens: '09:00', closes: '13:00' }])
  })
})

describe('more than one café window on a date', () => {
  it('Sat Nov 28 has both windows, earliest first, and one line for staff', () => {
    expect(cafeWindowsOn('2026-11-28')).toEqual([
      { opens: '09:00', closes: '13:00' },
      { opens: '16:00', closes: '20:00' },
    ])
    expect(formatWindows(cafeWindowsOn('2026-11-28'))).toBe('9 AM – 1 PM · 4 – 8 PM')
  })

  it('cafeHoursOn still answers with one span, first open to last close', () => {
    expect(cafeHoursOn('2026-11-28')).toEqual({ opens: '09:00', closes: '20:00' })
    expect(cafeHoursOn('2026-11-22')).toBeNull()
  })

  it('the public calendar shows both Nov 28 windows from the stored café windows', () => {
    const windows = parseOpenStudioWindows('2026-11-28T09:00-13:00,2026-11-28T16:00-20:00')
    const cafe = buildCalendarEvents([], windows).filter((e) => e.kind === 'open-studio')
    expect(cafe.map((e) => [e.date, e.startTime, e.endTime])).toEqual([
      ['2026-11-28', '09:00', '13:00'],
      ['2026-11-28', '16:00', '20:00'],
    ])
    expect(new Set(cafe.map((e) => e.id)).size).toBe(2)
  })
})
