import type { ProgramConfig } from '@config/site.config'

interface ProgramCardProps {
  program: ProgramConfig
  onEnroll: (program: ProgramConfig) => void
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

function formatAgeRange(range?: { min: number; max: number }): string | null {
  if (!range) return null
  return `Ages ${range.min}–${range.max}`
}

export default function ProgramCard({ program, onEnroll }: ProgramCardProps) {
  const priceLabel = program.enrollmentType === 'per-session'
    ? `${formatPrice(program.pricePerHead)} / child / session`
    : `${formatPrice(program.pricePerHead)} / child`

  const sessionSummary = program.enrollmentType === 'per-session'
    ? `${program.sessions.length} sessions available`
    : program.sessions[0]?.name ?? ''

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
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
      {/* Schedule badge */}
      <span style={{
        fontSize: '0.6875rem',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--color-primary)',
        marginBottom: '0.75rem',
      }}>
        {program.schedule.days} &middot; {program.schedule.time}
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
        {program.name}
      </h3>

      {/* Age range */}
      {program.ageRange && (
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--color-muted)',
          marginBottom: '0.625rem',
        }}>
          {formatAgeRange(program.ageRange)}
        </span>
      )}

      {/* Description */}
      <p style={{
        fontSize: '0.875rem',
        lineHeight: 1.6,
        color: 'var(--color-muted)',
        margin: '0 0 1rem 0',
        flex: 1,
      }}>
        {program.description}
      </p>

      {/* Session count + price */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '1.25rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid rgba(150, 112, 91, 0.08)',
      }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          {sessionSummary}
        </span>
        <span style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: 'var(--color-dark)',
        }}>
          {priceLabel}
        </span>
      </div>

      {/* Enroll button */}
      <button
        type="button"
        onClick={() => onEnroll(program)}
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
        Enroll Now
      </button>
    </div>
  )
}
