import { useEffect, useState } from 'react'
import { trackRenameNotice } from '@lib/analytics'

/**
 * A small card that slides up once per visitor to say we used to be
 * Homegrown Studio (rebrand, 26 Sep 2026). Dismissing it remembers that on
 * this device. It sits under the booking panels (z 1000), so it never covers
 * a booking, and stays off the waiver.
 */
export const RENAME_NOTICE_KEY = 'hs-rename-notice-seen'
const SHOW_AFTER_MS = 1200

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(RENAME_NOTICE_KEY) === '1'
  } catch {
    // No storage means we can't remember a dismissal; stay quiet rather than nag.
    return true
  }
}

export default function RenameNotice() {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (window.location.pathname.startsWith('/waiver') || alreadySeen()) return
    const t = window.setTimeout(() => {
      setOpen(true)
      trackRenameNotice('shown')
      // Next frame, so the slide-up transition runs.
      window.requestAnimationFrame(() => setShown(true))
    }, SHOW_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [])

  if (!open) return null

  const close = (how: 'got_it' | 'close') => {
    try { window.localStorage.setItem(RENAME_NOTICE_KEY, '1') } catch { /* nothing to remember with */ }
    trackRenameNotice(how)
    setOpen(false)
  }

  return (
    <div
      role="dialog"
      aria-labelledby="rename-notice-title"
      style={{
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        marginInline: 'auto',
        maxWidth: '26rem',
        zIndex: 45,
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-line)',
        borderRadius: '1.25rem',
        boxShadow: '0 12px 40px rgba(var(--color-primary-rgb), 0.22)',
        padding: '1.25rem 1.25rem 1.1rem',
        transform: shown ? 'translateY(0)' : 'translateY(calc(100% + 2rem))',
        opacity: shown ? 1 : 0,
        transition: 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease',
      }}
    >
      <button
        type="button"
        onClick={() => close('close')}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: '0.6rem',
          right: '0.6rem',
          background: 'transparent',
          border: 'none',
          color: 'var(--color-muted)',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '0.4rem',
        }}
      >
        ✕
      </button>
      <h2
        id="rename-notice-title"
        className="font-heading"
        style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)', margin: '0 1.5rem 0.6rem 0' }}
      >
        Same studio, new name
      </h2>
      <p style={{ fontSize: '0.9375rem', lineHeight: 1.55, margin: '0 0 0.6rem' }}>
        If you knew us as Homegrown Studio, you're in the right place. Sadly, we're changing our name, and
        yes, we know it's confusing. We're a little confused too.
      </p>
      <p style={{ fontSize: '0.9375rem', lineHeight: 1.55, margin: '0 0 1rem' }}>
        We're Hometown Studio now. Same crafts, same people, same glitter we'll never fully get out of the carpet.
        We'll tell the whole story on our socials as soon as our attorneys clear what we can share.
      </p>
      <button
        type="button"
        onClick={() => close('got_it')}
        style={{
          width: '100%',
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '999px',
          padding: '0.7rem 1rem',
          fontSize: '0.9375rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Got it
      </button>
    </div>
  )
}
