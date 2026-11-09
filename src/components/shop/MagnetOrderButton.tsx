// src/components/shop/MagnetOrderButton.tsx
import { lazy, Suspense, useState } from 'react'
import { shopContent } from '@config/shop-content'
const MagnetOrderModal = lazy(() => import('@components/shop/MagnetOrderModal'))

export default function MagnetOrderButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>{shopContent.magnets.button}</button>
      {open && <Suspense fallback={null}><MagnetOrderModal onClose={() => setOpen(false)} /></Suspense>}
    </>
  )
}
