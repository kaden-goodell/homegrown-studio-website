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
      gap: '1.25rem',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    }}>
      {eventTypes.map((eventType) => (
        <div
          key={eventType.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '2rem',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
            backdropFilter: 'blur(20px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            borderRadius: '1rem',
            boxShadow: '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)',
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px) scale(1.01)'
            e.currentTarget.style.boxShadow = '0 20px 40px rgba(150, 112, 91, 0.12)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)'
          }}
        >
          {/* Duration badge */}
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

          {/* Title */}
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: 600,
            fontFamily: 'var(--font-heading)',
            color: 'var(--color-dark)',
            margin: '0 0 0.5rem 0',
            lineHeight: 1.2,
          }}>
            {eventType.name}
          </h3>

          {/* Description */}
          <p style={{
            fontSize: '0.875rem',
            lineHeight: 1.6,
            color: 'var(--color-muted)',
            margin: '0 0 1rem 0',
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}>
            {eventType.description}
          </p>

          {/* Metadata row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid rgba(150, 112, 91, 0.08)',
          }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              {eventType.flow === 'quote' ? 'Custom quote' : 'Book online'}
            </span>
            {eventType.baseCapacity && (
              <span style={{
                fontSize: '0.8125rem',
                color: 'var(--color-muted)',
              }}>
                Up to {eventType.baseCapacity} guests
              </span>
            )}
          </div>

          {/* Select button */}
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_EVENT_TYPE', payload: eventType })}
            style={{
              width: '100%',
              padding: '0.875rem',
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              color: '#fff',
              border: 'none',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
              transition: 'box-shadow 0.3s ease, transform 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 8px 25px rgba(150, 112, 91, 0.35)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(150, 112, 91, 0.2)'
              e.currentTarget.style.transform = 'none'
            }}
          >
            {eventType.flow === 'quote' ? 'Get a Quote' : 'Book Now'}
          </button>
        </div>
      ))}
    </div>
  )
}
