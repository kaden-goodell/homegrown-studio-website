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

/**
 * The order code on each magnet's bottom fold (Kaden, 2026-11-09: "as long as it ALWAYS wraps").
 * It sits in the OUTER part of the ¼" fold band, at least 0.15" past the photo's edge, so after
 * pressing it lands on the back of the magnet, never the face or the visible side. Inches,
 * measured from the top of the frame.
 */
export const EDGE_LABEL = {
  top: SHEET.photoInset + SHEET.photo + 0.155,
  height: 0.07,
  fontPt: 5,
  color: '#8a8a8a',
} as const

/** One magnet to print: which photo, from which order's draft, and its edge code. */
export interface PrintItem { photoId: string; draftId: string; label: string }
export interface SheetCell<T = PrintItem> { item: T; left: number; top: number }

/** Fills sheets in order, 12 per page, left to right then down — orders run on without gaps. */
export function layoutSheets<T>(items: T[]): SheetCell<T>[][] {
  const pages: SheetCell<T>[][] = []
  items.forEach((item, i) => {
    const onPage = i % SHEET.perPage
    if (onPage === 0) pages.push([])
    pages[pages.length - 1].push({ item, left: SHEET.cols[onPage % 3], top: SHEET.rows[Math.floor(onPage / 3)] })
  })
  return pages
}

/** Every magnet of these orders, back to back, each tagged "M-XXXXXX · 3/6". */
export function printItems(orders: { id: string; draftId: string; magnets: string[] }[]): PrintItem[] {
  return orders.flatMap((o) => o.magnets.map((photoId, i) => ({ photoId, draftId: o.draftId, label: `${o.id} · ${i + 1}/${o.magnets.length}` })))
}

/** The cut line, clockwise from the top-left clipped corner, in inches inside one frame. */
export function framePolygon(): [number, number][] {
  const s = SHEET.frame
  const c = SHEET.corner
  return [[c, 0], [s - c, 0], [s, c], [s, s - c], [s - c, s], [c, s], [0, s - c], [0, c]]
}
