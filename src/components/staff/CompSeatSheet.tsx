import { useState } from 'react'
import type { SeatOption } from '@lib/seat-options'
import { btn, field } from '@components/staff/ui'

/**
 * Roster "Comp a seat": staff add the person to the class in Square (step 1),
 * then record the same seat here (step 2) so picks, roster and the usual
 * confirmation email follow. Sheet chrome copied from AddFamilySheet.
 */
export default function CompSeatSheet({
  event,
  options,
  onRecorded,
  onClose,
}: {
  event: { id: string; title: string; day: string }
  options: SeatOption[]
  onRecorded: () => void
  onClose: () => void
}) {
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // The field keeps what's typed (so it can be cleared and retyped); the count
  // used everywhere else is clamped to 1–10.
  const [seatsText, setSeatsText] = useState('1')
  const seats = Math.min(10, Math.max(1, Math.floor(Number(seatsText)) || 1))
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const key = (seat: number, optionId: string) => `${seat}:${optionId}`
  const squareUrl = `https://app.squareup.com/dashboard/appointments/calendar/classes/${event.id}?date=${event.day}&view=week`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const picks = Array.from({ length: seats }, (_, i) => i + 1).flatMap((seat) =>
      options.map((o) => ({ seat, optionId: o.id, choice: selections[key(seat, o.id)] ?? '' })),
    )
    try {
      const res = await fetch('/api/staff/comp-seat.json', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: event.id,
          givenName: givenName.trim(),
          familyName: familyName.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          seats,
          picks,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setDone(true)
        onRecorded()
      } else {
        setError(typeof body?.error === 'string' && body.error ? body.error : 'Could not record that seat.')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = { display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.2rem' } as const
  const input = { ...field, width: '100%', boxSizing: 'border-box' } as const
  const row = { marginBottom: '0.65rem' } as const

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comp a seat"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div
        style={{
          width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto',
          padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>Comp a seat</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        <h4 style={{ margin: '0 0 0.4rem', color: 'var(--color-dark)' }}>1 — In Square</h4>
        <a href={squareUrl} target="_blank" rel="noopener" style={{ ...btn(true), textDecoration: 'none', display: 'inline-block' }}>
          Open this class in Square
        </a>
        <ol style={{ margin: '0.5rem 0 1.1rem', paddingLeft: '1.1rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          <li>Add attendee</li>
          <li>Pick or create the person</li>
          <li>Add to class, then Skip payment</li>
        </ol>

        <h4 style={{ margin: '0 0 0.5rem', color: 'var(--color-dark)' }}>2 — Record it here</h4>
        {done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p role="status" style={{ margin: 0, fontWeight: 700, color: 'rgb(21,128,61)' }}>Recorded. They’ll get the usual confirmation email.</p>
            <button type="button" onClick={onClose} style={{ ...btn(true), marginTop: '1.2rem', padding: '0.7rem 2rem', minHeight: '2.75rem' }}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={row}>
              <label htmlFor="comp-given" style={label}>First name</label>
              <input id="comp-given" required value={givenName} onChange={(e) => setGivenName(e.target.value)} style={input} autoComplete="off" />
            </div>
            <div style={row}>
              <label htmlFor="comp-family" style={label}>Last name</label>
              <input id="comp-family" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} style={input} autoComplete="off" />
            </div>
            <div style={row}>
              <label htmlFor="comp-email" style={label}>Email</label>
              <input id="comp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoComplete="off" />
            </div>
            <div style={row}>
              <label htmlFor="comp-phone" style={label}>Phone (optional)</label>
              <input id="comp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={input} autoComplete="off" />
            </div>
            <div style={row}>
              <label htmlFor="comp-seats" style={label}>Seats</label>
              <input
                id="comp-seats" type="number" min={1} max={10} value={seatsText}
                onChange={(e) => setSeatsText(e.target.value)}
                onBlur={() => setSeatsText(String(seats))}
                style={{ ...input, width: '6rem' }}
              />
            </div>

            {options.length > 0 && Array.from({ length: seats }, (_, i) => i + 1).map((seat) =>
              options.map((o) => {
                const k = key(seat, o.id)
                const id = `comp-pick-${seat}-${o.id}`
                return (
                  <div key={k} style={row}>
                    <label htmlFor={id} style={label}>Seat {seat} · {o.label}</label>
                    <select
                      id={id}
                      value={selections[k] ?? ''}
                      onChange={(e) => { const v = e.target.value; setSelections((s) => ({ ...s, [k]: v })) }}
                      style={input}
                    >
                      <option value="" disabled>Choose…</option>
                      {o.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )
              }),
            )}

            {error && <p role="alert" style={{ margin: '0 0 0.6rem', color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600 }}>{error}</p>}
            <button type="submit" disabled={busy} style={{ ...btn(true), padding: '0.7rem 1.4rem', minHeight: '2.75rem', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Recording…' : 'Record comped seat'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
