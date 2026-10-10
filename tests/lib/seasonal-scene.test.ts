import { describe, it, expect } from 'vitest'
import { seasonFor, breezeAt, createDrifters, stepDrifters, countFor } from '@lib/seasonal-scene'

describe('seasonFor', () => {
  it('fall is September through November', () => {
    expect(seasonFor(new Date(2026, 8, 1))).toBe('fall')
    expect(seasonFor(new Date(2026, 9, 16))).toBe('fall')
    expect(seasonFor(new Date(2026, 10, 30))).toBe('fall')
  })
  it('winter is December through February', () => {
    expect(seasonFor(new Date(2026, 11, 1))).toBe('winter')
    expect(seasonFor(new Date(2027, 0, 15))).toBe('winter')
    expect(seasonFor(new Date(2027, 1, 28))).toBe('winter')
  })
  it('spring and summer keep the glitter', () => {
    expect(seasonFor(new Date(2027, 2, 1))).toBe('glitter')
    expect(seasonFor(new Date(2027, 6, 4))).toBe('glitter')
  })
  it('a ?season= preview wins, junk is ignored', () => {
    expect(seasonFor(new Date(2027, 6, 4), 'winter')).toBe('winter')
    expect(seasonFor(new Date(2026, 9, 16), 'snow')).toBe('fall')
  })
})

describe('the breeze', () => {
  it('blows both ways over time, and never storms', () => {
    let left = 0, right = 0
    for (let t = 0; t < 3600; t += 0.5) {
      const b = breezeAt(t)
      expect(Math.abs(b)).toBeLessThan(70)
      if (b < -5) left++
      if (b > 5) right++
    }
    // Over an hour it spends real time blowing each way.
    expect(left).toBeGreaterThan(1000)
    expect(right).toBeGreaterThan(1000)
  })
})

describe('drifters', () => {
  it('keeps the screen populated as leaves fall off the bottom', () => {
    const w = 1440, h = 900
    const ds = createDrifters('fall', w, h)
    expect(ds.length).toBe(countFor('fall', w, h))
    for (let i = 0; i < 6000; i++) stepDrifters(ds, 'fall', i / 60, 1 / 60, w, h)
    expect(ds.length).toBe(countFor('fall', w, h))
    for (const d of ds) {
      expect(d.y).toBeLessThanOrEqual(h + 40)
      expect(d.x).toBeGreaterThanOrEqual(-80)
      expect(d.x).toBeLessThanOrEqual(w + 80)
    }
  })
  it('gives a phone fewer leaves than a laptop, but never an empty sky', () => {
    expect(countFor('fall', 390, 844)).toBeLessThan(countFor('fall', 1440, 900))
    expect(countFor('fall', 300, 300)).toBeGreaterThanOrEqual(8)
  })
})
