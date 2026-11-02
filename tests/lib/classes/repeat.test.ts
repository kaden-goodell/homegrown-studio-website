import { describe, it, expect } from 'vitest'
import { chicagoToIso, MAX_REPEATS, readPattern, repeatDates, shiftSessions, TOO_MANY, UNTIL_BEFORE_FIRST, UNTIL_PAST, PICK_A_DATE } from '@lib/classes/repeat'
import type { Session } from '@lib/classes/types'

const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', weekday: 'short' }).format(new Date(iso))
const ses = (ymd: string, h: number, len = 120, id = 'ses_1'): Session => {
  const startIso = chicagoToIso(ymd, h, 0)
  return { id, startIso, endIso: new Date(Date.parse(startIso) + len * 60_000).toISOString(), capacity: 10 }
}
const value = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('chicagoToIso', () => {
  it('uses the offset in force at that time', () => {
    expect(chicagoToIso('2026-10-22', 18, 0)).toBe('2026-10-22T23:00:00.000Z') // CDT, −5
    expect(chicagoToIso('2026-11-12', 18, 0)).toBe('2026-11-13T00:00:00.000Z') // CST, −6
    expect(chicagoToIso('2026-11-01', 3, 0)).toBe('2026-11-01T09:00:00.000Z') // just after the clock goes back
    expect(chicagoToIso('2027-03-14', 4, 0)).toBe('2027-03-14T09:00:00.000Z') // just after it goes forward
  })
})

describe('repeatDates', () => {
  it('across the clock change: weekly 6 PM Thursdays Oct 22 → Nov 12 stay 6 PM Chicago', () => {
    const dates = value(repeatDates([ses('2026-10-22', 18)], { every: 1, untilYmd: '2026-11-12' }, '2026-10-01'))
    expect(dates.map((d) => d.ymd)).toEqual(['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12'])
    for (const d of dates) {
      expect(clock(d.sessions[0].startIso)).toBe('Thu 6:00 PM')
      expect(clock(d.sessions[0].endIso)).toBe('Thu 8:00 PM')
    }
    // The UTC hour moves after Nov 1 instead.
    expect(dates[1].sessions[0].startIso).toBe('2026-10-29T23:00:00.000Z')
    expect(dates[2].sessions[0].startIso).toBe('2026-11-06T00:00:00.000Z')
  })

  it('the first copy is the class as entered, ids kept; copies get no id (the server gives new ones)', () => {
    const dates = value(repeatDates([ses('2026-10-22', 18)], { every: 1, untilYmd: '2026-10-29' }, '2026-10-01'))
    expect(dates[0].sessions[0].id).toBe('ses_1')
    expect(dates[1].sessions[0].id).toBe('')
  })

  it('every 2 weeks, until included', () => {
    const dates = value(repeatDates([ses('2026-10-22', 18)], { every: 2, untilYmd: '2026-11-19' }, '2026-10-01'))
    expect(dates.map((d) => d.ymd)).toEqual(['2026-10-22', '2026-11-05', '2026-11-19'])
  })

  it('picked dates sorted and de-duplicated; the entered day counted once', () => {
    const dates = value(repeatDates([ses('2026-10-22', 18)], { dates: ['2026-12-03', '2026-11-05', '2026-12-03', '2026-10-22'] }, '2026-10-01'))
    expect(dates.map((d) => d.ymd)).toEqual(['2026-10-22', '2026-11-05', '2026-12-03'])
    expect(clock(dates[2].sessions[0].startIso)).toBe('Thu 6:00 PM')
  })

  it('a picked date on another weekday keeps the time', () => {
    const dates = value(repeatDates([ses('2026-10-22', 18)], { dates: ['2026-11-08'] }, '2026-10-01'))
    expect(clock(dates[1].sessions[0].startIso)).toBe('Sun 6:00 PM')
  })

  it('refusals: until before (or on) the first date, until passed, no picked date, more than 26', () => {
    const first = [ses('2026-10-22', 18)]
    expect(repeatDates(first, { every: 1, untilYmd: '2026-10-21' }, '2026-10-01')).toEqual({ ok: false, error: UNTIL_BEFORE_FIRST })
    expect(repeatDates(first, { every: 1, untilYmd: '2026-10-22' }, '2026-10-01')).toEqual({ ok: false, error: UNTIL_BEFORE_FIRST })
    expect(repeatDates(first, { every: 1, untilYmd: '2026-10-25' }, '2026-10-30')).toEqual({ ok: false, error: UNTIL_PAST })
    expect(repeatDates(first, { dates: ['2026-10-22'] }, '2026-10-01')).toEqual({ ok: false, error: PICK_A_DATE })
    expect(TOO_MANY).toBe('Repeat up to 26 dates at a time.')
    // 26 weekly dates is fine, 27 isn't.
    expect(value(repeatDates(first, { every: 1, untilYmd: '2027-04-15' }, '2026-10-01'))).toHaveLength(MAX_REPEATS)
    expect(repeatDates(first, { every: 1, untilYmd: '2027-04-22' }, '2026-10-01')).toEqual({ ok: false, error: TOO_MANY })
    const many = Array.from({ length: 26 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`)
    expect(repeatDates(first, { dates: many }, '2026-10-01')).toEqual({ ok: false, error: TOO_MANY })
  })

  it('a multi-session camp moves every session together, each keeping its local times', () => {
    const camp = [ses('2026-10-26', 9, 180, 'a'), ses('2026-10-27', 9, 180, 'b'), ses('2026-10-28', 13, 60, 'c')]
    const dates = value(repeatDates(camp, { every: 1, untilYmd: '2026-11-02' }, '2026-10-01'))
    expect(dates).toHaveLength(2)
    expect(dates[1].sessions.map((s) => clock(s.startIso))).toEqual(['Mon 9:00 AM', 'Tue 9:00 AM', 'Wed 1:00 PM'])
    expect(dates[1].sessions.map((s) => s.startIso.slice(0, 10))).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(dates[1].sessions.every((s) => s.capacity === 10)).toBe(true)
  })

  it('a session that ends after midnight keeps both ends', () => {
    const late = shiftSessions([{ id: 'x', startIso: chicagoToIso('2026-10-30', 22, 0), endIso: chicagoToIso('2026-10-31', 1, 0), capacity: 5 }], 7)
    expect(clock(late[0].startIso)).toBe('Fri 10:00 PM')
    expect(clock(late[0].endIso)).toBe('Sat 1:00 AM')
  })
})

describe('readPattern', () => {
  it('checks what the browser sent', () => {
    expect(readPattern({ every: 1, untilYmd: '2026-11-12' }).ok).toBe(true)
    expect(readPattern({ every: 3, untilYmd: '2026-11-12' }).ok).toBe(false)
    expect(readPattern({ every: 2 })).toEqual({ ok: false, error: 'Pick an until date.' })
    expect(readPattern({ dates: ['2026-02-30'] }).ok).toBe(false)
    expect(readPattern(null).ok).toBe(false)
  })
})
