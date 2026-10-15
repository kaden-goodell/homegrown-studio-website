import { useEffect, useState } from 'react'
import { btn } from '@components/staff/ui'
import type { StaffMember } from '@lib/staff-auth'

/**
 * Flyout for "Switch person": tap a teammate's name and the iPad is theirs.
 * No passcode screen (Kaden, 15 Oct 2026). If this device has been signed
 * out meanwhile, `onSignedOut` sends it to the passcode screen.
 */
export default function SwitchPersonSheet({
  current,
  onClose,
  onSwitched,
  onSignedOut,
}: {
  current: StaffMember
  onClose: () => void
  onSwitched: (staff: StaffMember) => void
  onSignedOut: () => void
}) {
  const [team, setTeam] = useState<StaffMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/staff/switch.json', { cache: 'no-store' })
        if (res.status === 401) return onSignedOut()
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error)
        setTeam(json.data.staff)
      } catch {
        setError('Couldn’t load the team — check wifi and try again.')
      }
    })()
  }, [])

  async function pick(m: StaffMember) {
    if (m.id === current.id) return onClose()
    setBusy(m.id)
    setError(null)
    try {
      const res = await fetch('/api/staff/switch.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: m.id }) })
      if (res.status === 401) return onSignedOut()
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t switch — try again.'); return }
      onSwitched(json.data.staff)
    } catch {
      setError('Couldn’t switch — check wifi and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Switch person" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', width: '100%', maxWidth: '32rem', borderRadius: '1rem 1rem 0 0', padding: '1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px))', display: 'grid', gap: '0.6rem' }}>
        <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-dark)' }}>Who’s using the iPad?</p>
        {!team && !error && <p style={{ margin: 0, color: 'var(--color-muted)' }}>Loading…</p>}
        {team?.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy !== null}
            onClick={() => pick(m)}
            aria-current={m.id === current.id ? 'true' : undefined}
            style={{ ...btn(m.id === current.id), minHeight: '3rem', fontSize: '1rem', textAlign: 'left' }}
          >
            {m.name}{m.id === current.id ? ' · you' : ''}{busy === m.id ? ' …' : ''}
          </button>
        ))}
        {error && <p role="alert" style={{ margin: 0, color: 'var(--color-error)' }}>{error}</p>}
        <button type="button" onClick={onClose} style={{ ...btn(), minHeight: '2.75rem', border: 'none' }}>Cancel</button>
      </div>
    </div>
  )
}
