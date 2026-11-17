import { describe, it, expect } from 'vitest'
import { targetFor, tierPrices, draftTiers } from '@lib/quotes/draft'
import { DEFAULT_SETTINGS, type MenuItem } from '@lib/quotes/types'
import { normalPerPerson } from '@lib/quotes/money'

const item = (id: string, cents: number, tags: string[] = []): MenuItem =>
  ({ id, source: 'own', name: id, photoUrl: null, cents, per: 'person', costCents: null, tags, hidden: false, updatedAt: '' })

describe('draft', () => {
  it('target = budget midpoint / guests, rounded to the dollar', () => {
    expect(targetFor('1000-2500', 25)).toBe(7000)
    expect(targetFor('under-1000', 20)).toBe(2500)
    expect(targetFor('2500-plus', 40)).toBe(7500)
    expect(targetFor('', 25)).toBeNull()
  })
  it('tier prices are 80/100/130% rounded to the dollar', () => {
    expect(tierPrices(7000)).toEqual({ simple: 5600, pick: 7000, all: 9100 })
  })
  it('fills each tier up to price/(1-cap) and omits empty tiers', () => {
    const menu = [item('terr', 4500, ['adults']), item('ear', 3000, ['adults']), item('felt', 800), item('big', 20000)]
    const tiers = draftTiers({ menu, targetCents: 7000, guests: 25, crafters: 'adults', month: 12, theme: '' }, DEFAULT_SETTINGS)
    for (const t of tiers) expect(normalPerPerson(t, 25)).toBeLessThanOrEqual(Math.floor(t.priceCents / 0.75))
    expect(tiers.map((t) => t.key)).toEqual(['simple', 'pick', 'all'])
    expect(tiers.every((t) => t.lines.length > 0)).toBe(true)
    expect(draftTiers({ menu: [item('big', 20000)], targetCents: 7000, guests: 25, crafters: 'adults', month: 3, theme: '' }, DEFAULT_SETTINGS)).toEqual([])
  })
  it('skips hidden and gone items', () => {
    const menu = [{ ...item('h', 1000), hidden: true }, { ...item('g', 1000), gone: true }]
    expect(draftTiers({ menu, targetCents: 5000, guests: 10, crafters: 'both', month: 1, theme: '' }, DEFAULT_SETTINGS)).toEqual([])
  })
  it('prefers items tagged for the crafters and holiday in Nov-Dec', () => {
    const menu = [item('kidsthing', 3000, ['kids']), item('adultthing', 3000, ['adults']), item('xmas', 3000, ['holiday'])]
    const [simple] = draftTiers({ menu, targetCents: 3000, guests: 10, crafters: 'adults', month: 12, theme: '' }, DEFAULT_SETTINGS)
    expect(simple.lines[0].itemId).toBe('adultthing')
  })
})
