import type { CSSProperties } from 'react'

export interface StaffHeaderMember {
  name: string
}

const btn = (primary = false): CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(150,112,91,0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
})

/** Shared top bar for every signed-in staff screen: which screen, who's
 *  signed in, and the always-available nav (Switch identity, Incident —
 *  wired up in a later task, Kits, Log out). */
export default function StaffHeader({
  title,
  staff,
  onSwitch,
  onKits,
  onLogout,
}: {
  title: string
  staff: StaffHeaderMember
  onSwitch: () => void
  onKits: () => void
  onLogout: () => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', margin: 0 }}>
        {title} <span style={{ fontWeight: 400, fontSize: '0.875rem', color: 'var(--color-muted)' }}>· {staff.name}</span>
      </h2>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onSwitch} style={btn()}>Switch</button>
        <button type="button" disabled title="Coming soon" style={{ ...btn(), opacity: 0.5, cursor: 'not-allowed' }}>
          🚑 Incident
        </button>
        <button type="button" onClick={onKits} style={btn()}>Kits</button>
        <button type="button" onClick={onLogout} style={btn()}>Log out</button>
      </div>
    </div>
  )
}
