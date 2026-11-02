import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { BlockedTime } from '@lib/classes/blocked-time'
import type { Busy } from '@lib/classes/studio-schedule'
import { timeSpan as formatTimeSpan } from '../shell/time'
import { Seg } from '../shell/items'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED } from './api'
import { addDays, dayLabel, dayStartIso, nextOpenDay, today, toIsoAt } from './dates'
import { useStudio } from '../shell/studio'

/** Why the room is held (the mock-up's Closed · Private · Setup); what customers' clash lines and the calendar call it. */
export const BLOCK_WHY = [['Closed', 'Closed'], ['Private event', 'Private'], ['Setup', 'Setup']] as const
export type BlockWhy = (typeof BLOCK_WHY)[number][0]

/**
 * Block time: hold the room so nothing can be booked (a deep clean, a private
 * hire). Why (Closed · Private · Setup) names it on the calendar; the note is
 * only for the owners. Over a class or party the server says what it clashes
 * with and the owner can block anyway; nothing booked changes either way.
 * Below, the blocks coming up, each removable after a second tap.
 */
export default function BlockTimeForm({ initialDay, onDirtyChange, onBlocked, inSheet, footer }: {
  initialDay?: string
  /** Inside an /admin sheet: no heading of its own, and the buttons go into the sheet's pinned footer. */
  inSheet?: boolean
  footer?: HTMLElement | null
  /** Something typed that isn't saved yet (for the sheet's leave prompt). */
  onDirtyChange?: (dirty: boolean) => void
  /** Blocked: the sheet closes and says so; without it the form says so itself. */
  onBlocked?: (b: BlockedTime, clashes: Busy[]) => void
} = {}) {
  // A day it was opened for, or the next day the studio opens (Block time on a Monday means Thursday).
  const closed = useStudio().days.closures
  const [first] = useState(() => initialDay ?? nextOpenDay(today(), closed))
  const [day, setDay] = useState(first)
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('12:00')
  const [allDay, setAllDay] = useState(false)
  const [why, setWhy] = useState<BlockWhy>('Closed')
  const [note, setNote] = useState('')
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
  const dirty = day !== first || from !== '09:00' || to !== '12:00' || allDay || why !== 'Closed' || note.trim() !== ''
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty])

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
    const r = await api<{ blocked: BlockedTime; clashes: Busy[] }>(BLOCKED, {
      action: 'add', ...s, reason: why, ...(note.trim() ? { note: note.trim() } : {}), ...(confirm ? { confirm: true } : {}),
    })
    setBusy(false)
    if (r.ok && r.data) {
      setClash(false)
      if (onBlocked) {
        onDirtyChange?.(false)
        return onBlocked(r.data.blocked, r.data.clashes)
      }
      const over = r.data.clashes.map((c) => c.label)
      setDone(over.length ? `Blocked. It sits on ${over.join(', ')}. Nothing booked was changed.` : 'Blocked.')
      setNote('')
      load()
      return
    }
    setError(r.error ?? '')
    setClash(r.status === 409 && Array.isArray(r.extra.clashes))
  }

  const buttons = clash
    ? (
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={() => { setClash(false); setError('') }}>Pick another time</button>
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => send(true)}>Block anyway</button>
      </div>
    )
    : inSheet
      ? <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => send(false)}>{busy ? 'Blocking…' : 'Block this time'}</button>
      : <button type="submit" className="adm-btn is-pri" disabled={busy}>{busy ? 'Blocking…' : 'Block this time'}</button>

  return (
    <div className="adm-block">
      {!inSheet && <h1 className="adm-h1">Block time</h1>}
      <form className="adm-blockform" onSubmit={(e: FormEvent) => { e.preventDefault(); send(false) }}>
        <label className="adm-fld">
          <span>Day</span>
          <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setClash(false) }} />
        </label>
        <label className="adm-check">
          <input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setClash(false) }} />
          <span>All day</span>
        </label>
        {!allDay && (
          <div className="adm-two">
            <label className="adm-fld">
              <span>From</span>
              <input type="time" value={from} onChange={(e) => { setFrom(e.target.value); setClash(false) }} />
            </label>
            <label className="adm-fld">
              <span>To</span>
              <input type="time" value={to} onChange={(e) => { setTo(e.target.value); setClash(false) }} />
            </label>
          </div>
        )}
        <p className="adm-fldlabel" id="adm-block-why">Why</p>
        <Seg label="Why" value={why} onChange={setWhy} options={BLOCK_WHY.map(([v, l]) => [v, l] as [BlockWhy, string])} />
        <label className="adm-fld adm-blocknote">
          <span>Note <span className="adm-muted">(only you see it)</span></span>
          <input maxLength={200} value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p role="alert" className="adm-error">{error}</p>}
        {done && <p role="status" className="adm-done">{done}</p>}
        {!inSheet && buttons}
      </form>
      {inSheet && footer && createPortal(buttons, footer)}
      <h2 className="adm-h2">Coming up</h2>
      {listError && <p role="alert" className="adm-error">{listError}</p>}
      {list && list.length === 0 && <p className="adm-muted">No blocked time coming up.</p>}
      {list && list.length > 0 && (
        <ul className="adm-plain adm-blocklist">
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
    <li aria-label={label} className="adm-blockrow">
      <span className="adm-grow">
        {label}
        {b.note && <small className="adm-muted">{`Note: ${b.note}`}</small>}
      </span>
      <span className="adm-blockbtns">
        {!asking && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAsking(true)}>Remove</button>}
        {asking && (
          <>
            <button type="button" className="adm-btn is-danger is-sm" onClick={remove}>Yes, remove it</button>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAsking(false)}>Keep it</button>
          </>
        )}
      </span>
      {error && <p role="alert" className="adm-error">{error}</p>}
    </li>
  )
}
