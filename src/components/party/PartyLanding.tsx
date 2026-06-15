import { useState, useEffect } from 'react'
import PartyModal from './PartyModal'

export default function PartyLanding() {
  const [modalOpen, setModalOpen] = useState(false)
  const [initialStart, setInitialStart] = useState<string | undefined>(undefined)

  // Deeplink: if loaded with `?start=<ISO>` (e.g. from the calendar), auto-open
  // the modal and let it jump straight to the Craft step. Guarded for SSR.
  useEffect(() => {
    const start = new URLSearchParams(window.location.search).get('start')
    if (start) {
      setInitialStart(start)
      setModalOpen(true)
    }
  }, [])

  return (
    <div>
      {/* CTA Button */}
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: '1rem 2.5rem',
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            color: '#fff',
            border: 'none',
            borderRadius: '0.75rem',
            fontSize: '1.125rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
            transition: 'box-shadow 0.3s ease, transform 0.3s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.boxShadow = '0 8px 25px rgba(150, 112, 91, 0.35)'
            e.currentTarget.style.transform = 'translateY(-2px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.boxShadow = '0 4px 15px rgba(150, 112, 91, 0.2)'
            e.currentTarget.style.transform = 'none'
          }}
        >
          Book a Party
        </button>
      </div>

      {/* How it works */}
      <div style={{ maxWidth: '32rem', margin: '0 auto 3rem' }}>
        <h2 style={{
          fontSize: '1.25rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--color-dark)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}>
          How It Works
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { step: '1', text: 'Pick a date and start time' },
            { step: '2', text: 'Choose a craft for your group' },
            { step: '3', text: 'Tell us how many guests' },
            { step: '4', text: 'Reserve with payment' },
          ].map(({ step, text }) => (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.875rem 1.25rem',
                borderRadius: '0.75rem',
                background: 'rgba(255, 255, 255, 0.6)',
                border: '1px solid rgba(150, 112, 91, 0.08)',
              }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: '50%',
                background: 'rgba(150, 112, 91, 0.12)',
                color: 'var(--color-primary)',
                fontWeight: 600,
                fontSize: '0.8125rem',
                flexShrink: 0,
              }}>
                {step}
              </span>
              <span style={{ fontWeight: 500, color: 'var(--color-dark)', fontSize: '0.875rem' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing callout */}
      <div style={{
        maxWidth: '32rem',
        margin: '0 auto',
        textAlign: 'center',
        padding: '2rem',
        borderRadius: '1rem',
        background: 'rgba(34, 197, 94, 0.06)',
        border: '1px solid rgba(34, 197, 94, 0.15)',
      }}>
        <h3 style={{
          fontSize: '1.125rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--color-dark)',
          marginBottom: '0.5rem',
        }}>
          The Whole Studio Is Yours
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          Rent the entire studio for a private party — a $200 studio fee plus the
          craft cost per guest. Bring your group, pick a project, and create together.
        </p>
      </div>

      {/* Modal */}
      {modalOpen && (
        <PartyModal
          onClose={() => { setModalOpen(false); setInitialStart(undefined) }}
          initialStart={initialStart}
        />
      )}
    </div>
  )
}
