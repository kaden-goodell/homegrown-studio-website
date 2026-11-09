import { describe, it, expect } from 'vitest'
import { layoutSheets, SHEET, framePolygon } from '@lib/magnet-sheet'

describe('layoutSheets', () => {
  it('puts 12 on a page, left to right then down', () => {
    const pages = layoutSheets(Array.from({ length: 14 }, (_, i) => `p${i}`))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(12)
    expect(pages[1]).toHaveLength(2)
    expect(pages[0][0]).toMatchObject({ photoId: 'p0', left: SHEET.cols[0], top: SHEET.rows[0] })
    expect(pages[0][2]).toMatchObject({ photoId: 'p2', left: SHEET.cols[2], top: SHEET.rows[0] })
    expect(pages[0][3]).toMatchObject({ photoId: 'p3', left: SHEET.cols[0], top: SHEET.rows[1] })
  })
  it('keeps repeats as separate cells', () => {
    expect(layoutSheets(['a', 'a', 'a'])[0].map((c) => c.photoId)).toEqual(['a', 'a', 'a'])
  })
})

describe('framePolygon', () => {
  it('is a 2.5in square with 45° corners clipped', () => {
    const pts = framePolygon()
    expect(pts).toHaveLength(8)
    expect(pts[0]).toEqual([SHEET.corner, 0])
    expect(pts[1]).toEqual([SHEET.frame - SHEET.corner, 0])
  })
})
