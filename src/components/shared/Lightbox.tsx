import { useState, useEffect, useCallback } from 'react'

interface GalleryItem {
  id: string
  title: string
  caption: string
  image: string
}

export default function Lightbox({ items }: { items: GalleryItem[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const close = useCallback(() => setIsOpen(false), [])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % items.length)
  }, [items.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + items.length) % items.length)
  }, [items.length])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setCurrentIndex(detail.index)
      setIsOpen(true)
    }
    window.addEventListener('open-lightbox', handler)
    return () => window.removeEventListener('open-lightbox', handler)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handler)
    }
  }, [isOpen, close, goNext, goPrev])

  if (!isOpen) return null

  const item = items[currentIndex]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      style={{ animation: 'lightbox-fade-in 0.25s ease' }}
    >
      <div className="absolute inset-0 bg-black/80" />

      <div
        className="relative z-10 flex flex-col items-center max-w-3xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={close}
          className="absolute -top-12 right-0 text-white/80 hover:text-white transition-colors text-sm tracking-wide uppercase"
          aria-label="Close lightbox"
        >
          Close
        </button>

        {/* Image area */}
        <div className="w-full rounded-lg overflow-hidden shadow-2xl">
          <img
            src={item.image}
            alt={item.title}
            className="w-full h-auto"
            style={{ aspectRatio: '4 / 3', objectFit: 'cover' }}
          />
        </div>

        {/* Caption */}
        <div className="mt-6 text-center">
          <h3 className="text-white text-xl font-semibold tracking-wide">
            {item.title}
          </h3>
          <p className="text-white/60 mt-1 text-sm">{item.caption}</p>
          <p className="text-white/40 mt-3 text-xs tracking-widest uppercase">
            {currentIndex + 1} / {items.length}
          </p>
        </div>

        {/* Previous */}
        <button
          onClick={goPrev}
          className="absolute top-1/2 -left-4 sm:-left-14 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
          aria-label="Previous image"
        >
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Next */}
        <button
          onClick={goNext}
          className="absolute top-1/2 -right-4 sm:-right-14 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
          aria-label="Next image"
        >
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes lightbox-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
