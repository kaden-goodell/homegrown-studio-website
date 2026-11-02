/**
 * Stage 4: the class's waitlist on its sheet (Bookings tab). Who is waiting,
 * in order, with their seats and card; what happened to everyone else (added
 * and charged, card didn't go through, left, taken off, waitlist closed).
 * Remove asks in the sheet first: the card comes off file and they get an
 * email; nothing is charged. "Run the waitlist now" adds and charges the next
 * person who fits when a seat is free (the same run a freed seat starts).
 */
import { useEffect, useState } from 'react'
import type { WaitlistRow } from '@lib/classes/waitlist'
import { formatMoney } from '@lib/money'
import { api, WAITLIST } from './api'
import { dayAndClock } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { telHref } from '../inbox/describe'

export interface RunAnswer { added: number; declined: number; unknown: number; skipped: number; stopped: string | null; note: string }

export default function WaitlistSection({ classId, onChanged }: { classId: string; onChanged?: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<WaitlistRow[] | null>(null)
  const [canRun, setCanRun] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const [ran, setRan] = useState<string>('')

  async function load() {
    const r = await api<{ rows: WaitlistRow[]; canRun: boolean }>(`${WAITLIST}?id=${encodeURIComponent(classId)}`)
    if (r.ok && r.data) { setRows(r.data.rows); setCanRun(!!r.data.canRun); setError('') } else setError(r.error ?? DIDNT_SAVE)
  }
  useEffect(() => { void load() }, [classId])

  async function remove(row: WaitlistRow) {
    setBusy(row.id)
    const r = await api<{ rows: WaitlistRow[]; canRun: boolean }>(WAITLIST, { action: 'remove', classId, entryId: row.id })
    setBusy(null)
    setAsking(null)
    if (r.ok && r.data) {
      setRows(r.data.rows)
      setCanRun(!!r.data.canRun)
      toast(`${row.name} is off the waitlist. Their card came off and they got an email.`)
      onChanged?.()
    } else {
      setError(r.error ?? DIDNT_SAVE)
      void load()
    }
  }

  async function run() {
    setBusy('run')
    setRan('')
    const r = await api<{ rows: WaitlistRow[]; canRun: boolean; run: RunAnswer }>(WAITLIST, { action: 'run', classId })
    setBusy(null)
    if (r.ok && r.data) {
      setRows(r.data.rows)
      setCanRun(!!r.data.canRun)
      setRan(r.data.run.note)
      onChanged?.()
    } else {
      setError(r.error ?? DIDNT_SAVE)
    }
  }

  if (!rows && !error) return null
  if (rows && rows.length === 0) return null
  const waiting = (rows ?? []).filter((r) => r.position !== null)
  const past = (rows ?? []).filter((r) => r.position === null)
  return (
    <section aria-label="Waitlist" className="adm-gap-top" data-testid="waitlist-section">
      <p className="adm-lbl">{waiting.length ? `Waitlist · ${waiting.length} waiting` : 'Waitlist'}</p>
      {error && (
        <p className="adm-error" role="alert">
          {error} <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setError(''); void load() }}>Try again</button>
        </p>
      )}
      {waiting.length > 0 && canRun && (
        <div className="adm-panel" role="group" aria-label="Run the waitlist">
          <b>{waiting.some((r) => r.state === 'charging') ? 'Someone is being added, or Square hasn’t answered yet.' : 'A seat is free and people are waiting.'}</b>
          <span className="adm-small">Running it asks Square about anything unclear first, then adds the next person whose group fits and charges their saved card, up to what they agreed to. Nobody is charged twice.</span>
          <button type="button" className="adm-btn is-pri" disabled={busy === 'run'} onClick={run}>{busy === 'run' ? 'Running…' : 'Run the waitlist now'}</button>
        </div>
      )}
      {ran && <p className="adm-small" role="status">{ran}</p>}
      <ol className="adm-plain" aria-label="Waiting, in order">
        {waiting.map((r) => (
          <li key={r.id} className="adm-bkc">
            <div className="adm-bk">
              <div className="adm-rm">
                <b>{`${r.position}. ${r.name}`}</b>
                <small>{[r.seatsLabel, `up to ${formatMoney(r.maxCents)}`, r.card, `joined ${dayAndClock(r.joinedAt)}`].join(' · ')}</small>
              </div>
              <span className={`adm-tag ${r.state === 'charging' ? '' : 'is-grey'}`}>{r.state === 'charging' ? 'Adding' : 'Waiting'}</span>
            </div>
            {r.stateWords !== 'Waiting' && <p className="adm-small">{r.stateWords}</p>}
            <p className="adm-small adm-links">
              {r.phone && <a href={telHref(r.phone)}>{r.phone}</a>}
              {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
            </p>
            {asking === r.id ? (
              <div className="adm-panel is-warn" role="group" aria-label={`Take ${r.name} off the waitlist?`}>
                <b>{`Take ${r.name} off the waitlist?`}</b>
                <span className="adm-small">Their saved card comes off and they get an email saying so. Nothing is charged.</span>
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => setAsking(null)}>Keep them</button>
                  <button type="button" className="adm-btn is-danger" disabled={busy === r.id} onClick={() => remove(r)}>{busy === r.id ? 'Taking off…' : 'Take them off'}</button>
                </div>
              </div>
            ) : r.state === 'waiting' && (
              <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAsking(r.id)}>Remove</button>
            )}
            <History row={r} open={opened === r.id} onToggle={() => setOpened(opened === r.id ? null : r.id)} />
          </li>
        ))}
      </ol>
      {past.length > 0 && (
        <>
          <p className="adm-lbl adm-gap-top">Off the waitlist</p>
          <ul className="adm-plain" aria-label="Off the waitlist">
            {past.map((r) => (
              <li key={r.id} className="adm-bkc is-gone">
                <div className="adm-bk">
                  <div className="adm-rm">
                    <b>{r.name}</b>
                    <small>{[r.seatsLabel, r.stateWords].join(' · ')}</small>
                  </div>
                </div>
                <History row={r} open={opened === r.id} onToggle={() => setOpened(opened === r.id ? null : r.id)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function History({ row, open, onToggle }: { row: WaitlistRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" className="adm-btn is-ghost is-sm" aria-expanded={open} onClick={onToggle}>{open ? 'Hide what happened' : 'What happened'}</button>
      {open && (
        <ul className="adm-plain adm-small" aria-label={`What happened with ${row.name}`}>
          {row.history.map((h, i) => <li key={i}>{`${dayAndClock(h.at)} · ${h.change}${h.by ? ` (${h.by})` : ''}`}</li>)}
        </ul>
      )}
    </>
  )
}
