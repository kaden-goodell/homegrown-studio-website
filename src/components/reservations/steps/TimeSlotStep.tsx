import { useState, useEffect } from 'react'
import { useReservation } from '../ReservationContext'

interface SlotData {
  startTime: string
  endTime: string
  durationMinutes: number
  tablesAvailable: number
  partyTableAvailable: boolean
  dedicatedHostAvailable: boolean
  wholeStudioAvailable: boolean
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return `${fmt(startIso)} \u2013 ${fmt(endIso)}`
}

export default function TimeSlotStep() {
  const { state, dispatch } = useReservation()
  const [slots, setSlots] = useState<SlotData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!state.date || !state.selectedVariation) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setSlots([])
    setSelectedIdx(null)

    async function fetchSlots() {
      try {
        const res = await fetch('/api/reservations/availability.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: state.date,
            serviceVariationId: state.selectedVariation!.id,
          }),
        })
        if (!res.ok) {
          throw new Error('Failed to load availability')
        }
        const json = await res.json()
        if (!cancelled) {
          setSlots(json.data?.slots ?? [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load availability')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchSlots()
    return () => { cancelled = true }
  }, [state.date, state.selectedVariation])

  function handleSelect(idx: number) {
    setSelectedIdx(idx)
  }

  function handleNext() {
    if (selectedIdx === null) return
    const slot = slots[selectedIdx]
    dispatch({
      type: 'SET_TIME_SLOT',
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      tablesAvailable: slot.tablesAvailable,
      partyTableAvailable: slot.partyTableAvailable,
      dedicatedHostAvailable: slot.dedicatedHostAvailable,
    })
    dispatch({ type: 'NEXT_STEP' })
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Checking availability...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <p style={{ fontSize: '0.875rem', color: '#dc2626' }}>{error}</p>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          No available times for this date. Try a different date.
        </p>
      </div>
    )
  }

  const canContinue = selectedIdx !== null

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {slots.map((slot, idx) => {
          const isSelected = selectedIdx === idx
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(idx)}
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
                transition: 'border-color 0.2s ease, background 0.2s ease',
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.25rem' }}>
                {formatTimeRange(slot.startTime, slot.endTime)}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                {slot.tablesAvailable} table{slot.tablesAvailable !== 1 ? 's' : ''} available
              </div>
            </button>
          )
        })}
      </div>

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
