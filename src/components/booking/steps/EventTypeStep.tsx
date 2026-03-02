import { useWizard } from '@components/booking/WizardContext'
import type { EventTypeConfig } from '@config/site.config'

interface EventTypeStepProps {
  eventTypes: EventTypeConfig[]
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (hours === 0) return `${remaining} min`
  if (remaining === 0) return `${hours} hr${hours > 1 ? 's' : ''}`
  return `${hours} hr ${remaining} min`
}

export default function EventTypeStep({ eventTypes }: EventTypeStepProps) {
  const { dispatch } = useWizard()

  return (
    <div style={{
      display: 'grid',
      gap: '1rem',
      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    }}>
      {eventTypes.map((eventType) => (
        <button
          key={eventType.id}
          type="button"
          onClick={() => dispatch({ type: 'SET_EVENT_TYPE', payload: eventType })}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: '2rem',
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(150, 112, 91, 0.08)',
            borderRadius: '1rem',
            textAlign: 'left',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.07)',
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)'
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(150, 112, 91, 0.12)'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.07)'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)'
          }}
        >
          <span style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-primary)',
            marginBottom: '0.75rem',
          }}>
            {formatDuration(eventType.duration)}
          </span>
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: 600,
            fontFamily: 'var(--font-heading)',
            color: 'var(--color-dark)',
            margin: '0 0 0.625rem 0',
            lineHeight: 1.2,
          }}>
            {eventType.name}
          </h3>
          <p style={{
            fontSize: '0.875rem',
            lineHeight: 1.6,
            color: 'var(--color-muted)',
            margin: 0,
          }}>
            {eventType.description}
          </p>
          <span style={{
            marginTop: 'auto',
            paddingTop: '1.25rem',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            transition: 'gap 0.3s ease',
          }}>
            Select
            <span aria-hidden="true" style={{ fontSize: '0.75rem' }}>&rarr;</span>
          </span>
        </button>
      ))}
    </div>
  )
}
