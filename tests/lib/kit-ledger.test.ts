/**
 * Weekly settings ledger — pure availability math (LR-1 claims model).
 *
 * Availability for a (ledger theme, week) is computed from that theme-week's
 * claims blob (confirmed claims + pending claims younger than 15 min) plus the
 * forward-blocking contribution of overdue kit orders (still 'out', past their
 * return-by). Owned capacity comes from kit-content: 'gilded' owns 45 settings
 * and 3 hero sets. No function here reads the clock — `now`/`today` are passed.
 */
import { describe, it, expect } from 'vitest'
import {
  availabilityFor,
  overCommittedWeeks,
  CLAIM_TTL_MS,
  type WeekClaim,
  type LedgerRecord,
} from '@lib/kit-ledger'

const NOW = Date.parse('2026-07-16T12:00:00Z')
const TODAY = '2026-07-16' // a Thursday; weekKeyFor(TODAY) === '2026-07-16'
const THEME = 'gilded' // owns 45 settings, 3 hero sets

function claim(serves: number, status: 'pending' | 'confirmed', ageMs = 0): WeekClaim {
  return { ref: `r${Math.random()}`, kind: 'kit', serves, status, at: new Date(NOW - ageMs).toISOString() }
}

function overdueOrder(weekKey: string, serves: number, returnBy: string, status: LedgerRecord['status'] = 'out'): LedgerRecord {
  return { id: `o${Math.random()}`, kind: 'kit', themeId: THEME, serves, weekKey, status, returnBy }
}

describe('availabilityFor — claims consumption', () => {
  it('an empty week offers every tier at full capacity', () => {
    const a = availabilityFor(THEME, '2026-07-16', [], [], TODAY, NOW)
    expect(a.settingsLeft).toBe(45)
    expect(a.heroSetsLeft).toBe(3)
    expect(a.offeredTiers).toEqual([10, 15, 20])
  })

  it('a confirmed claim consumes settings and one hero set', () => {
    const a = availabilityFor(THEME, '2026-07-16', [claim(20, 'confirmed')], [], TODAY, NOW)
    expect(a.settingsLeft).toBe(25)
    expect(a.heroSetsLeft).toBe(2)
    expect(a.offeredTiers).toEqual([10, 15, 20])
  })

  it('exhausting the hero sets offers no tiers even with settings to spare', () => {
    const claims = [claim(10, 'confirmed'), claim(10, 'confirmed'), claim(10, 'confirmed')]
    const a = availabilityFor(THEME, '2026-07-16', claims, [], TODAY, NOW)
    expect(a.settingsLeft).toBe(15) // 45 − 30
    expect(a.heroSetsLeft).toBe(0)
    expect(a.offeredTiers).toEqual([]) // no hero set left to stage a table
  })

  it('offers only tiers that fit the remaining settings', () => {
    // Two serves-20 tables: 40 settings gone, 5 left, one hero set left.
    const a = availabilityFor(THEME, '2026-07-16', [claim(20, 'confirmed'), claim(20, 'confirmed')], [], TODAY, NOW)
    expect(a.settingsLeft).toBe(5)
    expect(a.heroSetsLeft).toBe(1)
    expect(a.offeredTiers).toEqual([]) // smallest tier (10) doesn't fit in 5
  })

  it('counts a fresh pending claim but ignores a stale one (>15 min)', () => {
    const fresh = availabilityFor(THEME, '2026-07-16', [claim(20, 'pending', CLAIM_TTL_MS - 60_000)], [], TODAY, NOW)
    expect(fresh.settingsLeft).toBe(25)
    expect(fresh.heroSetsLeft).toBe(2)

    const stale = availabilityFor(THEME, '2026-07-16', [claim(20, 'pending', CLAIM_TTL_MS + 60_000)], [], TODAY, NOW)
    expect(stale.settingsLeft).toBe(45)
    expect(stale.heroSetsLeft).toBe(3)
  })
})

describe('availabilityFor — overdue kit orders block forward weeks', () => {
  const overdue = overdueOrder('2026-07-09', 20, '2026-07-15') // last week, still out, past return-by

  it('blocks this week (within one week of today) while a kit is overdue', () => {
    const a = availabilityFor(THEME, '2026-07-16', [], [overdue], TODAY, NOW)
    expect(a.settingsLeft).toBe(25)
    expect(a.heroSetsLeft).toBe(2)
  })

  it('does not block a week beyond the today+1-week horizon', () => {
    const a = availabilityFor(THEME, '2026-07-30', [], [overdue], TODAY, NOW)
    expect(a.settingsLeft).toBe(45)
    expect(a.heroSetsLeft).toBe(3)
  })

  it('does not block when the order is not yet overdue (return-by ≥ today)', () => {
    const notYet = overdueOrder('2026-07-09', 20, '2026-07-20')
    const a = availabilityFor(THEME, '2026-07-16', [], [notYet], TODAY, NOW)
    expect(a.settingsLeft).toBe(45)
  })

  it('does not block once the order has been returned', () => {
    const returned = overdueOrder('2026-07-09', 20, '2026-07-15', 'returned')
    const a = availabilityFor(THEME, '2026-07-16', [], [returned], TODAY, NOW)
    expect(a.settingsLeft).toBe(45)
  })

  it('stacks an overdue kit on top of a fresh claim', () => {
    const a = availabilityFor(THEME, '2026-07-16', [claim(20, 'confirmed')], [overdue], TODAY, NOW)
    expect(a.settingsLeft).toBe(5) // 45 − 20 − 20
    expect(a.heroSetsLeft).toBe(1) // 3 − 1 − 1
  })
})

describe('overCommittedWeeks — radar', () => {
  function rec(weekKey: string, serves: number, status: LedgerRecord['status'] = 'upcoming', kind: 'kit' | 'party' = 'kit'): LedgerRecord {
    return { id: `x${Math.random()}`, kind, themeId: THEME, serves, weekKey, status, returnBy: '' }
  }

  it('is empty when commitments fit owned settings', () => {
    const records = [rec('2026-07-23', 20), rec('2026-07-23', 20)] // 40 ≤ 45
    expect(overCommittedWeeks(records, TODAY)).toEqual([])
  })

  it('flags a week whose committed settings exceed what we own', () => {
    const records = [rec('2026-07-23', 20), rec('2026-07-23', 20), rec('2026-07-23', 20)] // 60 > 45
    expect(overCommittedWeeks(records, TODAY)).toEqual([
      { themeId: THEME, weekKey: '2026-07-23', committed: 60, owned: 45 },
    ])
  })

  it('pools kit and party commitments on the same ledger theme', () => {
    const records = [rec('2026-07-23', 20, 'upcoming', 'kit'), rec('2026-07-23', 20, 'upcoming', 'party'), rec('2026-07-23', 20, 'out', 'kit')]
    const flagged = overCommittedWeeks(records, TODAY)
    expect(flagged).toEqual([{ themeId: THEME, weekKey: '2026-07-23', committed: 60, owned: 45 }])
  })

  it('ignores cancelled, returned, and forfeited records', () => {
    const records = [
      rec('2026-07-23', 20),
      rec('2026-07-23', 20, 'cancelled'),
      rec('2026-07-23', 20, 'returned'),
      rec('2026-07-23', 20, 'forfeited'),
    ]
    expect(overCommittedWeeks(records, TODAY)).toEqual([]) // only the one active 20 counts
  })

  it('ignores weeks that have already passed', () => {
    const records = [rec('2026-07-02', 20), rec('2026-07-02', 20), rec('2026-07-02', 20)] // 60 but past
    expect(overCommittedWeeks(records, TODAY)).toEqual([])
  })
})
