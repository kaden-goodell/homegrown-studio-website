import { useEffect, useState } from 'react'
import { formatWhen } from '@lib/studio-time'
import type { StudioEvent } from '@lib/events'
import {
  effectiveCutoffHours,
  MAX_CAPACITY,
  MAX_CHOICE_LENGTH,
  MAX_CUTOFF_HOURS,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  type SeatOption,
} from '@lib/seat-options'

type EventPatch = { dropOff?: boolean; days?: string[] | null; options?: SeatOption[]; signupCutoffHours?: number | null; capacity?: number | null }

const ENDPOINT = '/api/staff/event-meta.json'

const btn = (primary = false): React.CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(var(--color-primary-rgb),0.3)',
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
  background: 'rgba(var(--color-primary-rgb),0.1)',
  border: '1px solid rgba(var(--color-primary-rgb),0.25)',
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

async function patchEvent(kind: string, id: string, patch: EventPatch): Promise<{ event?: StudioEvent; error?: string }> {
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

  async function save(patch: EventPatch) {
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
                style={{ padding: '0.4rem 0.6rem', borderRadius: '0.5rem', border: '1px solid rgba(var(--color-primary-rgb),0.3)', fontSize: '0.85rem' }}
              />
              <button type="button" onClick={addDay} disabled={busy || !newDay} style={{ ...btn(true), opacity: busy || !newDay ? 0.5 : 1 }}>Add</button>
              <button type="button" onClick={() => { setAddingDay(false); setNewDay('') }} style={btn()}>Cancel</button>
            </div>
          )}
        </div>

        {event.kind === 'workshop' && (
          <SeatQuestions saved={event.options ?? []} busy={busy} onSave={(options) => save({ options })} />
        )}
        {event.kind === 'workshop' && (
          <SignupCutoff event={event} busy={busy} onSave={(hours) => save({ signupCutoffHours: hours })} />
        )}
        {event.kind === 'workshop' && (
          <Capacity event={event} busy={busy} onSave={(capacity) => save({ capacity })} />
        )}

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

const sectionTitle: React.CSSProperties = { margin: '0 0 0.4rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }
const hint: React.CSSProperties = { margin: '0.25rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }
const textInput: React.CSSProperties = {
  minHeight: '2.75rem',
  padding: '0.4rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(var(--color-primary-rgb),0.3)',
  fontSize: '0.85rem',
}
const confirmBox: React.CSSProperties = {
  marginTop: '0.6rem',
  padding: '0.7rem 0.85rem',
  borderRadius: '0.7rem',
  background: 'rgba(217,119,6,0.08)',
  border: '1px solid rgba(217,119,6,0.28)',
}

const toDraft = (o: SeatOption): SeatOption => ({ id: o.id, label: o.label, choices: [...o.choices] })

/**
 * "Questions for each seat" (spec A): e.g. Pumpkin color → Light Pink /
 * Light Blue / Black / Lavender. Edits stay local until Save → confirm, like
 * Drop-off. The server owns the rules (limits; nothing removed once anyone
 * has picked) and its refusal shows in the sheet's error line.
 */
function SeatQuestions({ saved, busy, onSave }: { saved: SeatOption[]; busy: boolean; onSave: (options: SeatOption[]) => Promise<void> }) {
  const savedKey = JSON.stringify(saved)
  const [draft, setDraft] = useState<SeatOption[]>(() => saved.map(toDraft))
  const [newChoice, setNewChoice] = useState<Record<number, string>>({})
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setDraft(saved.map(toDraft))
    setConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  // Text typed into "New choice" but not yet added still counts as a choice.
  const withPending = draft.map((o, i) => {
    const p = (newChoice[i] ?? '').trim()
    return p ? { ...o, choices: [...o.choices, p] } : o
  })
  const dirty = JSON.stringify(withPending) !== savedKey
  const update = (i: number, next: Partial<SeatOption>) => setDraft((d) => d.map((o, j) => (j === i ? { ...o, ...next } : o)))

  function addChoice(i: number) {
    const c = (newChoice[i] ?? '').trim()
    if (!c) return
    update(i, { choices: [...draft[i].choices, c] })
    setNewChoice((n) => ({ ...n, [i]: '' }))
  }

  async function confirmSave() {
    setConfirming(false)
    setNewChoice({})
    await onSave(withPending.map((o) => ({ id: o.id, label: o.label.trim(), choices: o.choices })))
  }

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <p style={sectionTitle}>Questions for each seat</p>
      <p style={{ ...hint, margin: '0 0 0.4rem' }}>Each seat picks one answer when booking. Picks can’t change after.</p>
      {draft.map((o, i) => (
        <div key={i} style={{ marginTop: '0.6rem', padding: '0.6rem', borderRadius: '0.6rem', border: '1px solid rgba(var(--color-primary-rgb),0.2)' }}>
          <input
            aria-label={`Question ${i + 1}`}
            value={o.label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="Pumpkin color"
            disabled={busy}
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ ...textInput, width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {o.choices.map((c, k) => (
              <span key={k} style={chip}>
                {c}
                <button
                  type="button"
                  aria-label={`Remove ${c}`}
                  disabled={busy}
                  onClick={() => update(i, { choices: o.choices.filter((_, x) => x !== k) })}
                  style={{ border: 'none', background: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0, minWidth: '2.75rem', minHeight: '2.75rem' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              aria-label={`New choice for question ${i + 1}`}
              value={newChoice[i] ?? ''}
              maxLength={MAX_CHOICE_LENGTH}
              placeholder="Lavender"
              disabled={busy}
              onChange={(e) => setNewChoice((n) => ({ ...n, [i]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addChoice(i)
                }
              }}
              style={{ ...textInput, flex: 1 }}
            />
            <button type="button" onClick={() => addChoice(i)} disabled={busy} style={{ ...btn(), minHeight: '2.75rem' }}>Add choice</button>
          </div>
          <button
            type="button"
            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
            disabled={busy}
            style={{ ...btn(), marginTop: '0.5rem', padding: '0.3rem 0.65rem', fontSize: '0.78125rem', minHeight: '2.75rem' }}
          >
            Remove question
          </button>
        </div>
      ))}
      {draft.length < MAX_OPTIONS && (
        <button
          type="button"
          onClick={() => setDraft((d) => [...d, { id: '', label: '', choices: [] }])}
          disabled={busy}
          style={{ ...btn(), marginTop: '0.6rem', padding: '0.3rem 0.65rem', fontSize: '0.78125rem', minHeight: '2.75rem' }}
        >
          + Add a question
        </button>
      )}
      {dirty && !confirming && (
        <div style={{ marginTop: '0.6rem' }}>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={btn(true)}>Save questions</button>
        </div>
      )}
      {confirming && (
        <div style={confirmBox}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
            {draft.length === 0
              ? 'Remove the questions from this class?'
              : 'Save these questions? Everyone booking this class will pick one answer per seat.'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
            <button type="button" onClick={confirmSave} disabled={busy} style={btn(true)}>Yes, save</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * "Sign-ups close" (spec A): whole hours before the class. Blank means the
 * default (0 h, or 24 h once the class asks questions), shown greyed.
 */
function SignupCutoff({ event, busy, onSave }: { event: StudioEvent; busy: boolean; onSave: (hours: number | null) => Promise<void> }) {
  const saved = event.signupCutoffHours ?? null
  const fallback = effectiveCutoffHours({ options: event.options ?? [], signupCutoffHours: null })
  const [value, setValue] = useState(saved === null ? '' : String(saved))
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setValue(saved === null ? '' : String(saved))
    setConfirming(false)
  }, [saved])

  const parsed = value.trim() === '' ? null : Number(value)
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_CUTOFF_HOURS)
  const changed = parsed !== saved
  const inputId = `cutoff-${event.id}`

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <label htmlFor={inputId} style={{ ...sectionTitle, display: 'block' }}>Sign-ups close</label>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_CUTOFF_HOURS}
          step={1}
          value={value}
          placeholder={`${fallback} (default)`}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          style={{ ...textInput, width: '7.5rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--color-dark)' }}>hours before it starts</span>
      </div>
      <p style={hint}>
        {!valid
          ? `Whole hours, 0 to ${MAX_CUTOFF_HOURS}.`
          : saved === null
            ? `Using the default: ${fallback} hours.`
            : `Default would be ${fallback} hours. Clear the box to use it.`}
      </p>
      {valid && changed && !confirming && (
        <div style={{ marginTop: '0.5rem' }}>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={btn(true)}>Save</button>
        </div>
      )}
      {confirming && (
        <div style={confirmBox}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
            {parsed === null ? `Go back to the default (${fallback} hours)?` : `Close sign-ups ${parsed} hours before this class?`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
            <button
              type="button"
              onClick={async () => {
                setConfirming(false)
                await onSave(parsed)
              }}
              disabled={busy}
              style={btn(true)}
            >
              Yes, save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * "Capacity": seats the class holds. Square's buyer API doesn't say, so the
 * seats-sold count (warnings, roster) needs it from here. Blank = unknown.
 */
function Capacity({ event, busy, onSave }: { event: StudioEvent; busy: boolean; onSave: (seats: number | null) => Promise<void> }) {
  const saved = event.capacity ?? null
  const [value, setValue] = useState(saved === null ? '' : String(saved))
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setValue(saved === null ? '' : String(saved))
    setConfirming(false)
  }, [saved])

  const parsed = value.trim() === '' ? null : Number(value)
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CAPACITY)
  const changed = parsed !== saved
  const inputId = `capacity-${event.id}`

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <label htmlFor={inputId} style={{ ...sectionTitle, display: 'block' }}>Capacity</label>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_CAPACITY}
          step={1}
          value={value}
          placeholder="from Square"
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          style={{ ...textInput, width: '7.5rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--color-dark)' }}>seats</span>
      </div>
      {!valid && <p style={hint}>Whole seats, 1 to {MAX_CAPACITY}.</p>}
      {valid && changed && !confirming && (
        <div style={{ marginTop: '0.5rem' }}>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={btn(true)}>Save</button>
        </div>
      )}
      {confirming && (
        <div style={confirmBox}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
            {parsed === null ? 'Clear this class’s capacity?' : `Set this class to ${parsed} seats?`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
            <button
              type="button"
              onClick={async () => {
                setConfirming(false)
                await onSave(parsed)
              }}
              disabled={busy}
              style={btn(true)}
            >
              Yes, save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
