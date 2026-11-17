import { describe, it, expect } from 'vitest'
import { coverScale, clampCrop, sourceRect, printQuality, type Crop } from '@lib/magnet-crop'

const landscape = { w: 4000, h: 3000 }

describe('coverScale', () => {
  it('fits the short side to the square', () => {
    expect(coverScale(landscape, 300)).toBeCloseTo(0.1)
  })
})

describe('sourceRect', () => {
  it('centres a square on the short side at zoom 1', () => {
    expect(sourceRect(landscape, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 500, sy: 0, side: 3000 })
  })
  it('halves the side at zoom 2 and follows the offset', () => {
    // positive x = the image was dragged right, so the visible square moves LEFT (sx goes down)
    expect(sourceRect(landscape, { zoom: 2, x: 200, y: -100 })).toEqual({ sx: 1050, sy: 850, side: 1500 })
  })
})

describe('clampCrop', () => {
  it('keeps zoom at least 1 and at most 6', () => {
    expect(clampCrop(landscape, { zoom: 0.5, x: 0, y: 0 }).zoom).toBe(1)
    expect(clampCrop(landscape, { zoom: 9, x: 0, y: 0 }).zoom).toBe(6)
  })
  it('stops the image from leaving the square', () => {
    const c: Crop = clampCrop(landscape, { zoom: 1, x: 5000, y: 5000 })
    expect(c).toEqual({ zoom: 1, x: 500, y: 0 })
  })
})

describe('printQuality', () => {
  it('flags crops under 400 source pixels', () => {
    expect(printQuality({ w: 800, h: 600 }, { zoom: 2, x: 0, y: 0 })).toBe('low')
    expect(printQuality(landscape, { zoom: 1, x: 0, y: 0 })).toBe('good')
  })
})
