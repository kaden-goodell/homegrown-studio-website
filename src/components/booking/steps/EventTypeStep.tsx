import { useWizard } from '@components/booking/WizardContext'
import type { EventTypeConfig } from '@config/site.config'

interface EventTypeStepProps {
  eventTypes: EventTypeConfig[]
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (hours === 0) return `${remaining} min`
  if (remaining === 0) return `${hours} hour${hours > 1 ? 's' : ''}`
  return `${hours} hr ${remaining} min`
}

const iconMap: Record<string, string> = {
  cake: '🎂',
  palette: '🎨',
  briefcase: '💼',
}

export default function EventTypeStep({ eventTypes }: EventTypeStepProps) {
  const { dispatch } = useWizard()

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {eventTypes.map((eventType) => (
        <button
          key={eventType.id}
          type="button"
          onClick={() => dispatch({ type: 'SET_EVENT_TYPE', payload: eventType })}
          className="flex flex-col items-start gap-2 rounded-lg border border-gray-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {eventType.icon && (
            <span className="text-3xl" aria-hidden="true">
              {iconMap[eventType.icon] ?? eventType.icon}
            </span>
          )}
          <h3 className="text-lg font-semibold text-gray-900">{eventType.name}</h3>
          <p className="text-sm text-gray-600">{eventType.description}</p>
          <span className="mt-auto text-xs font-medium text-purple-600">
            {formatDuration(eventType.duration)}
          </span>
        </button>
      ))}
    </div>
  )
}
