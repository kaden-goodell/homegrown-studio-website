// tests/lib/conflicts.test.ts
import { describe, it, expect } from 'vitest'
import {
  overlaps,
  classSpanOf,
  partySpanOf,
  classBlocksParty,
  partyBlocksClass,
  removeClassBlocked,
  classesOverlap,
  partyName,
  partyClashMessage,
} from '@lib/conflicts'
import { localToUtcISO } from '@lib/party-slots'

// Sunday 18 Oct 2026, CDT (UTC-5).
const at = (hhmm: string, day = '2026-10-18') => localToUtcISO(day, hhmm)
const ms = (hhmm: string) => Date.parse(at(hhmm))
const PAILS = classSpanOf({ scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startAt: at('13:00'), durationMinutes: 120 })

describe('overlaps', () => {
  it('is half-open: touching ends do not overlap', () => {
    expect(overlaps({ start: ms('10:00'), end: ms('11:00') }, { start: ms('11:00'), end: ms('12:00') })).toBe(false)
  })

  it('sees a plain overlap from either side', () => {
    const a = { start: ms('10:00'), end: ms('11:30') }
    const b = { start: ms('11:00'), end: ms('12:00') }
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(b, a)).toBe(true)
  })

  it('needs the buffer on both sides, in either order', () => {
    const early = { start: ms('10:00'), end: ms('11:30') }
    const late = { start: ms('12:00'), end: ms('13:00') }
    const farLate = { start: ms('12:30'), end: ms('13:30') }
    expect(overlaps(early, late, 60)).toBe(true)
    expect(overlaps(late, early, 60)).toBe(true)
    expect(overlaps(early, farLate, 60)).toBe(false)
    expect(overlaps(farLate, early, 60)).toBe(false)
  })
})

describe('classBlocksParty — Pumpkin Pails 1–3 PM on Sunday 18 Oct', () => {
  it('rules out the 1:00 PM party', () => {
    expect(classBlocksParty(at('13:00'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('rules out a party starting 30 minutes after the class ends', () => {
    expect(classBlocksParty(at('15:30'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('rules out a party starting right as the class ends', () => {
    expect(classBlocksParty(at('15:00'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('rules out a party one minute short of the hour after the class', () => {
    expect(classBlocksParty(at('15:59'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('keeps a party starting exactly one hour after the class ends', () => {
    expect(classBlocksParty(at('16:00'), [PAILS])).toBeNull()
  })

  it('allows a party that ends exactly one cleanup before the class', () => {
    // 10:30 + 90 min = 12:00; the class needs the room from 12:00.
    expect(classBlocksParty(at('10:30'), [PAILS])).toBeNull()
  })

  it('refuses a party that ends one minute into the cleanup', () => {
    expect(classBlocksParty(at('10:31'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('leaves the Saturday 4:30 PM party under a 7 PM class', () => {
    const evening = classSpanOf({ scheduleId: 's', name: 'Earrings', startAt: at('19:00', '2026-10-17'), durationMinutes: 120 })
    expect(classBlocksParty(at('16:30', '2026-10-17'), [evening])).toBeNull()
  })
})

describe('partyBlocksClass — the same rule from the class side', () => {
  const rivera = partySpanOf({ id: 'bk_1', slot: { startAt: at('13:00'), duration: 90 } }, 'Jamie Rivera')

  it('refuses a class starting inside the hour after a party', () => {
    expect(partyBlocksClass(at('15:00'), at('17:00'), [rivera]).map((p) => p.id)).toEqual(['bk_1'])
  })

  it('allows a class starting a full cleanup after the party ends', () => {
    expect(partyBlocksClass(at('15:30'), at('17:30'), [rivera])).toEqual([])
  })

  it('refuses a class ending inside the hour before a party', () => {
    expect(partyBlocksClass(at('10:30'), at('12:30'), [rivera]).map((p) => p.id)).toEqual(['bk_1'])
  })

  it('allows a class ending exactly one hour before a party', () => {
    expect(partyBlocksClass(at('10:00'), at('12:00'), [rivera])).toEqual([])
  })

  it('agrees with classBlocksParty for every half hour of the day', () => {
    for (let h = 8; h <= 19; h++) {
      for (const m of ['00', '30']) {
        const start = at(`${String(h).padStart(2, '0')}:${m}`)
        const asParty = partySpanOf({ id: 'x', slot: { startAt: start } })
        expect(classBlocksParty(start, [PAILS]) !== null).toBe(partyBlocksClass(PAILS.startIso, PAILS.endIso, [asParty]).length > 0)
      }
    }
  })
})

describe('spans', () => {
  it('a booking with no length counts as one standard party', () => {
    const p = partySpanOf({ id: 'bk_2', slot: { startAt: at('13:00') } })
    expect(p.endIso).toBe(at('14:30'))
    expect(p.hostName).toBeUndefined()
  })

  it('a class ends after its duration', () => {
    expect(PAILS).toEqual({ id: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startIso: at('13:00'), endIso: at('15:00') })
  })

  it('removeClassBlocked drops starts within the hour of Pails, either side', () => {
    expect(removeClassBlocked([at('13:00'), at('15:30'), at('16:00')], [PAILS])).toEqual([at('16:00')])
    expect(removeClassBlocked([at('13:00')], [])).toEqual([at('13:00')])
  })

  it('two classes at once overlap', () => {
    const needle = classSpanOf({ scheduleId: 'n', name: 'Needlepoint', startAt: at('18:00', '2026-10-23'), durationMinutes: 120 })
    const gcn = classSpanOf({ scheduleId: 'g', name: 'Girls Craft Night', startAt: at('19:00', '2026-10-23'), durationMinutes: 120 })
    const later = classSpanOf({ scheduleId: 'l', name: 'Later', startAt: at('20:00', '2026-10-23'), durationMinutes: 60 })
    expect(classesOverlap(needle, gcn)).toBe(true)
    expect(classesOverlap(needle, later)).toBe(true) // 8 PM starts the moment 6–8 PM ends
  })

  it('two classes back to back clash, in either order', () => {
    const a = classSpanOf({ scheduleId: 'a', name: 'A', startAt: at('18:00', '2026-10-23'), durationMinutes: 120 })
    const b = classSpanOf({ scheduleId: 'b', name: 'B', startAt: at('20:00', '2026-10-23'), durationMinutes: 120 })
    expect(classesOverlap(a, b)).toBe(true)
    expect(classesOverlap(b, a)).toBe(true)
  })

  it('two classes exactly one hour apart do not clash', () => {
    const a = classSpanOf({ scheduleId: 'a', name: 'A', startAt: at('13:00'), durationMinutes: 120 })
    const b = classSpanOf({ scheduleId: 'b', name: 'B', startAt: at('16:00'), durationMinutes: 120 })
    expect(classesOverlap(a, b)).toBe(false)
    expect(classesOverlap(b, a)).toBe(false)
  })
})

describe('wording', () => {
  it('names a party by the host’s last name', () => {
    expect(partyName({ id: 'b', startIso: at('13:00'), endIso: at('14:30'), hostName: 'Jamie Rivera' })).toBe('the Rivera party')
    expect(partyName({ id: 'b', startIso: at('13:00'), endIso: at('14:30') })).toBe('a party')
  })

  it('prints time, host and booking id, then says what to do', () => {
    const msg = partyClashMessage([partySpanOf({ id: 'bk_1', slot: { startAt: at('13:00'), duration: 90 } }, 'Jamie Rivera')])
    expect(msg).toContain('Sun, Oct 18 · 1:00 PM party (Jamie Rivera), booking bk_1')
    expect(msg).toContain('Move the party in Square first (your call), then re-run.')
  })
})
