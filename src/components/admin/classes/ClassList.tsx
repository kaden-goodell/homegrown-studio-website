import { useEffect, useState } from 'react'
import type { ScheduledClass } from '@lib/classes/types'
import { dayAndSpan as formatDayAndSpan } from '../shell/time'
import { api, CLASSES } from './api'
import { addDays, dayStartIso, today } from './dates'
import { box, errorText, muted, row } from './ui'

const STATUS_WORD: Record<string, string> = { draft: 'Draft', closed: 'Sign-ups closed', cancelled: 'Cancelled', open: 'Open' }
/**
 * Our classes from today on, soonest first: name, next date, seats taken.
 * New class starts a blank one. (Set up sandbox moved to More, shown only
 * on the sandbox.)
 */
export default function ClassList({ onOpen, onNew, hideHeader, emptyText }: { onOpen: (id: string) => void; onNew: () => void; hideHeader?: boolean; emptyText?: string }) {
  const [classes, setClasses] = useState<ScheduledClass[] | null>(null)
  const [taken, setTaken] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  async function load() {
    const q = new URLSearchParams({ from: dayStartIso(today()), to: dayStartIso(addDays(today(), 366)) })
    const r = await api<{ classes: ScheduledClass[]; seatsTaken: Record<string, number> }>(`${CLASSES}?${q}`)
    if (r.ok && r.data) { setClasses(r.data.classes); setTaken(r.data.seatsTaken); setError('') } else setError(r.error ?? '')
  }
  useEffect(() => { load() }, [])

  const now = Date.now()
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {!hideHeader && (
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>Classes</h1>
          <button type="button" className="btn btn-primary" onClick={onNew}>New class</button>
        </div>
      )}
      {error && <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></p>}
      {!error && !classes && <p style={muted}>Loading…</p>}
      {classes && classes.length === 0 && (
        <div style={{ ...box, borderStyle: 'dashed' }}>
          <p style={muted}>{emptyText ?? 'No classes coming up.'}</p>
          <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={onNew}>+ New class</button>
        </div>
      )}
      {classes?.map((c) => {
        const next = c.sessions.find((s) => Date.parse(s.endIso) > now) ?? c.sessions[c.sessions.length - 1]
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--color-dark)', opacity: c.status === 'cancelled' ? 0.6 : 1 }}
          >
            <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{c.content.name}</span>
            {next && <span>{formatDayAndSpan(next.startIso, next.endIso)}{c.sessions.length > 1 ? ` · ${c.sessions.length} sessions` : ''}</span>}
            <span style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>
              {[STATUS_WORD[c.status], next ? `${taken[next.id] ?? 0} of ${next.capacity} seats` : ''].filter(Boolean).join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
