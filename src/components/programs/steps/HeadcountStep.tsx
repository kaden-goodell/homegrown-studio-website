import { useEnrollment } from '../EnrollmentContext'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

export default function HeadcountStep() {
  const { state, dispatch } = useEnrollment()
  const { program, headcount, selectedSessions } = state

  const sessionCount = selectedSessions.length
  const perChild = program.pricePerHead * sessionCount
  const total = perChild * headcount

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <label
          htmlFor="headcount"
          style={{
            display: 'block',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            marginBottom: '0.5rem',
          }}
        >
          How many children?
        </label>
        <input
          id="headcount"
          type="number"
          min={1}
          max={program.maxCapacity}
          value={headcount}
          onChange={(e) => dispatch({ type: 'SET_HEADCOUNT', payload: Math.max(1, Math.min(program.maxCapacity, Number(e.target.value))) })}
          style={{
            width: '5rem',
            padding: '0.75rem 1rem',
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.1)',
            borderRadius: '0.75rem',
            fontSize: '1rem',
            color: 'var(--color-dark)',
            outline: 'none',
          }}
        />
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginTop: '0.375rem' }}>
          Max {program.maxCapacity} per session
        </p>
      </div>

      {/* Price summary */}
      <div style={{
        padding: '1rem 1.25rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '0.75rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
          <span>{formatPrice(program.pricePerHead)} &times; {headcount} child{headcount > 1 ? 'ren' : ''} &times; {sessionCount} session{sessionCount > 1 ? 's' : ''}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-dark)' }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        style={{
          padding: '0.875rem',
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue
      </button>
    </div>
  )
}
