import { useState } from 'react'
import { useReservation } from '../ReservationContext'

function getTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function getMaxDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString().split('T')[0]
}

export default function DateStep() {
  const { state, dispatch } = useReservation()
  const [hovered, setHovered] = useState(false)

  const canContinue = !!state.date

  function handleNext() {
    if (!canContinue) return
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div>
      {/* Date picker */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{
          display: 'block',
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: 'var(--color-dark)',
          marginBottom: '0.375rem',
        }}>
          Select a Date
        </label>
        <input
          type="date"
          value={state.date ?? ''}
          min={getTomorrow()}
          max={getMaxDate()}
          onChange={(e) => dispatch({ type: 'SET_DATE', date: e.target.value })}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            border: '1px solid rgba(150, 112, 91, 0.15)',
            background: 'rgba(255, 255, 255, 0.8)',
            fontSize: '0.875rem',
            color: 'var(--color-text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Next button */}
      <button
        type="button"
        onClick={handleNext}
        disabled={!canContinue}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: canContinue
            ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
            : 'rgba(150, 112, 91, 0.2)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: canContinue ? 'pointer' : 'default',
          opacity: canContinue ? 1 : 0.5,
          boxShadow: canContinue && hovered ? '0 8px 25px rgba(150, 112, 91, 0.35)' : canContinue ? '0 4px 15px rgba(150, 112, 91, 0.2)' : 'none',
          transform: canContinue && hovered ? 'translateY(-1px)' : 'none',
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        Next
      </button>
    </div>
  )
}
