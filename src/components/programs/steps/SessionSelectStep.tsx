import { useEnrollment } from '../EnrollmentContext'
import type { ProgramSessionConfig } from '@config/site.config'

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
}

function isSessionPastCutoff(session: ProgramSessionConfig): boolean {
  const cutoff = new Date(session.startDate + 'T00:00:00')
  cutoff.setDate(cutoff.getDate() - 1)
  cutoff.setHours(21, 0, 0, 0) // 9 PM CT night before
  return new Date() >= cutoff
}

export default function SessionSelectStep() {
  const { state, dispatch } = useEnrollment()
  const { program, selectedSessions } = state

  function toggleSession(session: ProgramSessionConfig) {
    const isSelected = selectedSessions.some(s => s.id === session.id)
    const updated = isSelected
      ? selectedSessions.filter(s => s.id !== session.id)
      : [...selectedSessions, session]
    dispatch({ type: 'SET_SESSIONS', payload: updated })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
        Select the session(s) you'd like to enroll in:
      </p>

      {program.sessions.map((session) => {
        const closed = isSessionPastCutoff(session)
        const selected = selectedSessions.some(s => s.id === session.id)

        return (
          <button
            key={session.id}
            type="button"
            disabled={closed}
            onClick={() => toggleSession(session)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem 1.25rem',
              background: selected
                ? 'linear-gradient(135deg, rgba(150, 112, 91, 0.1) 0%, rgba(150, 112, 91, 0.05) 100%)'
                : 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
              backdropFilter: 'blur(20px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
              border: selected
                ? '1.5px solid var(--color-primary)'
                : '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '0.75rem',
              cursor: closed ? 'not-allowed' : 'pointer',
              opacity: closed ? 0.5 : 1,
              boxShadow: '0 4px 16px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
              transition: 'all 0.3s ease',
              textAlign: 'left',
            }}
          >
            <div>
              <span style={{
                fontSize: '0.9375rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
              }}>
                {session.name}
              </span>
              <span style={{
                display: 'block',
                fontSize: '0.8125rem',
                color: 'var(--color-muted)',
                marginTop: '0.125rem',
              }}>
                {formatDateRange(session.startDate, session.endDate)}
              </span>
            </div>
            {closed ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                Enrollment closed
              </span>
            ) : (
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: selected ? 'var(--color-primary)' : 'var(--color-muted)',
              }}>
                {selected ? 'Selected' : 'Select'}
              </span>
            )}
          </button>
        )
      })}

      <button
        type="button"
        disabled={selectedSessions.length === 0}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        style={{
          marginTop: '0.5rem',
          padding: '0.875rem',
          background: selectedSessions.length > 0 ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: selectedSessions.length > 0 ? 'pointer' : 'not-allowed',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (selectedSessions.length > 0) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue
      </button>
    </div>
  )
}
