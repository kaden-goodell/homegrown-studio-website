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
      <div style={{ padding: '3rem 0', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9375rem' }}>
          No available slots found. Try different dates.
        </p>
      </div>
    )
  }

  const sorted = [...slots].sort((a, b) => a.startAt.localeCompare(b.startAt))
  const grouped = groupByDate(sorted)

  function handleSelect(slot: TimeSlot) {
    dispatch({ type: 'SET_SLOT', payload: slot })
    dispatch({ type: 'GO_TO_STEP', payload: 4 })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {Array.from(grouped.entries()).map(([date, dateSlots]) => (
        <div key={date}>
          <h3 style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            marginBottom: '0.75rem',
          }}>
            {formatDate(date)}
          </h3>
          <div style={{
            display: 'grid',
            gap: '0.625rem',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          }}>
            {dateSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => handleSelect(slot)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.875rem 1rem',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
                  backdropFilter: 'blur(20px) saturate(1.3)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
                  border: '1px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: '0.75rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)',
                  transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(150, 112, 91, 0.1)'
                  e.currentTarget.style.borderColor = 'rgba(150, 112, 91, 0.15)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none'
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(150, 112, 91, 0.06)'
                  e.currentTarget.style.borderColor = 'rgba(150, 112, 91, 0.06)'
                }}
              >
                <span style={{
                  fontWeight: 500,
                  fontSize: '0.9375rem',
                  color: 'var(--color-dark)',
                }}>
                  {formatTime(slot.startAt)}
                </span>
                <span style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-muted)',
                }}>
                  {slot.duration} min
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
