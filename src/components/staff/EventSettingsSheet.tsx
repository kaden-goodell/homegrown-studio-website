import { useEffect, useState } from 'react'
import { formatWhen } from '@lib/studio-time'
import type { StudioEvent } from '@lib/events'

const ENDPOINT = '/api/staff/event-meta.json'

const btn = (primary = false): React.CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(150,112,91,0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
})

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.3rem 0.6rem',
  borderRadius: '999px',
  background: 'rgba(150,112,91,0.1)',
  border: '1px solid rgba(150,112,91,0.25)',
  fontSize: '0.8125rem',
  color: 'var(--color-dark)',
}

/** "Sat, Oct 17" from a YYYY-MM-DD, local calendar arithmetic (no tz shift). */
function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

async function fetchEvent(kind: string, id: string): Promise<StudioEvent | null> {
  try {
    const res = await fetch(`${ENDPOINT}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()).data
  } catch {
    return null
  }
}

async function patchEvent(kind: string, id: string, patch: { dropOff?: boolean; days?: string[] | null }): Promise<{ event?: StudioEvent; error?: string }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, ...patch }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { error: json?.error ?? 'Something went wrong.' }
    return { event: json.data }
  } catch {
    return { error: 'Couldn’t save — check wifi and try again.' }
  }
}

/**
 * "Event settings" sheet — drop-off toggle + multi-day chips, shared by every
 * event kind (parties, workshops; programs land later). Self-contained: it
 * fetches its own fresh copy on open (so "Last changed by …" is accurate even
 * though the caller's `event` prop may be a partial roster snapshot) and
 * calls `onSaved` with the merged event after every successful write.
 */
export default function EventSettingsSheet({
  event: initialEvent,
  onSaved,
  onClose,
}: {
  event: StudioEvent
  onSaved: (event: StudioEvent) => void
  onClose: () => void
}) {
  const [event, setEvent] = useState(initialEvent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Drop-off asks for confirmation before it takes effect — no window.confirm.
  const [confirmDropOff, setConfirmDropOff] = useState<boolean | null>(null)
  const [addingDay, setAddingDay] = useState(false)
  const [newDay, setNewDay] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchEvent(initialEvent.kind, initialEvent.id).then((fresh) => {
      if (!cancelled && fresh) setEvent(fresh)
    })
    return () => { cancelled = true }
    // Only re-fetch if the sheet is opened for a different event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEvent.kind, initialEvent.id])

  async function save(patch: { dropOff?: boolean; days?: string[] | null }) {
    setBusy(true)
    setError(null)
    const r = await patchEvent(event.kind, event.id, patch)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    if (r.event) {
      setEvent(r.event)
      onSaved(r.event)
    }
  }

  function requestDropOffToggle(next: boolean) {
    setConfirmDropOff(next)
  }

  async function confirmDropOffChange() {
    const next = confirmDropOff
    setConfirmDropOff(null)
    if (next === null) return
    await save({ dropOff: next })
  }

  async function addDay() {
    if (!newDay) return
    const days = [...new Set([...event.days, newDay])].sort()
    setAddingDay(false)
    setNewDay('')
    await save({ days })
  }

  async function removeDay(day: string) {
    const remaining = event.days.filter((d) => d !== day)
    await save({ days: remaining.length > 0 ? remaining : null })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Event settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(2px)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '26rem',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.5rem',
          borderRadius: '1rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.94) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>Event settings</h3>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{event.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        {/* Drop-off */}
        <div style={{ marginTop: '1.1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)', cursor: busy ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={event.dropOff}
              disabled={busy}
              onChange={(e) => requestDropOffToggle(e.target.checked)}
            />
            Drop-off event
          </label>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }}>
            Studio-run only (camps/PNO) — parties are never drop-off.
          </p>

          {confirmDropOff !== null && (
            <div style={{ marginTop: '0.6rem', padding: '0.7rem 0.85rem', borderRadius: '0.7rem', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.28)' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
                {confirmDropOff
                  ? 'Switch this to a drop-off event? Pickup codes will be required for every child.'
                  : 'Turn off drop-off for this event? Pickup codes will no longer be required.'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <button type="button" onClick={() => setConfirmDropOff(null)} style={btn()}>Cancel</button>
                <button type="button" onClick={confirmDropOffChange} disabled={busy} style={btn(true)}>
                  {confirmDropOff ? 'Yes, drop-off' : 'Yes, turn off'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Days */}
        <div style={{ marginTop: '1.1rem' }}>
          <p style={{ margin: '0 0 0.4rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }}>Days</p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {event.days.map((d) => (
              <span key={d} style={chip}>
                {fmtDay(d)}
                <button
                  type="button"
                  onClick={() => removeDay(d)}
                  disabled={busy}
                  aria-label={`Remove ${fmtDay(d)}`}
                  style={{ border: 'none', background: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
            {!addingDay && (
              <button type="button" onClick={() => setAddingDay(true)} disabled={busy} style={{ ...btn(), padding: '0.3rem 0.65rem', fontSize: '0.78125rem' }}>
                + Add day
              </button>
            )}
          </div>
          {addingDay && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <input
                type="date"
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', borderRadius: '0.5rem', border: '1px solid rgba(150,112,91,0.3)', fontSize: '0.85rem' }}
              />
              <button type="button" onClick={addDay} disabled={busy || !newDay} style={{ ...btn(true), opacity: busy || !newDay ? 0.5 : 1 }}>Add</button>
              <button type="button" onClick={() => { setAddingDay(false); setNewDay('') }} style={btn()}>Cancel</button>
            </div>
          )}
        </div>

        {error && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '0.8rem', fontWeight: 600 }}>{error}</p>}

        {event.by && event.updatedAt && (
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            Last changed by {event.by.name}, {formatWhen(event.updatedAt)}
          </p>
        )}
      </div>
    </div>
  )
}
