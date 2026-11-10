import { describe, it, expect } from 'vitest'
import { CARD, cardLayout, maskToAlpha, personBox, personShare, autoPlace, bustLine, cardCutY, edgeOffset, edgeExtent, lowestRow } from '@lib/silhouette'

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

describe('bust cut', () => {
  const person = { x: 100, y: 50, w: 400, h: 900 }
  it('ends the bust a set distance below the chin', () => {
    expect(bustLine(person, 350)).toBeCloseTo(350 + 300 * 0.75)
  })
  it('stays above where the photo ends', () => {
    expect(bustLine(person, 800)).toBeCloseTo(950 - 27)
    expect(bustLine(person, null)).toBeCloseTo(950 - 27)
  })
  it('finds the chin row', () => {
    expect(lowestRow([0, 0, 0.9, 0, 0.2, 0], 2, 3)).toBe(1)
    expect(lowestRow([0, 0], 1, 2)).toBeNull()
  })
  it('waves slope down to the side they face, the curve dips in the middle', () => {
    expect(edgeOffset('wave-right', 1, 700)).toBeGreaterThan(edgeOffset('wave-right', 0, 700))
    expect(edgeOffset('wave-left', 0, 700)).toBeGreaterThan(edgeOffset('wave-left', 1, 700))
    expect(edgeOffset('wave-left', 0.3, 700)).toBeCloseTo(edgeOffset('wave-right', 0.7, 700))
    expect(edgeOffset('curve', 0.5, 700)).toBeGreaterThan(edgeOffset('curve', 0, 700))
  })
})

describe('placement', () => {
  const shape = { w: 900, h: 1200, person: { x: 200, y: 100, w: 500, h: 1100 }, cutY: 900 }
  const art = cardLayout({ name: 'Emma', date: 'Age 6' }).art
  it('centres the head-to-bust shape in the art area, both ways', () => {
    for (const style of ['wave-right', 'wave-left', 'curve'] as const) {
      const p = autoPlace(shape, art, style)
      const { below } = edgeExtent(style, art.w)
      const top = p.y + shape.person.y * p.scale
      const bottom = cardCutY(shape, p, art, style) + below
      expect(top - art.y).toBeCloseTo(art.y + art.h - bottom, 0)
      expect(p.x + (shape.person.x + shape.person.w / 2) * p.scale).toBeCloseTo(art.x + art.w / 2)
      expect(bottom).toBeLessThanOrEqual(art.y + art.h + 1e-6)
    }
  })
  it('moves the bust edge with the silhouette when it is dragged up', () => {
    const p = autoPlace(shape, art, 'wave-right')
    const up = { ...p, y: p.y - 150 }
    expect(cardCutY(shape, up, art, 'wave-right')).toBeCloseTo(cardCutY(shape, p, art, 'wave-right') - 150)
  })
  it('Shorter / Longer nudges the edge up or down, still inside the limits', () => {
    const p = autoPlace(shape, art, 'wave-right')
    const mid = cardCutY(shape, p, art, 'wave-right')
    expect(cardCutY(shape, p, art, 'wave-right', -0.1)).toBeCloseTo(mid - 0.1 * art.h)
    const { below } = edgeExtent('wave-right', art.w)
    expect(cardCutY(shape, p, art, 'wave-right', 0.15) + below).toBeLessThanOrEqual(art.y + art.h + 1e-6)
  })
  it('never lets the edge fall below the photo or the safe area', () => {
    const p = autoPlace(shape, art, 'wave-right')
    const { below } = edgeExtent('wave-right', art.w)
    const down = { ...p, y: p.y + 400 }
    expect(cardCutY(shape, down, art, 'wave-right') + below).toBeLessThanOrEqual(art.y + art.h + 1e-6)
    const short = { ...shape, cutY: 1199 }
    expect(cardCutY(short, p, art, 'wave-right') + below).toBeLessThan(p.y + 1200 * p.scale)
  })
})
