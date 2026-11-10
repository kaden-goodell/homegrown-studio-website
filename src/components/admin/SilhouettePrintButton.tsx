// src/components/admin/SilhouettePrintButton.tsx
import { useEffect, useRef, useState } from 'react'

/**
 * One silhouette card to the mini photo printer. On the iPad this opens the share sheet with the
 * 2"×3" image, so it can go straight to the printer's app (or Save Image). The image is fetched
 * ahead of the tap: Safari only allows sharing straight from a tap.
 */
export function SilhouettePrintButton({ src, filename, label = 'Print' }: { src: string; filename: string; label?: string }) {
  const file = useRef<File | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    fetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!live || !b) return
      file.current = new File([b], filename, { type: 'image/jpeg' })
      setReady(true)
    }).catch(() => undefined)
    return () => { live = false }
  }, [src, filename])

  async function share() {
    const f = file.current
    if (f && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f] }); return } catch (err) { if ((err as Error)?.name === 'AbortError') return }
    }
    window.open(src, '_blank', 'noopener') // no share sheet: open the image to save or print
  }
  return <button type="button" className="btn btn-primary" onClick={share} disabled={!ready} style={{ padding: '0.45rem 0.8rem', fontSize: 14 }}>{label}</button>
}
