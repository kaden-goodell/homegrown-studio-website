import type { CSSProperties } from 'react'
import type { StaffMember } from '@lib/staff-auth'

const card: CSSProperties = {
  border: '1px solid rgba(var(--color-primary-rgb),0.16)',
  borderRadius: '1rem',
  padding: '1.1rem 1.2rem',
  boxShadow: '0 8px 24px rgba(var(--color-primary-rgb),0.08)',
}
const tile: CSSProperties = {
  padding: '1.1rem 0.8rem',
  borderRadius: '0.75rem',
  border: '1px solid rgba(var(--color-primary-rgb),0.3)',
  background: 'rgba(255,255,255,0.85)',
  color: 'var(--color-dark)',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'center',
}

/** "Who's on the iPad?" — the second step of staff login, picking an identity
 *  from the Square team roster so every custody action can be stamped with a
 *  real name. The passcode was already verified by `login.json`; picking a
 *  name re-sends it (kept in a ref by the caller) to `pick.json`, which sets
 *  the signed identity cookie. */
export default function PickStaff({
  staff,
  busy,
  error,
  showBack,
  onPick,
  onBack,
}: {
  staff: StaffMember[]
  busy: boolean
  error: string | null
  /** Only true when the pick attempt itself was rejected (401 — stale/changed
   *  passcode). A rate limit (429) or a storage hiccup (503) isn't an auth
   *  problem, so re-entering the passcode wouldn't help — don't offer it. */
  showBack: boolean
  onPick: (staffId: string) => void
  /** Re-enter the passcode — the escape hatch when a pick attempt 401s. */
  onBack: () => void
}) {
  return (
    <div style={{ ...card, background: 'rgba(255,255,255,0.85)', maxWidth: '28rem', margin: '0 auto', textAlign: 'center' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.35rem' }}>
        Who’s on the iPad?
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>Pick your name to sign in.</p>
      {error && (
        <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.6rem' }}>
          {error}
          {showBack && (
            <>
              {' '}
              <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: '#b91c1c', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}>
                Re-enter passcode
              </button>
            </>
          )}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.6rem' }}>
        {staff.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(m.id)}
            style={{ ...tile, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
          >
            {m.name}
          </button>
        ))}
      </div>
    </div>
  )
}
