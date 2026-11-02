import { describe, it, expect } from 'vitest'
import {
  eventKeyOf, isEventKey, verdict, verdictWithNote, neededFor, staffedState, validateAvailability, movedSince, DEFAULT_NEEDED,
} from '@lib/staffing/rules'
import type { Availability, DayMark, StaffingEntry, StaffableEvent } from '@lib/staffing/types'

const by = { id: 'TM1', name: 'Kaden' }
const avail = (weekly: Availability['weekly'], dates: Availability['dates'] = {}): Availability => ({
  staffId: 'TM2', name: 'Jessica', weekly, dates, updatedAt: '2026-10-01T00:00:00.000Z', history: [],
})
const can = (from?: string, to?: string, note = ''): DayMark => ({ kind: 'can', range: from ? { from, to: to! } : null, note })
const cant = (from?: string, to?: string, note = ''): DayMark => ({ kind: 'cant', range: from ? { from, to: to! } : null, note })
const entry = (over: Partial<StaffingEntry> = {}): StaffingEntry => ({
  key: 'ses:ses_1', needed: null, assigned: [], asks: [], seen: null, sequence: 0, updatedAt: null, history: [], ...over,
})
const person = (id: string) => ({ staffId: id, name: id, by, at: '2026-10-01T00:00:00.000Z', notified: null })

// Sat Oct 31 2026 is CDT (UTC−5); Sun Nov 1 the clock goes back to CST (UTC−6) at 2 AM.
const satAt = (h: number, len = 2) => ({
  startIso: new Date(Date.UTC(2026, 9, 31, h + 5)).toISOString(),
  endIso: new Date(Date.UTC(2026, 9, 31, h + 5 + len)).toISOString(),
})

describe('eventKeyOf', () => {
  it('maps every Busy kind', () => {
    expect(eventKeyOf({ kind: 'class', id: 'cls_1', sessionId: 'ses_9' })).toBe('ses:ses_9')
    expect(eventKeyOf({ kind: 'class', id: 'cls_1' })).toBeNull()
    expect(eventKeyOf({ kind: 'party', id: 'pty_abc' })).toBe('party:pty_abc')
    expect(eventKeyOf({ kind: 'party', id: 'SQBOOKING1' })).toBe('party:SQBOOKING1')
    expect(eventKeyOf({ kind: 'legacy-class', id: 'SCHED1' })).toBe('legacy:SCHED1')
    for (const kind of ['cafe', 'blocked', 'closed']) expect(eventKeyOf({ kind, id: 'x' })).toBeNull()
    expect(eventKeyOf({ kind: 'party', id: '' })).toBeNull()
  })
  it('isEventKey accepts only the three shapes with plain ids', () => {
    expect(isEventKey('ses:ses_1')).toBe(true)
    expect(isEventKey('party:pty_ab-c')).toBe(true)
    expect(isEventKey('legacy:ABC123')).toBe(true)
    for (const bad of ['', 'cafe:x', 'ses:', 'ses:a/b', 'ses:a b', 'party:../x', 42, null, `ses:${'a'.repeat(200)}`]) {
      expect(isEventKey(bad)).toBe(false)
    }
  })
})

describe('verdict', () => {
  it('unknown with nothing said', () => {
    expect(verdict(null, satAt(10))).toBe('unknown')
    expect(verdict(avail({}), satAt(10))).toBe('unknown')
  })
  it('can, partly and cant from the weekly mark', () => {
    expect(verdict(avail({ '6': can() }), satAt(10))).toBe('can')
    expect(verdict(avail({ '6': can('09:00', '17:00') }), satAt(10))).toBe('can')
    expect(verdict(avail({ '6': can('09:00', '11:00') }), satAt(10))).toBe('partly')
    expect(verdict(avail({ '6': can('13:00', '17:00') }), satAt(10))).toBe('unknown')
    expect(verdict(avail({ '6': cant() }), satAt(10))).toBe('cant')
    expect(verdict(avail({ '6': cant('11:00', '12:00') }), satAt(10))).toBe('cant')
    expect(verdict(avail({ '6': cant('12:00', '13:00') }), satAt(10))).toBe('unknown') // touching is not overlapping
  })
  it('two can ranges that together cover the event are can', () => {
    expect(verdict(avail({}, { '2026-10-31': [can('09:00', '11:00'), can('11:00', '13:00')] }), satAt(10))).toBe('can')
  })
  it('date marks replace the weekly mark for that whole day', () => {
    const a = avail({ '6': can() }, { '2026-10-31': [cant('09:00', '12:00')] })
    expect(verdict(a, satAt(10))).toBe('cant')
    expect(verdict(a, satAt(14))).toBe('unknown')
    // another Saturday still uses the weekly mark
    expect(verdict(a, { startIso: '2026-11-07T16:00:00.000Z', endIso: '2026-11-07T18:00:00.000Z' })).toBe('can')
  })
  it('across the clock change: can\'t 5–9 PM on Sun Nov 1 refuses 6 PM and allows 4 PM', () => {
    const a = avail({}, { '2026-11-01': [cant('17:00', '21:00')] })
    // 6 PM CST on Nov 1 = 00:00Z on Nov 2
    expect(verdict(a, { startIso: '2026-11-02T00:00:00.000Z', endIso: '2026-11-02T02:00:00.000Z' })).toBe('cant')
    // 4 PM CST = 22:00Z; ends 5 PM exactly
    expect(verdict(a, { startIso: '2026-11-01T22:00:00.000Z', endIso: '2026-11-01T23:00:00.000Z' })).not.toBe('cant')
  })
  it('all-day marks and a range ending 24:00', () => {
    expect(verdict(avail({ '0': cant() }), { startIso: '2026-11-02T01:00:00.000Z', endIso: '2026-11-02T03:00:00.000Z' })).toBe('cant') // Sun 7–9 PM CST
    const late = { startIso: '2026-11-01T03:00:00.000Z', endIso: '2026-11-01T05:00:00.000Z' } // Sat Oct 31 10 PM – midnight CDT
    expect(verdict(avail({ '6': can('20:00', '24:00') }), late)).toBe('can')
  })
  it('an event touching two days checks both', () => {
    const ev = { startIso: '2026-11-01T04:00:00.000Z', endIso: '2026-11-01T06:00:00.000Z' } // Sat 11 PM CDT – Sun 1 AM CDT
    expect(verdict(avail({ '6': can('20:00', '24:00'), '0': can() }), ev)).toBe('can')
    expect(verdict(avail({ '6': can('20:00', '24:00') }), ev)).toBe('partly')
    expect(verdict(avail({ '6': can('20:00', '24:00'), '0': cant('00:00', '01:00') }), ev)).toBe('cant')
  })
})

describe('neededFor and staffedState', () => {
  it('defaults to one for every kind; owners can set 0..6', () => {
    expect(DEFAULT_NEEDED).toEqual({ class: 1, party: 1, 'legacy-class': 1 })
    expect(neededFor(null, 'class')).toBe(1)
    expect(neededFor(entry({ needed: 2 }), 'party')).toBe(2)
    expect(neededFor(entry({ needed: 0 }), 'class')).toBe(0)
  })
  it('none / short / staffed with needed 1 and 2', () => {
    expect(staffedState(null, 'class')).toBe('none')
    expect(staffedState(entry({ assigned: [person('a')] }), 'class')).toBe('staffed')
    expect(staffedState(entry({ needed: 2 }), 'class')).toBe('none')
    expect(staffedState(entry({ needed: 2, assigned: [person('a')] }), 'class')).toBe('short')
    expect(staffedState(entry({ needed: 2, assigned: [person('a'), person('b')] }), 'class')).toBe('staffed')
  })
  it('needed 0 is always staffed', () => {
    expect(staffedState(entry({ needed: 0 }), 'party')).toBe('staffed')
  })
  it('only people who still count are counted', () => {
    const e = entry({ assigned: [person('gone')] })
    expect(staffedState(e, 'class', (id) => id !== 'gone')).toBe('none')
  })
})

describe('movedSince', () => {
  const ev: StaffableEvent = {
    key: 'ses:ses_1', kind: 'class', title: 'Needlepoint 101', startIso: '2026-10-25T18:00:00.000Z', endIso: '2026-10-25T20:00:00.000Z',
    status: 'on', openHref: '#class-cls_1', detail: {},
  }
  it('false with nothing seen or the same times; true when either time changed', () => {
    expect(movedSince(entry(), ev)).toBe(false)
    expect(movedSince(entry({ seen: { startIso: ev.startIso, endIso: ev.endIso, title: 'x' } }), ev)).toBe(false)
    expect(movedSince(entry({ seen: { startIso: '2026-10-25T19:00:00.000Z', endIso: ev.endIso, title: 'x' } }), ev)).toBe(true)
    expect(movedSince(entry({ seen: { startIso: ev.startIso, endIso: '2026-10-25T21:00:00.000Z', title: 'x' } }), ev)).toBe(true)
  })
})

describe('validateAvailability', () => {
  const now = new Date('2026-10-20T15:00:00.000Z') // Tue Oct 20, studio time
  const ok = (raw: unknown) => {
    const r = validateAvailability(raw, now)
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  const err = (raw: unknown) => {
    const r = validateAvailability(raw, now)
    expect(r.ok).toBe(false)
    return r.ok ? '' : r.error
  }

  it('accepts a usual week and dates, filling unsaid days with null and trimming notes', () => {
    const v = ok({ weekly: { '6': { kind: 'can', range: { from: '09:00', to: '17:00' }, note: '  mornings best ' }, '0': null }, dates: { '2026-10-31': [{ kind: 'cant', range: null, note: '' }] } })
    expect(v.weekly).toEqual({ '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': { kind: 'can', range: { from: '09:00', to: '17:00' }, note: 'mornings best' } })
    expect(v.dates).toEqual({ '2026-10-31': [{ kind: 'cant', range: null, note: '' }] })
  })
  it('allows a 24:00 end and keeps yesterday, drops older dates and empty days', () => {
    const v = ok({ weekly: {}, dates: { '2026-10-19': [can('18:00', '24:00')], '2026-10-01': [cant()], '2026-10-30': [] } })
    expect(Object.keys(v.dates)).toEqual(['2026-10-19'])
  })
  it('sorts marks on a day by start', () => {
    const v = ok({ weekly: {}, dates: { '2026-10-31': [can('13:00', '15:00'), cant('09:00', '10:00')] } })
    expect(v.dates['2026-10-31'].map((m) => m.range!.from)).toEqual(['09:00', '13:00'])
  })
  it('refuses each bad case with a sentence a person can act on', () => {
    expect(err(null)).toMatch(/times/i)
    expect(err({ weekly: { '6': can('12:00', '09:00') }, dates: {} })).toBe('Pick an end time after the start.')
    expect(err({ weekly: { '6': can('12:00', '12:00') }, dates: {} })).toBe('Pick an end time after the start.')
    expect(err({ weekly: { '6': can('9am', '12:00') }, dates: {} })).toBe('Pick a time from the list.')
    expect(err({ weekly: { '6': can('24:00', '24:00') }, dates: {} })).toBe('Pick a time from the list.')
    expect(err({ weekly: { '6': can('09:00', '24:30') }, dates: {} })).toBe('Pick a time from the list.')
    expect(err({ weekly: { '6': { kind: 'maybe', range: null, note: '' } }, dates: {} })).toBe('Pick Can or Can\'t.')
    expect(err({ weekly: { '7': can() }, dates: {} })).toBe('Pick a day of the week.')
    expect(err({ weekly: { '6': can(undefined, undefined, 'x'.repeat(121)) }, dates: {} })).toBe('Keep the note under 120 characters.')
    expect(err({ weekly: {}, dates: { '2026-02-30': [can()] } })).toBe('Pick a real date.')
    expect(err({ weekly: {}, dates: { 'Oct 31': [can()] } })).toBe('Pick a real date.')
    expect(err({ weekly: {}, dates: { '2027-10-21': [can()] } })).toBe('Pick a date within the next year.')
    expect(err({ weekly: {}, dates: { '2026-10-31': [can('09:00', '10:00'), can('10:00', '11:00'), can('11:00', '12:00'), can('12:00', '13:00'), can('13:00', '14:00')] } })).toBe('Up to 4 times on one day.')
    expect(err({ weekly: {}, dates: { '2026-10-31': [can('09:00', '12:00'), cant('11:00', '13:00')] } })).toBe('Two of your times on Sat, Oct 31 overlap. Change one.')
    expect(err({ weekly: {}, dates: { '2026-10-31': [cant(), can('11:00', '13:00')] } })).toBe('Two of your times on Sat, Oct 31 overlap. Change one.')
    expect(err({ weekly: {}, dates: { '2026-10-31': 'nope' } })).toMatch(/times/i)
  })
  it('accepts every day from yesterday to a year ahead', () => {
    const dates: Record<string, DayMark[]> = {}
    for (let i = -1; i <= 365; i++) dates[new Date(Date.UTC(2026, 9, 20 + i, 12)).toISOString().slice(0, 10)] = [can()]
    expect(Object.keys(ok({ weekly: {}, dates }).dates).length).toBe(367)
  })
})

describe('verdictWithNote and the date cap', () => {
  it('carries the note of the "can\'t" that decided it', () => {
    const a = avail({ '6': cant('09:00', '12:00', 'dentist') })
    expect(verdictWithNote(a, satAt(10))).toEqual({ verdict: 'cant', note: 'dentist' })
    expect(verdictWithNote(a, satAt(14))).toEqual({ verdict: 'unknown', note: '' })
    expect(verdictWithNote(avail({ '6': can(undefined, undefined, 'any time') }), satAt(14))).toEqual({ verdict: 'can', note: '' })
  })

  it('refuses more than 400 dates in one save with a plain sentence, before any work (M9)', () => {
    const dates: Record<string, unknown> = {}
    for (let i = 0; i < 401; i++) dates[`2020-01-${String(i).padStart(3, '0')}`] = []
    const r = validateAvailability({ weekly: {}, dates }, new Date('2026-10-20T15:00:00.000Z'))
    expect(r).toEqual({ ok: false, error: "That's too many dates in one save. Take some off and try again.", field: undefined })
  })
})
