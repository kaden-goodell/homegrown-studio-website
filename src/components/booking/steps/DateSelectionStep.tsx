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
  const [duration, setDuration] = useState(state.eventType?.duration ? state.eventType.duration / 60 : 2)
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

      const slots: TimeSlot[] = await res.json()
      onSlotsLoaded(slots)
      dispatch({ type: 'GO_TO_STEP', payload: 2 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <DateRangePicker
        startDate={startDate}
        endDate={endDate}
        onStartChange={setStartDate}
        onEndChange={setEndDate}
      />

      <div className="space-y-4">
        {isQuoteFlow && (
          <div>
            <label htmlFor="duration" className="block text-sm font-medium text-gray-700">
              Duration (hours)
            </label>
            <input
              id="duration"
              type="number"
              min={1}
              max={12}
              value={duration}
              onChange={(e) => {
                const val = Number(e.target.value)
                setDuration(val)
                dispatch({ type: 'SET_DESIRED_DURATION', payload: val * 60 })
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSearch}
        disabled={loading || !startDate || !endDate}
        className="w-full rounded-md bg-primary px-4 py-2 text-white font-medium shadow-sm hover:brightness-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Searching...' : 'Search Availability'}
      </button>
    </div>
  )
}
