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

/**
 * The bottom edge of the bust (Kaden, 2026-11-10): a gentle curve, or one angled wave that runs
 * down to the right or down to the left.
 */
export type BottomStyle = 'curve' | 'wave-right' | 'wave-left'
export const BOTTOM_STYLES: BottomStyle[] = ['wave-right', 'wave-left', 'curve']

/** The cut-out's size, where the person is, and where the bust should end (all cut-out pixels). */
export interface SilShape { w: number; h: number; person: Box; cutY: number }

/** Edge height at t (0 = left end, 1 = right end), relative to the cut line `c`, for an art box this wide. */
export function edgeOffset(style: BottomStyle, t: number, width: number): number {
  if (style === 'curve') return -width * 0.07 * (2 * t - 1) ** 2 // ends rise, middle lowest
  const u = style === 'wave-right' ? t : 1 - t
  // A slope down toward one side, with one soft S riding on it.
  return width * (0.14 * (u - 0.5) - 0.05 * Math.sin(2 * Math.PI * u))
}

/** How far the edge reaches below / above the cut line (positive numbers). */
export function edgeExtent(style: BottomStyle, width: number): { below: number; above: number } {
  let below = 0, above = 0
  for (let i = 0; i <= 64; i++) {
    const o = edgeOffset(style, i / 64, width)
    below = Math.max(below, o)
    above = Math.max(above, -o)
  }
  return { below, above }
}

/**
 * Where the bust is cut: a set distance below the chin, so every portrait has the same proportions.
 * Without a face to measure, just above where the photo ends.
 */
export function bustLine(person: Box, faceBottom: number | null): number {
  const bottom = person.y + person.h
  const limit = bottom - person.h * 0.03
  if (faceBottom === null || faceBottom <= person.y) return limit
  const head = faceBottom - person.y
  return Math.min(limit, faceBottom + head * 0.75)
}

/** The cut line on the card (`length` = the customer's Shorter / Longer nudge). It moves with the silhouette, and always stays above the photo's own bottom edge and inside the safe area. */
export function cardCutY(shape: SilShape, p: Placement, art: Box, style: BottomStyle, length = 0): number {
  const { below } = edgeExtent(style, art.w)
  const wanted = p.y + shape.cutY * p.scale + length * art.h
  const photoBottom = p.y + shape.h * p.scale - below - 2
  return Math.min(wanted, photoBottom, art.y + art.h - below)
}

/**
 * First placement: the visible shape (top of the head to the bottom edge) as big as fits,
 * centred in the art area both ways.
 */
export function autoPlace(shape: SilShape, art: Box, style: BottomStyle): Placement {
  const { below } = edgeExtent(style, art.w)
  const top = shape.person.y
  const h = shape.cutY - top
  const scale = Math.min((art.h * 0.9 - below) / h, (art.w * 0.92) / shape.person.w)
  const visible = h * scale + below
  const x = art.x + art.w / 2 - (shape.person.x + shape.person.w / 2) * scale
  const y = art.y + (art.h - visible) / 2 - top * scale
  return { x, y, scale }
}

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

/** Lowest row where `values` passes `min` (e.g. the chin, from the face-skin mask), or null. */
export function lowestRow(values: Float32Array | number[], w: number, h: number, min = 0.5): number | null {
  for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) if (values[y * w + x] >= min) return y
  return null
}

/** The "Shorter / Longer" slider moves the bottom edge this far either way, as a share of the art height. */
export const LENGTH_RANGE = 0.15

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 3
