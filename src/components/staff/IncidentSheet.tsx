import { useMemo, useState } from 'react'
import { btn, field } from '@components/staff/ui'
import { formatWhen, studioDate } from '@lib/studio-time'
import type { Household } from '@components/staff/HouseholdCard'
import type { StudioEvent } from '@lib/events'

const ENDPOINT = '/api/staff/incident.json'
const MIN_WHAT = 10

type How = 'phone' | 'in-person' | 'text' | 'not-yet'
const HOW_OPTIONS: { value: How; label: string }[] = [
  { value: 'phone', label: 'By phone' },
  { value: 'in-person', label: 'In person' },
  { value: 'text', label: 'By text' },
  { value: 'not-yet', label: 'Not yet' },
]

interface RosterPerson { key: string; waiverId: string; personId: string; name: string }

/** Same adult/child id scheme `HouseholdCard` builds — `adult`, `child:0`, … */
function rosterPeople(households: Household[]): RosterPerson[] {
  const out: RosterPerson[] = []
  for (const h of households) {
    out.push({ key: `${h.recordId}:adult`, waiverId: h.recordId, personId: 'adult', name: h.signer })
    h.children.forEach((c, i) => out.push({ key: `${h.recordId}:child:${i}`, waiverId: h.recordId, personId: `child:${i}`, name: c.name }))
  }
  return out
}

/** `datetime-local` value (studio-local wall time) from an ISO instant. The
 *  input has no timezone concept, so this is a best-effort local rendering —
 *  fine for "editable, defaults to now" on the device taking the report. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

interface SavedIncident { id: string }

/**
 * Full-height incident-report sheet (HOM-215) — reachable from every console
 * screen via `StaffHeader`'s 🚑 button. Pre-fills reporter + event; offers a
 * searchable roster picker when a roster is open, plus free-text "someone
 * else". Draft state lives here for the life of the sheet; dismissing with
 * any content asks first (no native `window.confirm` — house rule).
 */
export default function IncidentSheet({
  staff,
  event,
  day,
  households,
  onClose,
}: {
  staff: { name: string }
  event: StudioEvent | null
  /** The event day currently on screen (the roster's selected day) — used as
   *  the incident's `event.day`. Falls back to the event's first day, then
   *  today, when the caller doesn't have one (e.g. Today's screen). */
  day?: string
  households: Household[]
  onClose: () => void
}) {
  const [view, setView] = useState<'form' | 'success'>('form')
  const [saved, setSaved] = useState<SavedIncident | null>(null)
  const [emailed, setEmailed] = useState(true)

  const nowIso = useMemo(() => new Date().toISOString(), [])
  const [at, setAt] = useState(nowIso)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [someoneElse, setSomeoneElse] = useState('')
  const [what, setWhat] = useState('')
  const [firstAid, setFirstAid] = useState('')
  const [witnesses, setWitnesses] = useState('')
  const [how, setHow] = useState<How>('not-yet')
  const [notifiedAt, setNotifiedAt] = useState(nowIso)
  const [followUp, setFollowUp] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const people = useMemo(() => rosterPeople(households), [households])
  const lowerQuery = query.toLowerCase()
  const visiblePeople = query ? people.filter((p) => p.name.toLowerCase().includes(lowerQuery)) : people

  const eventPayload = event
    ? { kind: event.kind, id: event.id, title: event.title, day: day ?? event.days[0] ?? studioDate(nowIso) }
    : null

  const hasContent = what.trim() || firstAid.trim() || witnesses.trim() || followUp.trim() || someoneElse.trim() ||
    Object.values(selected).some(Boolean)

  function requestClose() {
    if (view === 'success' || !hasContent) { onClose(); return }
    setConfirmDiscard(true)
  }

  function toggle(key: string) {
    setSelected((s) => ({ ...s, [key]: !s[key] }))
  }

  function whoPayload(): { waiverId?: string; personId?: string; name: string }[] {
    const picked = people
      .filter((p) => selected[p.key])
      .map((p) => ({ waiverId: p.waiverId, personId: p.personId, name: p.name }))
    const extras = someoneElse
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }))
    return [...picked, ...extras]
  }

  async function save() {
    setError(null)
    const trimmed = what.trim()
    if (trimmed.length < MIN_WHAT) {
      setError(`Describe what happened (at least ${MIN_WHAT} characters).`)
      return
    }
    setBusy(true)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at,
          event: eventPayload,
          who: whoPayload(),
          what: trimmed,
          firstAid,
          witnesses,
          parentNotified: { how, at: how === 'not-yet' ? null : notifiedAt },
          followUp,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Something went wrong.')
        setBusy(false)
        return
      }
      setSaved({ id: json.data.incident.id })
      setEmailed(!!json.data.emailed)
      setView('success')
    } catch {
      setError('Couldn’t reach the studio server — check wifi and try again.')
    } finally {
      setBusy(false)
    }
  }

  const eventLabel = event ? event.title : 'Open Studio / no event'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Incident report"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 130,
        display: 'flex', justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.4)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto',
          padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>🚑 Incident report</h3>
          <button type="button" onClick={requestClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        {confirmDiscard && (
          <div style={{ marginTop: '0.8rem', padding: '0.7rem 0.85rem', borderRadius: '0.7rem', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.28)' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>Discard this incident report?</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button type="button" onClick={() => setConfirmDiscard(false)} style={btn()}>Keep editing</button>
              <button type="button" onClick={onClose} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Discard</button>
            </div>
          </div>
        )}

        {view === 'success' ? (
          <div style={{ marginTop: '1.2rem' }}>
            <p style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', lineHeight: 1.5 }}>
              {emailed
                ? 'Saved and emailed to Kaden & Catherine. Give the parent a written note before they leave.'
                : 'Saved. Give the parent a written note before they leave. (The email didn’t go through — check Gmail sent items.)'}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {saved && (
                <a
                  href={`/staff/incident-print?id=${encodeURIComponent(saved.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...btn(true), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >
                  🖨 Print note
                </a>
              )}
              <button type="button" onClick={onClose} style={btn()}>Done</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p style={{ margin: '0 0 0.2rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reporter</p>
              <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)', fontWeight: 600 }}>{staff.name}</p>
            </div>

            <div>
              <p style={{ margin: '0 0 0.2rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Event</p>
              <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)', fontWeight: 600 }}>{eventLabel}</p>
            </div>

            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>When</span>
              <input
                type="datetime-local"
                value={toLocalInput(at)}
                onChange={(e) => setAt(fromLocalInput(e.target.value))}
                style={{ ...field, width: '100%', boxSizing: 'border-box' }}
              />
            </label>

            <div>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Who</span>
              {people.length > 0 && (
                <>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find on the roster…"
                    style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                  />
                  <div style={{ maxHeight: '10rem', overflowY: 'auto', border: '1px solid rgba(var(--color-primary-rgb),0.2)', borderRadius: '0.6rem' }}>
                    {visiblePeople.length === 0 && (
                      <p style={{ margin: 0, padding: '0.5rem 0.7rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>No match.</p>
                    )}
                    {visiblePeople.map((p) => (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.7rem', borderBottom: '1px solid rgba(var(--color-primary-rgb),0.08)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!selected[p.key]} onChange={() => toggle(p.key)} style={{ width: '1.1rem', height: '1.1rem', accentColor: 'var(--color-primary)' }} />
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>{p.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <input
                value={someoneElse}
                onChange={(e) => setSomeoneElse(e.target.value)}
                placeholder="Someone else: name(s), comma-separated"
                style={{ ...field, width: '100%', boxSizing: 'border-box', marginTop: '0.5rem' }}
              />
            </div>

            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>What happened</span>
              <textarea
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                rows={3}
                style={{ ...field, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>First aid given</span>
              <textarea
                value={firstAid}
                onChange={(e) => setFirstAid(e.target.value)}
                rows={2}
                style={{ ...field, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Witnesses</span>
              <input value={witnesses} onChange={(e) => setWitnesses(e.target.value)} style={{ ...field, width: '100%', boxSizing: 'border-box' }} />
            </label>

            <div>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Parent notified?</span>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {HOW_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setHow(o.value)}
                    style={{ ...btn(how === o.value), padding: '0.4rem 0.7rem', fontSize: '0.78125rem' }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {how !== 'not-yet' && (
                <input
                  type="datetime-local"
                  value={toLocalInput(notifiedAt)}
                  onChange={(e) => setNotifiedAt(fromLocalInput(e.target.value))}
                  style={{ ...field, width: '100%', boxSizing: 'border-box', marginTop: '0.5rem' }}
                />
              )}
            </div>

            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', margin: '0 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Follow-up needed</span>
              <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} style={{ ...field, width: '100%', boxSizing: 'border-box' }} />
            </label>

            {error && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', margin: 0, fontWeight: 600 }}>{error}</p>}

            <button type="button" onClick={save} disabled={busy} style={{ ...btn(true), padding: '0.75rem', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save incident'}
            </button>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>Reported {formatWhen(nowIso)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
