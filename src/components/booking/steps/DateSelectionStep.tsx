import { useState } from 'react'
import { useWizard } from '@components/booking/WizardContext'
import DateRangePicker from '@components/shared/DateRangePicker'
import type { TimeSlot } from '@providers/interfaces/booking'

export interface DateSelectionStepProps {
  onSlotsLoaded: (slots: TimeSlot[]) => void
}

export default function DateSelectionStep({ onSlotsLoaded }: DateSelectionStepProps) {
  const { state, dispatch } = useWizard()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [duration, setDuration] = useState(() => {
    const hrs = state.eventType?.duration ? state.eventType.duration / 60 : 2
    return Math.min(4, Math.max(2, hrs))
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isQuoteFlow = state.eventType?.flow === 'quote'

  async function handleSearch() {
    if (!startDate || !endDate) return

    setLoading(true)
    setError(null)

    dispatch({ type: 'SET_DATES', payload: { start: startDate, end: endDate } })

    try {
      const res = await fetch('/api/booking/availability.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, locationId: 'main' }),
      })

      if (!res.ok) throw new Error('Failed to fetch availability')

      const json = await res.json()
      const slots: TimeSlot[] = Array.isArray(json) ? json : json.data ?? []
      onSlotsLoaded(slots)
      dispatch({ type: 'GO_TO_STEP', payload: 2 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '28rem', margin: '0 auto' }}>
      <DateRangePicker
        startDate={startDate}
        endDate={endDate}
        onStartChange={setStartDate}
        onEndChange={setEndDate}
      />

      {isQuoteFlow && (
        <div style={{ marginTop: '1.25rem' }}>
          <label
            htmlFor="duration"
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
              color: 'var(--color-muted)',
            }}
          >
            Duration (hours)
          </label>
          <input
            id="duration"
            type="number"
            min={2}
            max={4}
            value={duration}
            onChange={(e) => {
              const val = Number(e.target.value)
              setDuration(val)
              dispatch({ type: 'SET_DESIRED_DURATION', payload: val * 60 })
            }}
            style={{
              marginTop: '0.375rem',
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '0.875rem',
              color: 'var(--color-dark)',
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(150, 112, 91, 0.12)',
              borderRadius: '0.75rem',
              outline: 'none',
            }}
          />
        </div>
      )}

      {error && (
        <p style={{
          marginTop: '1rem',
          fontSize: '0.875rem',
          color: '#dc2626',
        }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSearch}
        disabled={loading || !startDate || !endDate}
        style={{
          marginTop: '1.5rem',
          width: '100%',
          padding: '0.875rem 1.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: '#fff',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          border: 'none',
          borderRadius: '0.75rem',
          cursor: loading || !startDate || !endDate ? 'not-allowed' : 'pointer',
          opacity: loading || !startDate || !endDate ? 0.5 : 1,
          boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
          transition: 'transform 0.3s ease, box-shadow 0.3s ease, opacity 0.3s ease',
        }}
        onMouseEnter={(e) => {
          if (!e.currentTarget.disabled) {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 8px 25px rgba(150, 112, 91, 0.3)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'none'
          e.currentTarget.style.boxShadow = '0 4px 15px rgba(150, 112, 91, 0.2)'
        }}
      >
        {loading ? 'Searching...' : 'Search Availability'}
      </button>
    </div>
  )
}
