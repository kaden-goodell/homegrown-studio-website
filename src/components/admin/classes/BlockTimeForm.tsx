import { useEffect, useState, type FormEvent } from 'react'
import type { BlockedTime } from '@lib/classes/blocked-time'
import type { Busy } from '@lib/classes/studio-schedule'
import { formatTimeSpan } from '@lib/studio-time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED } from './api'
import { addDays, dayLabel, dayStartIso, today, toIsoAt } from './dates'
import { box, errorText, input, muted, row } from './ui'

/**
 * Block time: hold the room so nothing can be booked (a deep clean, a private
 * hire). Over a class or party the server says what it clashes with and the
 * owner can block anyway; nothing booked changes either way. Below, the
 * blocks coming up, each removable after a second tap.
 */
export default function BlockTimeForm() {
  const [day, setDay] = useState(today())
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('12:00')
  const [allDay, setAllDay] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [clash, setClash] = useState(false)
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<BlockedTime[] | null>(null)
  const [listError, setListError] = useState('')

  async function load() {
    const q = new URLSearchParams({ from: dayStartIso(today()), to: dayStartIso(addDays(today(), 366)) })
    const r = await api<{ blocked: BlockedTime[] }>(`${BLOCKED}?${q}`)
    if (r.ok && r.data) { setList(r.data.blocked); setListError('') } else setListError(r.error ?? '')
  }
  useEffect(() => { load() }, [])

  const span = () => (allDay
    ? { startIso: toIsoAt(day, '00:00'), endIso: toIsoAt(addDays(day, 1), '00:00') }
    : { startIso: toIsoAt(day, from), endIso: toIsoAt(day, to) })

  async function send(confirm: boolean) {
    setError('')
    setDone('')
    if (!day || (!allDay && (!from || !to))) return setError('Blocked time needs a start and an end time.')
    const s = span()
    if (Date.parse(s.endIso) <= Date.parse(s.startIso)) return setError('Blocked time has to end after it starts.')
    setBusy(true)
    const r = await api<{ blocked: BlockedTime; clashes: Busy[] }>(BLOCKED, { action: 'add', ...s, reason: reason.trim(), ...(confirm ? { confirm: true } : {}) })
    setBusy(false)
    if (r.ok && r.data) {
      setClash(false)
      const over = r.data.clashes.map((c) => c.label)
      setDone(over.length ? `Blocked. It sits on ${over.join(', ')}. Nothing booked was changed.` : 'Blocked.')
      setReason('')
      load()
      return
    }
    setError(r.error ?? '')
    setClash(r.status === 409 && Array.isArray(r.extra.clashes))
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>Block time</h1>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); send(false) }} style={box}>
        <label className="field">
          <span className="field-label">Day</span>
          <input className="field-input" style={input} type="date" value={day} onChange={(e) => { setDay(e.target.value); setClash(false) }} />
        </label>
        <label style={{ ...row, minHeight: '2.75rem' }}>
          <input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setClash(false) }} style={{ width: 22, height: 22 }} />
          All day
        </label>
        {!allDay && (
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}>
            <label className="field">
              <span className="field-label">From</span>
              <input className="field-input" style={input} type="time" value={from} onChange={(e) => { setFrom(e.target.value); setClash(false) }} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input className="field-input" style={input} type="time" value={to} onChange={(e) => { setTo(e.target.value); setClash(false) }} />
            </label>
          </div>
        )}
        <label className="field">
          <span className="field-label">Reason <span className="field-optional">(optional, only you see it)</span></span>
          <input className="field-input" style={input} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" style={errorText}>{error}</p>}
        {done && <p role="status" style={{ margin: 0, fontWeight: 600 }}>{done}</p>}
        <div style={row}>
          {clash
            ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send(true)}>Block anyway</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setClash(false); setError('') }}>Pick another time</button>
              </>
            )
            : <button type="submit" className="btn btn-primary" disabled={busy}>Block this time</button>}
        </div>
      </form>
      <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>Coming up</h2>
      {listError && <p role="alert" style={errorText}>{listError}</p>}
      {list && list.length === 0 && <p style={muted}>No blocked time coming up.</p>}
      {list && list.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {list.map((b) => <BlockRow key={b.id} b={b} onRemoved={load} />)}
        </ul>
      )}
    </div>
  )
}

function BlockRow({ b, onRemoved }: { b: BlockedTime; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const label = `${dayLabel(localDate(b.startIso))} · ${formatTimeSpan(b.startIso, b.endIso)}${b.reason ? ` · ${b.reason}` : ''}`
  async function remove() {
    const r = await api(BLOCKED, { action: 'remove', id: b.id })
    if (r.ok) onRemoved()
    else setError(r.error ?? '')
  }
  return (
    <li aria-label={label} style={{ ...box, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
      <span>{label}</span>
      <span style={row}>
        {!asking && <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>Remove</button>}
        {asking && (
          <>
            <button type="button" className="btn btn-primary" onClick={remove}>Yes, remove it</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Keep it</button>
          </>
        )}
      </span>
      {error && <p role="alert" style={{ ...errorText, gridColumn: '1 / -1' }}>{error}</p>}
    </li>
  )
}
