import { useState } from 'react'
import ReservationModal from './ReservationModal'

export default function ReservationLanding() {
  const [modalOpen, setModalOpen] = useState(false)

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
          Reserve a Table
        </button>
      </div>

      {/* Open Studio Hours */}
      <div style={{ maxWidth: '32rem', margin: '0 auto 3rem' }}>
        <h2 style={{
          fontSize: '1.25rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--color-dark)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}>
          Open Studio Hours
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { day: 'Thursday', hours: '4:00 PM – 9:00 PM' },
            { day: 'Friday', hours: '4:00 PM – 6:00 PM' },
            { day: 'Saturday', hours: '9:00 AM – 6:00 PM' },
            { day: 'Sunday', hours: '2:00 PM – 6:00 PM' },
          ].map(({ day, hours }) => (
            <div
              key={day}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.875rem 1.25rem',
                borderRadius: '0.75rem',
                background: 'rgba(255, 255, 255, 0.6)',
                border: '1px solid rgba(150, 112, 91, 0.08)',
              }}
            >
              <span style={{ fontWeight: 500, color: 'var(--color-dark)', fontSize: '0.875rem' }}>{day}</span>
              <span style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>{hours}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Walk-ins Welcome */}
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
          Walk-Ins Welcome
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          No reservation needed — just stop by during Open Studio hours.
          Grab a seat, pick a craft, and pay at the register.
        </p>
      </div>

      {/* Modal */}
      {modalOpen && <ReservationModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
