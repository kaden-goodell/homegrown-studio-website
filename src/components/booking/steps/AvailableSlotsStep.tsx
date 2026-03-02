import { useWizard } from '@components/booking/WizardContext'
import type { TimeSlot } from '@providers/interfaces/booking'

export interface AvailableSlotsStepProps {
  slots: TimeSlot[]
}

function groupByDate(slots: TimeSlot[]): Map<string, TimeSlot[]> {
  const grouped = new Map<string, TimeSlot[]>()
  for (const slot of slots) {
    const date = slot.startAt.split('T')[0]
    const existing = grouped.get(date) ?? []
    existing.push(slot)
    grouped.set(date, existing)
  }
  return grouped
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function AvailableSlotsStep({ slots }: AvailableSlotsStepProps) {
  const { dispatch } = useWizard()

  if (slots.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">No available slots found. Try different dates.</p>
      </div>
    )
  }

  const grouped = groupByDate(slots)

  function handleSelect(slot: TimeSlot) {
    dispatch({ type: 'SET_SLOT', payload: slot })
    dispatch({ type: 'GO_TO_STEP', payload: 3 })
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([date, dateSlots]) => (
        <div key={date}>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">{formatDate(date)}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dateSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => handleSelect(slot)}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-purple-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <span className="font-medium text-gray-900">{formatTime(slot.startAt)}</span>
                <span className="text-sm text-gray-500">{slot.duration} min</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
