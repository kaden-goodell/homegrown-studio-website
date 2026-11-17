import { describe, it, expect } from 'vitest'
import { normalPerPerson, offPct, meterOf, totalCents, depositCents, costPerPerson } from '@lib/quotes/money'
import { priceKey } from '@lib/quotes/price-key'
import { DEFAULT_SETTINGS, isExpired, type Tier } from '@lib/quotes/types'

const tier = (lines: Tier['lines'], priceCents: number): Tier =>
  ({ id: 't1', key: 'pick', name: 'T', photoUrl: null, hidden: false, lines, priceCents })

describe('quote money', () => {
  it('adds per-event lines divided by guests, rounded up', () => {
    const t = tier([
      { itemId: 'a', label: 'Terrarium', photoUrl: null, cents: 4500, per: 'person', costCents: 900 },
      { itemId: 'b', label: 'Travel', photoUrl: null, cents: 5000, per: 'event', costCents: null },
    ], 4000)
    expect(normalPerPerson(t, 30)).toBe(4500 + 167)
    expect(costPerPerson(t, 30)).toBeNull()
  })
  it('offPct is 1 - price/normal', () => {
    const t = tier([{ itemId: 'a', label: 'x', photoUrl: null, cents: 10000, per: 'person', costCents: 1000 }], 7500)
    expect(offPct(t, 10)).toBeCloseTo(0.25)
    expect(costPerPerson(t, 10)).toBe(1000)
  })
  it('meter: <20 green, 20..25 yellow, >25 red', () => {
    expect(meterOf(0.19, DEFAULT_SETTINGS)).toBe('green')
    expect(meterOf(0.20, DEFAULT_SETTINGS)).toBe('yellow')
    expect(meterOf(0.25, DEFAULT_SETTINGS)).toBe('yellow')
    expect(meterOf(0.30, DEFAULT_SETTINGS)).toBe('red')
    expect(meterOf(0.30, { ...DEFAULT_SETTINGS, capPct: 30 })).toBe('yellow')
  })
  it('total and 50% deposit', () => {
    expect(totalCents(7500, 30)).toBe(225000)
    expect(depositCents(225000, 50)).toBe(112500)
    expect(depositCents(1001, 50)).toBe(501)
  })
  it('priceKey changes with price, not with note', () => {
    const base = { guests: 30, depositPct: 50, startIso: '2026-12-11T00:00:00Z', place: 'studio' as const }
    const t = tier([{ itemId: 'a', label: 'x', photoUrl: null, cents: 100, per: 'person', costCents: null }], 90)
    const k1 = priceKey({ ...base, tiers: [t] })
    expect(priceKey({ ...base, tiers: [{ ...t, priceCents: 80 }] })).not.toBe(k1)
    expect(priceKey({ ...base, tiers: [{ ...t, photoUrl: 'x' }] })).toBe(k1)
  })
  it('isExpired only for sent/picked past expiry', () => {
    const now = new Date('2026-12-01T00:00:00Z')
    expect(isExpired({ status: 'sent', expiresAt: '2026-11-30T00:00:00Z' }, now)).toBe(true)
    expect(isExpired({ status: 'paid', expiresAt: '2026-11-30T00:00:00Z' }, now)).toBe(false)
    expect(isExpired({ status: 'picked', expiresAt: '2026-12-02T00:00:00Z' }, now)).toBe(false)
  })
})
