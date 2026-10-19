import { useEffect, useState } from 'react'
import type { ScheduledClass } from '@lib/classes/types'
import { formatDayAndSpan } from '@lib/studio-time'
import { api, CLASSES, SEED } from './api'
import { addDays, dayStartIso, today } from './dates'
import { box, errorText, muted, row } from './ui'

const STATUS_WORD: Record<string, string> = { draft: 'Draft', closed: 'Sign-ups closed', cancelled: 'Cancelled', open: 'Open' }
interface Seeded { classesCategoryId: string; classTaxId: string; commands: string[] }

/**
 * Our classes from today on, soonest first: name, next date, seats taken.
 * New class starts a blank one. "Set up sandbox" is for the test branch only;
 * on the live site the server refuses it and the button goes away.
 */
export default function ClassList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [classes, setClasses] = useState<ScheduledClass[] | null>(null)
  const [taken, setTaken] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [showSeed, setShowSeed] = useState(true)
  const [seed, setSeed] = useState<Seeded | null>(null)
  const [seedError, setSeedError] = useState('')
  const [seeding, setSeeding] = useState(false)

  async function load() {
    const q = new URLSearchParams({ from: dayStartIso(today()), to: dayStartIso(addDays(today(), 366)) })
    const r = await api<{ classes: ScheduledClass[]; seatsTaken: Record<string, number> }>(`${CLASSES}?${q}`)
    if (r.ok && r.data) { setClasses(r.data.classes); setTaken(r.data.seatsTaken); setError('') } else setError(r.error ?? '')
  }
  useEffect(() => { load() }, [])

  async function setUpSandbox() {
    setSeeding(true)
    setSeedError('')
    const r = await api<Seeded>(SEED, {})
    setSeeding(false)
    if (r.ok && r.data) return setSeed(r.data)
    setSeedError(r.error ?? '')
    if (r.status === 409) setShowSeed(false)
  }

  const now = Date.now()
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>Classes</h1>
        <button type="button" className="btn btn-primary" onClick={onNew}>New class</button>
      </div>
      {error && <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></p>}
      {!error && !classes && <p style={muted}>Loading…</p>}
      {classes && classes.length === 0 && <p style={muted}>No classes coming up. Press New class, or schedule one from the library.</p>}
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
      {(showSeed || seed || seedError) && (
        <section aria-label="Sandbox" style={{ ...box, borderStyle: 'dashed' }}>
          <p style={{ ...muted, fontSize: '0.9rem' }}>For the test site only. Makes the Classes category and the 9% sales tax in the Square sandbox.</p>
          {showSeed && !seed && <button type="button" className="btn btn-secondary" disabled={seeding} onClick={setUpSandbox}>Set up sandbox</button>}
          {seedError && <p role="alert" style={errorText}>{seedError}</p>}
          {seed && (
            <>
              <p style={{ margin: 0 }}>{`Category ${seed.classesCategoryId} · Tax ${seed.classTaxId}`}</p>
              <p style={{ margin: 0 }}>Run these, then redeploy the branch.</p>
              {seed.commands.map((cmd) => <code key={cmd} style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all', fontSize: '0.85rem' }}>{cmd}</code>)}
            </>
          )}
        </section>
      )}
    </div>
  )
}
