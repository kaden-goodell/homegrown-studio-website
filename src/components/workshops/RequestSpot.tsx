import { useEffect, useRef, useState } from 'react'
import { siteConfig } from '@config/site.config'

const telHref = `tel:+1${siteConfig.contactPhone.replace(/\D/g, '')}`

/**
 * A class whose sign-ups closed early (made to order, or picks to prep):
 * "Request a spot" opens a short note and a button to call us, since we
 * sometimes have a spare (Kaden, 18 Oct 2026: "tell them just to call us").
 */
export default function RequestSpot() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Focus goes into the popup, Tab stays inside it, Escape closes it, and focus returns to the button.
  useEffect(() => {
    if (!open) return
    const opener = triggerRef.current
    dialogRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false)
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button'))
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [open])

  return (
    <>
      <button ref={triggerRef} type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setOpen(true)}>
        Request a spot
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(2px)' }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-spot-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '24rem',
              padding: '1.5rem',
              borderRadius: '1rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)',
              textAlign: 'left',
            }}
          >
            <h3 id="request-spot-title" style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>
              Request a spot
            </h3>
            <p style={{ margin: '0.6rem 0 1.1rem', fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--color-dark)' }}>
              Online sign-ups for this one have closed. Sometimes we have a spare, so give us a call and we’ll check.
            </p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <a className="btn btn-primary" style={{ width: '100%' }} href={telHref}>
                Call {siteConfig.contactPhone}
              </a>
              <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setOpen(false)}>
                Never mind
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
