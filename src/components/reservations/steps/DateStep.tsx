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

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function DateStep() {
  const { state, dispatch } = useReservation()
  const [hovered, setHovered] = useState(false)

  const variations = state.serviceInfo?.variations ?? []
  const canContinue = !!state.date && !!state.selectedVariation

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

      {/* Duration / variation picker */}
      {variations.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{
            display: 'block',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            marginBottom: '0.5rem',
          }}>
            Select Duration
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {variations.map((v) => {
              const isSelected = state.selectedVariation?.id === v.id
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_VARIATION', variation: v })}
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '0.75rem',
                    border: isSelected
                      ? '2px solid var(--color-primary)'
                      : '1px solid rgba(150, 112, 91, 0.15)',
                    background: isSelected
                      ? 'rgba(150, 112, 91, 0.05)'
                      : 'rgba(255, 255, 255, 0.8)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'border-color 0.2s ease, background 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                    {v.name}
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                    {formatPrice(v.priceCents)} / table
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
