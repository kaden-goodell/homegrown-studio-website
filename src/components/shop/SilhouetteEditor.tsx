// src/components/shop/SilhouetteEditor.tsx
import { useEffect, useRef, useState } from 'react'
import { CARD, cardLayout, autoPlace, cardCutY, edgeOffset, BOTTOM_STYLES, MIN_ZOOM, MAX_ZOOM, NAME_MAX, DATE_MAX, type BottomStyle, type Placement, type SilText } from '@lib/silhouette'
import { shopContent } from '@config/shop-content'
import type { Cutout } from '@components/shop/silhouette-cutout'

const C = shopContent.silhouetteModal
const FONT = '"Playfair Display", Georgia, serif'
/** On-screen card width, CSS px. */
const boxWidth = () => (typeof window === 'undefined' ? 220 : Math.max(180, Math.min(240, window.innerWidth - 64)))

export interface SilhouetteDesign { placement: Placement; text: SilText; bottom: BottomStyle }
export const DEFAULT_BOTTOM: BottomStyle = 'wave-right'

export async function loadCardFonts(): Promise<void> {
  try { await Promise.all([document.fonts.load(`600 64px ${FONT}`), document.fonts.load(`400 40px ${FONT}`)]) } catch { /* Georgia stands in */ }
}

/** Draws the printed card: white, the black silhouette with a bust cut, then the name and date. */
export function drawCard(ctx: CanvasRenderingContext2D, cut: Cutout, d: SilhouetteDesign, guides = false): void {
  const { art, nameY, dateY, nameSize, dateSize } = cardLayout(d.text)
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, CARD.w, CARD.h)
  // Clip to the art area, its bottom replaced by the bust edge (it follows the silhouette).
  const c = cardCutY(cut, d.placement, art, d.bottom)
  ctx.beginPath()
  ctx.moveTo(art.x, art.y)
  ctx.lineTo(art.x + art.w, art.y)
  for (let i = 64; i >= 0; i--) ctx.lineTo(art.x + (art.w * i) / 64, c + edgeOffset(d.bottom, i / 64, art.w))
  ctx.closePath()
  ctx.save()
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cut.canvas, d.placement.x, d.placement.y, cut.canvas.width * d.placement.scale, cut.canvas.height * d.placement.scale)
  ctx.restore()
  ctx.fillStyle = '#111'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const cx = CARD.w / 2
  if (nameY !== null) {
    let size = nameSize
    ctx.font = `600 ${size}px ${FONT}`
    while (size > 36 && ctx.measureText(d.text.name.trim()).width > art.w) { size -= 2; ctx.font = `600 ${size}px ${FONT}` }
    ctx.fillText(d.text.name.trim(), cx, nameY)
  }
  if (dateY !== null) {
    ctx.font = `400 ${dateSize}px ${FONT}`
    ctx.fillText(d.text.date.trim(), cx, dateY, art.w)
  }
  if (guides) {
    ctx.setLineDash([14, 10])
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(122,74,46,0.45)'
    ctx.strokeRect(CARD.inset, CARD.inset, CARD.w - 2 * CARD.inset, CARD.h - 2 * CARD.inset)
  }
  ctx.restore()
}

export async function renderCard(cut: Cutout, d: SilhouetteDesign): Promise<string> {
  await loadCardFonts()
  const c = document.createElement('canvas')
  c.width = CARD.w
  c.height = CARD.h
  drawCard(c.getContext('2d')!, cut, d)
  return c.toDataURL('image/jpeg', 0.92)
}

export default function SilhouetteEditor({ cut, initial, onDone, onCancel }: {
  cut: Cutout
  initial?: SilhouetteDesign
  onDone: (jpeg: string, design: SilhouetteDesign) => void
  onCancel: () => void
}) {
  const [W] = useState(boxWidth)
  const k = CARD.w / W // card px per screen px
  const [text, setText] = useState<SilText>(initial?.text ?? { name: '', date: '' })
  const [bottom, setBottom] = useState<BottomStyle>(initial?.bottom ?? DEFAULT_BOTTOM)
  const base = autoPlace(cut, cardLayout(text).art, bottom)
  const [placement, setPlacement] = useState<Placement>(initial?.placement ?? base)
  const [busy, setBusy] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  useEffect(() => { void loadCardFonts().then(() => setFontsReady(true)) }, [])
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) drawCard(ctx, cut, { placement, text, bottom }, true)
  }, [cut, placement, text, bottom, fontsReady])

  /** Zoom about the centre of the art area so the silhouette stays where it is. */
  function zoomTo(scale: number) {
    setPlacement((p) => {
      const s = Math.min(base.scale * MAX_ZOOM, Math.max(base.scale * MIN_ZOOM, scale))
      const { art } = cardLayout(text)
      const cx = art.x + art.w / 2
      const cy = art.y + art.h / 2
      return { scale: s, x: cx - ((cx - p.x) * s) / p.scale, y: cy - ((cy - p.y) * s) / p.scale }
    })
  }
  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: placement.scale }
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      zoomTo(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist))
    } else if (pointers.current.size === 1) {
      const dx = (e.clientX - prev.x) * k
      const dy = (e.clientY - prev.y) * k
      setPlacement((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  async function done() {
    setBusy(true)
    try { onDone(await renderCard(cut, { placement, text, bottom }), { placement, text, bottom }) } finally { setBusy(false) }
  }

  const field = { width: '100%', padding: '0.6rem 0.7rem', borderRadius: 10, border: '1px solid rgba(122,74,46,0.25)', fontSize: '1rem' } as const
  return (
    <div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'center' }}>
      <canvas
        ref={canvasRef} width={CARD.w} height={CARD.h} aria-label={C.previewLabel} role="img"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ width: W, height: W * 1.5, borderRadius: 4, boxShadow: '0 0 0 1px rgba(0,0,0,0.12), 0 4px 14px rgba(0,0,0,0.12)', touchAction: 'none', cursor: 'grab', background: '#fff' }}
      />
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: Math.max(W, 240) }}>
        <span style={{ fontSize: '0.85rem' }}>Zoom</span>
        <input type="range" aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={placement.scale / base.scale} onChange={(e) => zoomTo(Number(e.target.value) * base.scale)} style={{ flex: 1 }} />
      </label>
      <p style={{ margin: 0, fontSize: '0.85rem', textAlign: 'center', maxWidth: 300 }}>{C.dragHint}</p>
      <div role="group" aria-label={C.bottomLabel} style={{ display: 'grid', gap: '0.35rem', justifyItems: 'center' }}>
        <span style={{ fontSize: '0.85rem' }}>{C.bottomLabel}</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {BOTTOM_STYLES.map((b) => (
            <button key={b} type="button" aria-pressed={bottom === b} onClick={() => setBottom(b)}
              className={bottom === b ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.4rem 0.7rem', fontSize: 14 }}>
              {C.bottoms[b]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gap: '0.5rem', width: '100%', maxWidth: 320 }}>
        <label>{C.nameLabel}<input style={field} value={text.name} maxLength={NAME_MAX} onChange={(e) => setText({ ...text, name: e.target.value })} /></label>
        <label>{C.dateLabel}<input style={field} value={text.date} maxLength={DATE_MAX} placeholder={C.datePlaceholder} onChange={(e) => setText({ ...text, date: e.target.value })} /></label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={done} disabled={busy}>Done</button>
      </div>
    </div>
  )
}
