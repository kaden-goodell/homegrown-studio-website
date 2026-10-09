import type { Household } from '@components/staff/HouseholdCard'
import { btn } from '@components/staff/ui'
import { formatMonthDayYear } from '@lib/studio-time'

/**
 * Roster "Agreement": what this family signed, read-only, in one place —
 * who signed, everyone covered with allergies and medications, emergency
 * contact, pickup list, photo choice, and the version and dates.
 */
export default function AgreementSheet({ h, dropOff, onClose }: { h: Household; dropOff: boolean; onClose: () => void }) {
  const expired = Date.parse(h.validUntil) < Date.now()
  const row = { margin: '0 0 0.55rem', fontSize: '0.9rem', color: 'var(--color-dark)' } as const
  const label = { display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' } as const
  const none = <span style={{ color: 'var(--color-muted)' }}>none</span>
  const health = (allergies: string, meds?: string) => (
    <>
      {allergies && allergies.toLowerCase() !== 'none' ? <span style={{ color: '#b91c1c', fontWeight: 600 }}> · ⚠ {allergies}</span> : null}
      {meds ? <span style={{ fontWeight: 600 }}> · 💊 {meds}</span> : null}
    </>
  )
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${h.signer}'s agreement`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div style={{
        width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto', padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>Agreement · {h.signer}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        <p style={row}>
          <span style={label}>Signed</span>
          {formatMonthDayYear(h.signedAt)} · version {h.agreementVersion} ·{' '}
          {expired ? <strong style={{ color: '#b91c1c' }}>EXPIRED {formatMonthDayYear(h.validUntil)}</strong> : `valid through ${formatMonthDayYear(h.validUntil)}`}
        </p>
        <p style={row}>
          <span style={label}>Signed by</span>
          👤 {h.signer}{health(h.adultAllergies)}<br />
          <a href={`tel:${h.phone}`} style={{ color: 'var(--color-primary)' }}>{h.phone}</a> · {h.email}
        </p>
        <div style={row}>
          <span style={label}>Kids on this agreement</span>
          {h.children.length === 0 ? none : h.children.map((c, i) => (
            <div key={i}>🧒 {c.name}{health(c.allergies, c.medications)}</div>
          ))}
        </div>
        <p style={row}>
          <span style={label}>Emergency contact</span>
          {h.emergency?.name ? <>{h.emergency.name}{h.emergency.relationship ? ` (${h.emergency.relationship})` : ''} · <a href={`tel:${h.emergency.phone}`} style={{ color: 'var(--color-primary)' }}>{h.emergency.phone}</a></> : none}
        </p>
        {h.responsibleAdult && (
          <p style={row}><span style={label}>Adult there with the kids</span>{h.responsibleAdult}</p>
        )}
        {dropOff && (
          <>
            <div style={row}>
              <span style={label}>May pick up</span>
              {h.authorizedPickup.length === 0 ? none : h.authorizedPickup.map((p, i) => <div key={i}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</div>)}
            </div>
            <p style={row}><span style={label}>May NOT pick up</span>{h.notAuthorized || none}</p>
          </>
        )}
        <p style={row}>
          <span style={label}>Photos</span>
          {h.photoConsent ? 'OK to photograph' : <strong>🚫 No photos</strong>}
        </p>
      </div>
    </div>
  )
}
