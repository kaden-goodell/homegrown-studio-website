import { describe, it, expect } from 'vitest'
import { partyConfig } from '@config/party.config'
import {
  dueAtStudioCents,
  partyEstimateCents,
  partyKindOn,
  partyTermsForStart,
  partyTermsOn,
  termsForKind,
} from '@lib/party-terms'
import { localToUtcISO, partyStartsForDate, removeBooked } from '@lib/party-slots'
import { classBlocksParty, classSpanOf, partyBlocksClass, partySpanOf, removeClassBlocked } from '@lib/conflicts'
import { craftTotalCents, partyTotalCents } from '@lib/party-pricing'
import { weeknightRegisterNote } from '@lib/party-register'

// Noon Central on Tuesday 3 Nov 2026: dates from 10 Nov to 1 Feb are on offer.
const NOW = new Date('2026-11-03T18:00:00.000Z')
// Mon 16, Tue 17, Wed 18, Thu 19 Nov 2026 (CST, UTC-6).
const MON = '2026-11-16'
const TUE = '2026-11-17'
const WED = '2026-11-18'
const THU = '2026-11-19'
const SAT = '2026-11-21'
const at = (day: string, hhmm: string) => localToUtcISO(day, hhmm)

describe('party terms', () => {
  it('Monday to Wednesday are weeknights; Friday to Sunday, and days with no parties, are weekend', () => {
    expect([MON, TUE, WED].map(partyKindOn)).toEqual(['weeknight', 'weeknight', 'weeknight'])
    expect(['2026-11-20', SAT, '2026-11-22', THU].map(partyKindOn)).toEqual(['weekend', 'weekend', 'weekend', 'weekend'])
  })

  it('weeknight: 2 hours, no studio fee, $300 minimum, $300 charged now as a craft credit', () => {
    expect(partyTermsOn(MON)).toEqual({
      kind: 'weeknight',
      durationMinutes: 120,
      studioFeeCents: 0,
      minimumCents: partyConfig.weeknightMinimumCents,
      chargeNowCents: 30000,
      chargeIsCraftCredit: true,
    })
  })

  it('weekend: the usual 90 minutes and the studio fee, charged now as a fee', () => {
    expect(partyTermsOn(SAT)).toEqual({
      kind: 'weekend',
      durationMinutes: partyConfig.durationMinutes,
      studioFeeCents: partyConfig.basePriceCents,
      minimumCents: 0,
      chargeNowCents: partyConfig.basePriceCents,
      chargeIsCraftCredit: false,
    })
  })

  it('reads a start time on the studio’s calendar, not the UTC one', () => {
    // 6:00 PM Monday Central is already Tuesday in UTC.
    expect(partyTermsForStart(at(MON, '18:00')).kind).toBe('weeknight')
    // 7:00 PM Sunday Central is already Monday in UTC: still the weekend.
    expect(partyTermsForStart(at('2026-11-22', '19:00')).kind).toBe('weekend')
  })
})

describe('weeknight pricing', () => {
  const night = termsForKind('weeknight')
  const weekend = termsForKind('weekend')

  it('the estimate is the crafts, never under $300', () => {
    expect(partyEstimateCents(night, 20000)).toBe(30000)
    expect(partyEstimateCents(night, 30000)).toBe(30000)
    expect(partyEstimateCents(night, 45000)).toBe(45000)
  })

  it('what is left at the register is the crafts less the $300 credit, never below 0', () => {
    expect(dueAtStudioCents(night, 20000)).toBe(0)
    expect(dueAtStudioCents(night, 30000)).toBe(0)
    expect(dueAtStudioCents(night, 45000)).toBe(15000)
  })

  it('weekend is unchanged: fee plus crafts, and all the crafts at the register', () => {
    expect(partyEstimateCents(weekend, 20000)).toBe(50000)
    expect(dueAtStudioCents(weekend, 20000)).toBe(20000)
    expect(partyTotalCents(2000, 10)).toBe(50000)
  })

  it('partyTotalCents follows the terms it is given', () => {
    expect(partyTotalCents(2000, 10, night)).toBe(30000)
    expect(partyTotalCents(2000, 20, night)).toBe(craftTotalCents(2000, 20))
  })
})

describe('weeknight party times', () => {
  it('Monday to Wednesday each offer one party, at 6:00 PM', () => {
    expect(partyStartsForDate(MON, NOW)).toEqual([at(MON, '18:00')])
    expect(partyStartsForDate(TUE, NOW)).toEqual([at(TUE, '18:00')])
    expect(partyStartsForDate(WED, NOW)).toEqual([at(WED, '18:00')])
  })

  it('Thursday still has none', () => {
    expect(partyStartsForDate(THU, NOW)).toEqual([])
  })

  it('a closure blocks weeknights too (the Christmas holidays)', () => {
    // Mon 21 to Wed 23 Dec 2026 are inside the Christmas closure.
    expect(partyStartsForDate('2026-12-21', NOW)).toEqual([])
    expect(partyStartsForDate('2026-12-22', NOW)).toEqual([])
    expect(partyStartsForDate('2026-12-23', NOW)).toEqual([])
    // Thanksgiving is Thu and Fri only, so the Wednesday before keeps its party.
    expect(partyStartsForDate('2026-11-25', NOW)).toEqual([at('2026-11-25', '18:00')])
  })

  it('a class that night takes the party away (a Wednesday 6:00 class)', () => {
    const cls = classSpanOf({ scheduleId: 'clssch_wed', name: 'Wednesday class', startAt: at(WED, '18:00'), durationMinutes: 120 })
    expect(removeClassBlocked(partyStartsForDate(WED, NOW), [cls])).toEqual([])
  })

  it('a class at 8:30 clashes with the 2-hour weeknight party (it would not with a 90-minute one)', () => {
    const late = classSpanOf({ scheduleId: 'clssch_late', name: 'Late', startAt: at(MON, '20:30'), durationMinutes: 60 })
    expect(classBlocksParty(at(MON, '18:00'), [late])).toEqual(late)
    // 9:00 PM is a full hour after the party ends at 8:00: fine.
    const nine = classSpanOf({ scheduleId: 'clssch_nine', name: 'Nine', startAt: at(MON, '21:00'), durationMinutes: 60 })
    expect(classBlocksParty(at(MON, '18:00'), [nine])).toBeNull()
  })
})

describe('booked parties use their own length', () => {
  it('a booked weeknight party with no length on it counts as 2 hours', () => {
    const span = partySpanOf({ id: 'bk', slot: { startAt: at(MON, '18:00') } })
    expect(Date.parse(span.endIso) - Date.parse(span.startIso)).toBe(120 * 60_000)
    // And a weekend one as 90 minutes, as before.
    const sat = partySpanOf({ id: 'bk2', slot: { startAt: at(SAT, '14:00') } })
    expect(Date.parse(sat.endIso) - Date.parse(sat.startIso)).toBe(90 * 60_000)
  })

  it('a class created over a booked weeknight party is refused for its real length', () => {
    const booked = partySpanOf({ id: 'bk', slot: { startAt: at(MON, '18:00'), duration: 120 } })
    // 8:30 PM class: inside the hour after a party that ends at 8:00.
    expect(partyBlocksClass(at(MON, '20:30'), at(MON, '21:30'), [booked])).toEqual([booked])
    expect(partyBlocksClass(at(MON, '21:00'), at(MON, '22:00'), [booked])).toEqual([])
  })

  it('removeBooked measures each booked party by the length on the booking', () => {
    const starts = [at(SAT, '14:00'), at(SAT, '16:30')]
    // A 90-minute 2:00 booking leaves 4:30 (cleanup ends at 4:30).
    expect(removeBooked(starts, [{ startAt: at(SAT, '14:00'), durationMinutes: 90 }])).toEqual([at(SAT, '16:30')])
    // A 2:00 booking made for 2 hours in Square runs into 4:30's cleanup.
    expect(removeBooked(starts, [{ startAt: at(SAT, '14:00'), durationMinutes: 120 }])).toEqual([])
    // Plain start strings still work, at that day's usual length.
    expect(removeBooked([at(MON, '18:00')], [at(MON, '18:00')])).toEqual([])
  })
})

describe('the register note for staff', () => {
  it('weeknight: says $300 is already paid toward crafts, and what to collect', () => {
    const note = weeknightRegisterNote({ kind: 'weeknight', paidOnlineCents: 30000, perHeadCents: 2000 }, 18)
    expect(note).toEqual({
      headline: 'Weeknight party · $300 already paid toward crafts',
      how: 'Ring up the crafts, then tap the Weeknight craft credit discount. Collect what’s left. If the crafts come to $300 or less, there’s nothing more to collect.',
      estimate: '18 crafting at $20 makes $360 in crafts. Collect $60.',
    })
    expect(weeknightRegisterNote({ kind: 'weeknight', paidOnlineCents: 30000, perHeadCents: 2000 }, 12)?.estimate).toBe(
      '12 crafting at $20 makes $240 in crafts. Collect $0.',
    )
  })

  it('weekend: nothing new to say', () => {
    expect(weeknightRegisterNote({ kind: 'weekend', paidOnlineCents: 30000 }, 12)).toBeNull()
    expect(weeknightRegisterNote(undefined, 12)).toBeNull()
  })
})
