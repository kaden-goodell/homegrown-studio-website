import { describe, it, expect } from 'vitest'
import { chicagoToUtc, cutSlots, nextMonday, SLOT_TEMPLATE } from '../../src/lib/crew/slots'

describe('chicagoToUtc', () => {
  it('converts CDT (July, UTC-5)', () => {
    expect(chicagoToUtc('2026-07-25', 16).toISOString()).toBe('2026-07-25T21:00:00.000Z')
  })
  it('converts CST (December, UTC-6)', () => {
    expect(chicagoToUtc('2026-12-05', 16).toISOString()).toBe('2026-12-05T22:00:00.000Z')
  })
  it('handles half hours', () => {
    expect(chicagoToUtc('2026-07-25', 16.5).toISOString()).toBe('2026-07-25T21:30:00.000Z')
  })
})

describe('nextMonday', () => {
  it('from a Thursday', () => expect(nextMonday('2026-07-09')).toBe('2026-07-13'))
  it('from a Monday returns the following Monday', () => expect(nextMonday('2026-07-13')).toBe('2026-07-20'))
  it('from a Sunday', () => expect(nextMonday('2026-07-12')).toBe('2026-07-13'))
})

describe('cutSlots', () => {
  const slots = cutSlots('2026-07-20') // Mon; Thu=Jul 23, Fri=24, Sat=25, Sun=26
  it('produces 7 slots per week (1+1+3+2)', () => expect(slots).toHaveLength(7))
  it('Thu slot is 4–9p Chicago', () => {
    expect(slots[0]).toEqual({
      startAt: '2026-07-23T21:00:00.000Z',
      endAt: '2026-07-24T02:00:00.000Z',
      label: 'Thu 4:00p–9:00p',
    })
  })
  it('Sat has three slots starting 9a Chicago', () => {
    const sat = slots.filter((s) => s.label.startsWith('Sat'))
    expect(sat).toHaveLength(3)
    expect(sat[0].startAt).toBe('2026-07-25T14:00:00.000Z')
  })
  it('Sun last slot ends 8p Chicago', () => {
    expect(slots[slots.length - 1].endAt).toBe('2026-07-27T01:00:00.000Z')
  })
})

describe('SLOT_TEMPLATE', () => {
  it('covers only Thu–Sun', () => expect(Object.keys(SLOT_TEMPLATE).sort()).toEqual(['0', '4', '5', '6']))
})
