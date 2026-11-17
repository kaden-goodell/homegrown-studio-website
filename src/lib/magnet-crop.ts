import { shopConfig } from '@config/shop.config'

export interface Size { w: number; h: number }
/** zoom ≥ 1 on top of cover-fit; x/y = image centre offset from the square's centre, in source px. */
export interface Crop { zoom: number; x: number; y: number }
export const MAX_ZOOM = 6

/** Scale that makes the image's short side exactly fill a square of `boxPx`. */
export function coverScale(img: Size, boxPx: number): number {
  return boxPx / Math.min(img.w, img.h)
}

/** The square of the source image the magnet shows. */
export function sourceRect(img: Size, crop: Crop): { sx: number; sy: number; side: number } {
  const side = Math.min(img.w, img.h) / crop.zoom
  return { sx: img.w / 2 - crop.x - side / 2, sy: img.h / 2 - crop.y - side / 2, side }
}

export function clampCrop(img: Size, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom))
  const side = Math.min(img.w, img.h) / zoom
  const maxX = (img.w - side) / 2
  const maxY = (img.h - side) / 2
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v))
  return { zoom, x: clamp(crop.x, maxX), y: clamp(crop.y, maxY) }
}

export function printQuality(img: Size, crop: Crop): 'good' | 'low' {
  return sourceRect(img, crop).side < shopConfig.magnets.minSharpSourcePx ? 'low' : 'good'
}
