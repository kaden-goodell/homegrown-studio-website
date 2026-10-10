import { describe, it, expect, vi } from 'vitest'
import { closures, closureOn, studioOpenOn, daysOf, reopensOn, type Closure } from '@config/closures'
import { bookableOn, partyStartsForDate, partyStartsInRange } from '@lib/party-slots'

// These tests pin the normal weekly rules; one-off party days
// (partyDateOverrides) are covered in party-date-overrides.test.ts.
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../src/config/party.config')>()), partyDateOverrides: {} }))


const HALLOWEEN: Closure = { from: '2026-10-30', to: '2026-11-01', name: 'Halloween weekend', holiday: 'halloween' }
const CHRISTMAS: Closure = { from: '2026-12-21', to: '2027-01-01', name: 'the Christmas holidays', holiday: 'christmas' }

describe('the list of closed days', () => {
  it('closes Friday to Sunday of Halloween weekend, and 21 December to New Year\'s Day', () => {
    expect(closures).toContainEqual(HALLOWEEN)
    expect(closures).toContainEqual(CHRISTMAS)
  })

  it('is well formed: real dates, first day not after the last, a name to say', () => {
    for (const c of closures) {
      expect(c.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(c.from))).toBe(false)
      expect(Number.isNaN(Date.parse(c.to))).toBe(false)
      expect(c.from <= c.to).toBe(true)
      expect(c.name.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('closureOn', () => {
  it('covers both ends and everything between', () => {
    expect(closureOn('2026-10-30')?.name).toBe('Halloween weekend')
    expect(closureOn('2026-10-31')?.name).toBe('Halloween weekend')
    expect(closureOn('2026-11-01')?.name).toBe('Halloween weekend')
  })

  it('leaves the days either side alone', () => {
    expect(closureOn('2026-10-29')).toBeNull()
    expect(closureOn('2026-11-02')).toBeNull()
    expect(closureOn('2026-10-24')).toBeNull()
  })
})

describe('studioOpenOn', () => {
  it('is open Thursday to Sunday', () => {
    expect(studioOpenOn('2026-10-22')).toBe(true) // Thu
    expect(studioOpenOn('2026-10-25')).toBe(true) // Sun
  })

  it('is closed Monday to Wednesday', () => {
    expect(studioOpenOn('2026-10-26')).toBe(false)
    expect(studioOpenOn('2026-10-28')).toBe(false)
  })

  it('is closed on a day inside a closure, whatever the weekday', () => {
    expect(studioOpenOn('2026-10-31')).toBe(false) // Sat
    expect(studioOpenOn('2026-12-25')).toBe(false) // Fri
  })
})

describe('where a closure shows on the calendar', () => {
  it('shows on every one of its days, Monday to Wednesday included', () => {
    expect(daysOf(HALLOWEEN)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(daysOf(CHRISTMAS)).toEqual([
      '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27',
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',
    ])
  })

  it('names the first open day after it', () => {
    expect(reopensOn(HALLOWEEN)).toBe('2026-11-05') // Thu
    expect(reopensOn(CHRISTMAS)).toBe('2027-01-02') // Sat
  })

  it('skips a second closure that follows straight on', () => {
    const list = [CHRISTMAS, { from: '2027-01-02', to: '2027-01-03', name: 'New Year' }]
    expect(reopensOn(CHRISTMAS, list)).toBe('2027-01-07')
  })
})

describe('party dates on a closed day', () => {
  // Far enough ahead of both closures that the window rules say yes.
  const beforeHalloween = new Date('2026-10-10T15:00:00Z')
  const beforeChristmas = new Date('2026-12-01T15:00:00Z')

  it('says why', () => {
    // Halloween weekend falls before parties start (Sat 7 Nov), so the opening date answers first.
    expect(bookableOn('2026-10-31', beforeHalloween)).toBe('before_opening')
    expect(bookableOn('2026-12-26', beforeChristmas)).toBe('closed')
  })

  it('offers no times', () => {
    expect(partyStartsForDate('2026-10-31', beforeHalloween)).toEqual([])
    expect(partyStartsForDate('2026-11-01', beforeHalloween)).toEqual([])
    expect(partyStartsForDate('2026-12-26', beforeChristmas)).toEqual([])
    expect(partyStartsForDate('2026-12-27', beforeChristmas)).toEqual([])
    // Open again on Saturday 2 January.
    expect(partyStartsForDate('2027-01-02', beforeChristmas).length).toBe(1)
  })

  it('still offers the weekends either side', () => {
    expect(partyStartsForDate('2026-10-24', beforeHalloween)).toEqual([]) // before parties start
    expect(partyStartsForDate('2026-11-07', beforeHalloween).length).toBe(1) // Saturday: 1:30 only
    expect(partyStartsForDate('2026-11-08', beforeHalloween).length).toBe(2) // Sunday: 1:00, 3:30
    expect(partyStartsForDate('2026-12-19', beforeChristmas).length).toBe(1)
    expect(partyStartsForDate('2026-12-20', beforeChristmas).length).toBe(2)
  })

  it('leaves the closed weekend out of a run of dates', () => {
    const starts = partyStartsInRange('2026-12-18T05:00:00Z', '2027-01-04T05:00:00Z', beforeChristmas)
    const days = Array.from(new Set(starts.map((s) => new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))))
    expect(days).toEqual(['2026-12-19', '2026-12-20', '2027-01-02', '2027-01-03'])
  })
})
