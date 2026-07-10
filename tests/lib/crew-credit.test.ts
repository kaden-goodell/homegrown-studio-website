import { describe, it, expect } from 'vitest'
import { timecardHours, computeCreditCents, ledgerKey } from '../../src/lib/crew/credit'

describe('timecardHours', () => {
  it('computes simple duration', () => {
    expect(timecardHours({ startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z' })).toBe(4)
  })
  it('subtracts breaks', () => {
    expect(timecardHours({
      startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z',
      breaks: [{ startAt: '2026-07-25T15:00:00Z', endAt: '2026-07-25T15:30:00Z' }],
    })).toBe(3.5)
  })
  it('returns 0 for an open timecard (still clocked in)', () => {
    expect(timecardHours({ startAt: '2026-07-25T14:00:00Z' })).toBe(0)
  })
  it('ignores an unfinished break', () => {
    expect(timecardHours({
      startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z',
      breaks: [{ startAt: '2026-07-25T15:00:00Z' }],
    })).toBe(4)
  })
})

describe('computeCreditCents', () => {
  it('whole hours at whole rate', () => expect(computeCreditCents(4, 15)).toBe(6000n))
  it('rounds to the cent', () => expect(computeCreditCents(3.33, 12.5)).toBe(4163n)) // 41.625 → 41.63
  it('zero hours → zero', () => expect(computeCreditCents(0, 15)).toBe(0n))
})

describe('ledgerKey', () => {
  it('joins with pipes', () => expect(ledgerKey('TMx', '2026-07-20', '2026-08-02')).toBe('TMx|2026-07-20|2026-08-02'))
})
