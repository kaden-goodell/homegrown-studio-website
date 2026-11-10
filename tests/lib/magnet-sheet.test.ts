import { describe, it, expect } from 'vitest'
import { layoutSheets, SHEET, framePolygon, printItems, EDGE_LABEL } from '@lib/magnet-sheet'

describe('layoutSheets', () => {
  it('puts 12 on a page, left to right then down', () => {
    const pages = layoutSheets(Array.from({ length: 14 }, (_, i) => `p${i}`))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(12)
    expect(pages[1]).toHaveLength(2)
    expect(pages[0][0]).toMatchObject({ item: 'p0', left: SHEET.cols[0], top: SHEET.rows[0] })
    expect(pages[0][2]).toMatchObject({ item: 'p2', left: SHEET.cols[2], top: SHEET.rows[0] })
    expect(pages[0][3]).toMatchObject({ item: 'p3', left: SHEET.cols[0], top: SHEET.rows[1] })
  })
  it('keeps repeats as separate cells', () => {
    expect(layoutSheets(['a', 'a', 'a'])[0].map((c) => c.item)).toEqual(['a', 'a', 'a'])
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

describe('batching orders', () => {
  const order = (id: string, n: number) => ({ id, draftId: `d-${id}`, magnets: Array.from({ length: n }, (_, i) => `${id}-p${i}`) })
  it('puts two 6-magnet orders on one full page, in order, each labelled', () => {
    const pages = layoutSheets(printItems([order('M-AAAAAA', 6), order('M-BBBBBB', 6)]))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(12)
    expect(pages[0][0].item).toEqual({ photoId: 'M-AAAAAA-p0', draftId: 'd-M-AAAAAA', label: 'M-AAAAAA · 1/6' })
    expect(pages[0][6].item.label).toBe('M-BBBBBB · 1/6')
    expect(pages[0][11].item.label).toBe('M-BBBBBB · 6/6')
  })
  it('runs 6 + 6 + 18 onto 2½ pages with no gaps', () => {
    const pages = layoutSheets(printItems([order('M-AAAAAA', 6), order('M-BBBBBB', 6), order('M-CCCCCC', 18)]))
    expect(pages.map((p) => p.length)).toEqual([12, 12, 6])
  })
})

describe('edge code always wraps', () => {
  const photoBottom = SHEET.photoInset + SHEET.photo
  it('sits in the outer part of the fold, at least 0.15in past the photo', () => {
    expect(EDGE_LABEL.top - photoBottom).toBeGreaterThanOrEqual(0.15)
  })
  it('stays inside the frame', () => {
    expect(EDGE_LABEL.top + EDGE_LABEL.height).toBeLessThanOrEqual(SHEET.frame - 0.02)
  })
  it('is small', () => {
    expect(EDGE_LABEL.fontPt).toBeLessThanOrEqual(5)
  })
})
