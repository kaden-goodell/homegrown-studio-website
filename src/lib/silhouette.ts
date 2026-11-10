// src/lib/silhouette.ts
/**
 * Pure geometry and pixel math for framed silhouettes (no DOM). The browser cuts the child out
 * (components/shop/silhouette-cutout.ts); this turns the cut-out into the printed 2"×3" card.
 * All coordinates are output pixels (800×1200 at 400 dpi).
 */
import { shopConfig } from '@config/shop.config'

const S = shopConfig.silhouettes
const DPI = S.outputW / 2

export interface Box { x: number; y: number; w: number; h: number }
export interface SilText { name: string; date: string }
/** Where the cut-out lands on the card: its top-left corner and scale (card px per cut-out px). */
export interface Placement { x: number; y: number; scale: number }

export const CARD = { w: S.outputW, h: S.outputH, inset: Math.round(S.safeInsetIn * DPI) } as const
export const NAME_MAX = 24
export const DATE_MAX = 24

/** The silhouette's area and the text lines under it. Without text the silhouette gets the whole card. */
export function cardLayout(text: SilText): { art: Box; nameY: number | null; dateY: number | null; nameSize: number; dateSize: number } {
  const nameSize = 64
  const dateSize = 40
  const hasName = !!text.name.trim()
  const hasDate = !!text.date.trim()
  const gap = 28
  const bottom = CARD.h - CARD.inset
  // Baselines, bottom up: the date sits on the safe line, the name above it.
  const dateY = hasDate ? bottom - 8 : null
  const nameY = hasName ? (dateY !== null ? dateY - dateSize - 14 : bottom - 12) : null
  const textTop = nameY !== null ? nameY - nameSize : dateY !== null ? dateY - dateSize : null
  const artBottom = textTop !== null ? textTop - gap : bottom
  const art: Box = { x: CARD.inset, y: CARD.inset, w: CARD.w - 2 * CARD.inset, h: artBottom - CARD.inset }
  return { art, nameY, dateY, nameSize, dateSize }
}

/** How far the bust cut's ends rise above its middle: a gentle smile-shaped bottom edge. */
export const bustRise = (art: Box) => Math.round(art.h * 0.07)

/** Person-probability (0..1 per pixel) → alpha (0..255) with a soft, anti-aliased edge. */
export function maskToAlpha(person: Float32Array | number[], lo = 0.35, hi = 0.65): Uint8ClampedArray {
  const out = new Uint8ClampedArray(person.length)
  for (let i = 0; i < person.length; i++) {
    const t = Math.min(1, Math.max(0, (person[i] - lo) / (hi - lo)))
    out[i] = Math.round(t * t * (3 - 2 * t) * 255)
  }
  return out
}

/** The box around every clearly-person pixel, or null when nobody was found. */
export function personBox(alpha: Uint8ClampedArray, w: number, h: number, min = 128): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < min) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Share of the image that is person. Tiny = nobody found; almost all = the background was not plain enough. */
export function personShare(alpha: Uint8ClampedArray, min = 128): number {
  let n = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] >= min) n++
  return alpha.length ? n / alpha.length : 0
}

/**
 * First placement, centred and as big as fits. When the body runs off the bottom of the photo
 * (the usual head-and-shoulders shot), its cut-off edge goes below the bust cut so the bottom is
 * the smooth curve, never a straight edge. Otherwise the head sits near the top of the art area.
 */
export function autoPlace(person: Box, art: Box, imageH: number): Placement {
  const rise = bustRise(art)
  const scale = Math.min((art.h * 0.92 + rise) / person.h, (art.w * 0.95) / person.w)
  const x = art.x + art.w / 2 - (person.x + person.w / 2) * scale
  const cutOff = person.y + person.h >= imageH - 2
  const y = cutOff ? art.y + art.h + rise - (person.y + person.h) * scale : art.y + art.h * 0.06 - person.y * scale
  return { x, y, scale }
}

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 3
