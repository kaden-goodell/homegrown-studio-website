import { describe, it, expect } from 'vitest'
import { CARD, cardLayout, maskToAlpha, personBox, personShare, autoPlace, bustRise } from '@lib/silhouette'

describe('card', () => {
  it('is 2x3 at 400 dpi with a 1/8in safe margin', () => {
    expect(CARD).toEqual({ w: 800, h: 1200, inset: 50 })
  })
  it('gives the silhouette the whole safe area without text', () => {
    const l = cardLayout({ name: '', date: '' })
    expect(l.art).toEqual({ x: 50, y: 50, w: 700, h: 1100 })
    expect(l.nameY).toBeNull()
    expect(l.dateY).toBeNull()
  })
  it('stacks name then date under the silhouette, all inside the safe margin', () => {
    const l = cardLayout({ name: 'Emma', date: 'Age 6' })
    expect(l.dateY!).toBeLessThanOrEqual(CARD.h - CARD.inset)
    expect(l.nameY!).toBeLessThan(l.dateY! - l.dateSize)
    expect(l.art.y + l.art.h).toBeLessThan(l.nameY! - l.nameSize)
    expect(l.art.h).toBeGreaterThan(850)
  })
  it('handles a date with no name', () => {
    const l = cardLayout({ name: ' ', date: '2019' })
    expect(l.nameY).toBeNull()
    expect(l.art.y + l.art.h).toBeLessThan(l.dateY! - l.dateSize)
  })
})

describe('mask', () => {
  it('is solid inside, clear outside, soft at the edge', () => {
    const a = maskToAlpha([0, 0.2, 0.5, 0.8, 1])
    expect([a[0], a[1], a[4], a[3]]).toEqual([0, 0, 255, 255])
    expect(a[2]).toBeGreaterThan(100)
    expect(a[2]).toBeLessThan(155)
  })
  it('finds the person box and share', () => {
    const w = 10, h = 10
    const a = new Uint8ClampedArray(w * h)
    for (let y = 2; y < 8; y++) for (let x = 3; x < 6; x++) a[y * w + x] = 255
    expect(personBox(a, w, h)).toEqual({ x: 3, y: 2, w: 3, h: 6 })
    expect(personShare(a)).toBeCloseTo(0.18)
    expect(personBox(new Uint8ClampedArray(4), 2, 2)).toBeNull()
  })
})

describe('autoPlace', () => {
  it('centres the person and puts the head near the top of the art area', () => {
    const art = cardLayout({ name: 'Emma', date: '' }).art
    const p = autoPlace({ x: 100, y: 50, w: 400, h: 600 }, art, 1000)
    const left = p.x + 100 * p.scale, right = p.x + 500 * p.scale, top = p.y + 50 * p.scale, bottom = p.y + 650 * p.scale
    expect((left + right) / 2).toBeCloseTo(art.x + art.w / 2)
    expect(top).toBeCloseTo(art.y + art.h * 0.06)
    expect(right - left).toBeLessThanOrEqual(art.w * 0.95 + 1e-6)
    expect(bottom).toBeGreaterThan(art.y + art.h - bustRise(art)) // shoulders run past the bust cut
  })
  it('runs a body cut off by the photo edge down past the bust cut, even when the photo is wide', () => {
    const art = cardLayout({ name: '', date: '' }).art
    const p = autoPlace({ x: 0, y: 150, w: 820, h: 520 }, art, 670) // wide, touching the bottom
    expect(p.y + 670 * p.scale).toBeCloseTo(art.y + art.h + bustRise(art))
  })
})
