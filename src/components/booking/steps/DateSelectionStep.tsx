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
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSearch}
        disabled={loading || !startDate || !endDate}
        className="w-full rounded-md bg-purple-600 px-4 py-2 text-white font-medium shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Searching...' : 'Search Availability'}
      </button>
    </div>
  )
}
