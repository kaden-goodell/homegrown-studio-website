// src/components/shop/SilhouetteOrderButton.tsx
import { lazy, Suspense, useState } from 'react'
import { shopContent } from '@config/shop-content'
const SilhouetteOrderModal = lazy(() => import('@components/shop/SilhouetteOrderModal'))

export default function SilhouetteOrderButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>{shopContent.silhouettes.button}</button>
      {open && <Suspense fallback={null}><SilhouetteOrderModal onClose={() => setOpen(false)} /></Suspense>}
    </>
  )
}
