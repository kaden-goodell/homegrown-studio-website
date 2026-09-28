import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { SITE_URL } from '@config/class-booking.config'

const WAIVER_URL = `${SITE_URL}/waiver`

/**
 * "Show QR" — a guest scans this on their own phone to sign the agreement
 * without ever touching the shared staff iPad. Rendered client-side as
 * inline SVG (no external image host — CSP, and it works with wifi down).
 */
export default function QrModal({ onClose }: { onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toString(WAIVER_URL, { type: 'svg', margin: 1 }).then((s) => {
      if (!cancelled) setSvg(s)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan to sign"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '22rem',
          padding: '1.5rem',
          borderRadius: '1rem',
          background: '#fff',
          textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.3)',
        }}
      >
        <h3 style={{ margin: '0 0 0.35rem', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>
          Scan to sign
        </h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          Point your phone’s camera here — signs the agreement on your own device.
        </p>
        <div style={{ background: '#fff', border: '1px solid rgba(var(--color-primary-rgb),0.16)', borderRadius: '0.75rem', padding: '0.75rem', minHeight: '12rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {svg ? (
            <div style={{ width: '100%', maxWidth: '11rem' }} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.8125rem' }}>Loading…</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: '1.1rem',
            padding: '0.6rem 1.2rem',
            borderRadius: '0.625rem',
            border: 'none',
            background: 'var(--color-primary)',
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
