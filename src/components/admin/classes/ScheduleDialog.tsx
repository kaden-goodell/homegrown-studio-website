import { useState } from 'react'
import type { ClassStatus, ScheduledClass, Session } from '@lib/classes/types'
import { api, CLASSES } from './api'
import { addDays, partsOf, today, toIsoAt } from './dates'
import { box, errorText, input, row } from './ui'

/** `minutes`: the row's own length, kept while its day or start moves (a copied session keeps its length). */
interface DateRow { day: string; start: string; end: string; capacity: string; minutes: number }

const endAfter = (day: string, start: string, minutes: number) =>
  partsOf(new Date(Date.parse(toIsoAt(day, start)) + minutes * 60_000).toISOString()).time

/**
 * Put a library class (or a copy of a class) on the calendar: pick one or
 * more dates, the end time follows the usual length until it is changed.
 * A clash comes back as the server's sentence and the form stays as typed.
 */
export default function ScheduleDialog({ name, libraryId, duplicateId, copyOf, defaultMinutes, defaultCapacity, onDone, onCancel }: {
  name: string
  /** A copy starts with the source's sessions a week later. */
  copyOf?: Session[]
  libraryId?: string
  duplicateId?: string
  defaultMinutes: number
  defaultCapacity: number
  onDone: (cls: ScheduledClass, warning?: string) => void
  onCancel: () => void
}) {
  const first = addDays(today(), 7)
  const [rows, setRows] = useState<DateRow[]>(() => (copyOf?.length
    ? copyOf.map((s) => ({
      day: addDays(partsOf(s.startIso).day, 7), start: partsOf(s.startIso).time, end: partsOf(s.endIso).time,
      capacity: String(s.capacity), minutes: Math.round((Date.parse(s.endIso) - Date.parse(s.startIso)) / 60_000),
    }))
    : [{ day: first, start: '10:00', end: endAfter(first, '10:00', defaultMinutes), capacity: String(defaultCapacity), minutes: defaultMinutes }]))
  const [status, setStatus] = useState<ClassStatus>('open')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function setRow(i: number, patch: Partial<DateRow>) {
    setRows((cur) => cur.map((r, n) => {
      if (n !== i) return r
      const next = { ...r, ...patch }
      // The end keeps the row's length while the start or day moves.
      if ((patch.start || patch.day) && next.day && next.start) next.end = endAfter(next.day, next.start, next.minutes)
      return next
    }))
  }

  async function submit() {
    setError('')
    const sessions = []
    for (const r of rows) {
      if (!r.day || !r.start || !r.end) return setError('Each date needs a day, a start and an end.')
      if (r.end <= r.start) return setError('A session has to end after it starts.')
      const cap = /^\d+$/.test(r.capacity) ? Number(r.capacity) : 0
      if (cap < 1 || cap > 999) return setError('Seats is 1 to 999.')
      sessions.push({ startIso: toIsoAt(r.day, r.start), endIso: toIsoAt(r.day, r.end), capacity: cap })
    }
    setSaving(true)
    const r = await api<{ class: ScheduledClass }>(CLASSES, duplicateId
      ? { action: 'duplicate', id: duplicateId, sessions, status }
      : { action: 'create', libraryId, sessions, status })
    setSaving(false)
    if (r.ok && r.data) onDone(r.data.class, r.warning)
    else setError(r.error ?? '')
  }

  return (
    <div role="dialog" aria-label={`Schedule ${name}`} style={{ ...box, border: '2px solid var(--color-primary)' }}>
      <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>{duplicateId ? `Run ${name} again` : `Schedule ${name}`}</h2>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', alignItems: 'end' }}>
          <label className="field"><span className="field-label">{`Date ${i + 1} day`}</span><input className="field-input" style={input} type="date" value={r.day} onChange={(e) => setRow(i, { day: e.target.value })} /></label>
          <label className="field"><span className="field-label">{`Date ${i + 1} start`}</span><input className="field-input" style={input} type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} /></label>
          <label className="field"><span className="field-label">{`Date ${i + 1} end`}</span><input className="field-input" style={input} type="time" value={r.end} onChange={(e) => setRows((cur) => cur.map((x, n) => {
            if (n !== i) return x
            const end = e.target.value
            // A typed end sets the row's length from here on.
            const minutes = x.day && x.start && end > x.start ? Math.round((Date.parse(toIsoAt(x.day, end)) - Date.parse(toIsoAt(x.day, x.start))) / 60_000) : x.minutes
            return { ...x, end, minutes }
          }))} /></label>
          <label className="field"><span className="field-label">{`Date ${i + 1} seats`}</span><input className="field-input" style={input} inputMode="numeric" value={r.capacity} onChange={(e) => setRows((cur) => cur.map((x, n) => (n === i ? { ...x, capacity: e.target.value } : x)))} /></label>
          {rows.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => setRows((cur) => cur.filter((_, n) => n !== i))}>Remove date {i + 1}</button>}
        </div>
      ))}
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>More than one date makes one class that meets on each of them.</p>
      <div style={row}>
        <button type="button" className="btn btn-secondary" onClick={() => setRows((cur) => {
          const last = cur[cur.length - 1]
          const day = addDays(last.day || first, 7)
          return [...cur, { ...last, day }]
        })}>Add another date</button>
      </div>
      <label className="field">
        <span className="field-label">Status</span>
        <select className="field-input" style={input} value={status} onChange={(e) => setStatus(e.target.value as ClassStatus)}>
          <option value="open">Open for booking</option>
          <option value="draft">Draft (only you see it)</option>
        </select>
      </label>
      {error && <p role="alert" style={errorText}>{error}</p>}
      <div style={row}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>Add to the calendar</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Never mind</button>
      </div>
    </div>
  )
}
