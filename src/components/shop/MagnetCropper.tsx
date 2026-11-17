// src/components/shop/MagnetCropper.tsx
import { useRef, useState } from 'react'
import { clampCrop, coverScale, printQuality, sourceRect, MAX_ZOOM, type Crop, type Size } from '@lib/magnet-crop'
import { shopConfig } from '@config/shop.config'
import { shopContent } from '@config/shop-content'

/** On-screen square, CSS px: 280, smaller on narrow phones. */
const boxSize = () => (typeof window === 'undefined' ? 280 : Math.max(220, Math.min(280, window.innerWidth - 48)))

export interface MagnetCropperProps {
  src: string
  size: Size
  initial?: Crop
  onDone: (jpegDataUrl: string, crop: Crop, quality: 'good' | 'low') => void
  onCancel: () => void
}

export async function renderMagnet(src: string, size: Size, crop: Crop): Promise<string> {
  const out = shopConfig.magnets.outputPx
  const img = new Image()
  img.src = src
  await img.decode()
  const { sx, sy, side } = sourceRect(size, crop)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, out, out)
  return canvas.toDataURL('image/jpeg', 0.88)
}

export default function MagnetCropper({ src, size, initial, onDone, onCancel }: MagnetCropperProps) {
  const [BOX] = useState(boxSize)
  const [crop, setCrop] = useState<Crop>(initial ?? { zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  const scale = coverScale(size, BOX) * crop.zoom // screen px per source px
  const update = (next: Crop | ((c: Crop) => Crop)) => setCrop((c) => clampCrop(size, typeof next === 'function' ? next(c) : next))
  const quality = printQuality(size, crop)
  const inset = shopConfig.magnets.safeInset * 100

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom }
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const zoom = pinchStart.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.current.dist)
      update((c) => ({ ...c, zoom }))
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      // functional update: several moves can arrive before React re-renders
      update((c) => { const sc = coverScale(size, BOX) * c.zoom; return { ...c, x: c.x + dx / sc, y: c.y + dy / sc } })
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }

  async function done() {
    setBusy(true)
    try { onDone(await renderMagnet(src, size, crop), crop, quality) } finally { setBusy(false) }
  }

  const imgW = size.w * scale
  const imgH = size.h * scale
  return (
    <div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'center' }}>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', width: BOX, height: BOX, overflow: 'hidden', borderRadius: 4, touchAction: 'none', background: '#000', cursor: 'grab' }}
      >
        <img src={src} alt="" draggable={false} style={{
          position: 'absolute', width: imgW, height: imgH, maxWidth: 'none',
          left: BOX / 2 - imgW / 2 + crop.x * scale, top: BOX / 2 - imgH / 2 + crop.y * scale, userSelect: 'none', pointerEvents: 'none',
        }} />
        <div data-testid="safe-area" aria-hidden style={{ position: 'absolute', inset: `${inset}%`, border: '2px dashed rgba(255,255,255,0.9)', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
      </div>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: BOX }}>
        <span style={{ fontSize: '0.85rem' }}>Zoom</span>
        <input type="range" aria-label="Zoom" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })} style={{ flex: 1 }} />
      </label>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', maxWidth: BOX, textAlign: 'center' }}>{shopContent.modal.closeUpHint}</p>
      {quality === 'low' && <p role="status" style={{ margin: 0, fontSize: '0.85rem', color: '#9a3412', maxWidth: BOX, textAlign: 'center' }}>{shopContent.modal.blurryWarning}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={done} disabled={busy}>Done</button>
      </div>
    </div>
  )
}
