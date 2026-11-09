/**
 * The Canva "fridge Magnet Template 01" page 1 (2×2), measured 2026-11-09.
 * All values in inches on a letter page.
 */
export const SHEET = {
  pageW: 8.5,
  pageH: 11,
  cols: [32.524 / 96, 287.984 / 96, 543.443 / 96],
  rows: [27.969 / 96, 281.312 / 96, 534.655 / 96, 787.999 / 96],
  frame: 2.5,
  photoInset: 0.25,
  photo: 2,
  corner: 0.463,
  perPage: 12,
} as const

export interface SheetCell { photoId: string; left: number; top: number }

export function layoutSheets(photoIds: string[]): SheetCell[][] {
  const pages: SheetCell[][] = []
  photoIds.forEach((photoId, i) => {
    const onPage = i % SHEET.perPage
    if (onPage === 0) pages.push([])
    pages[pages.length - 1].push({ photoId, left: SHEET.cols[onPage % 3], top: SHEET.rows[Math.floor(onPage / 3)] })
  })
  return pages
}

/** The cut line, clockwise from the top-left clipped corner, in inches inside one frame. */
export function framePolygon(): [number, number][] {
  const s = SHEET.frame
  const c = SHEET.corner
  return [[c, 0], [s - c, 0], [s, c], [s, s - c], [s - c, s], [c, s], [0, s - c], [0, c]]
}
