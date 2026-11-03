/**
 * The Staff section (stage 3 Task 10) on a class day, a party and a Square
 * class, and inline on More › Staff: how many people it needs, who is on,
 * and everyone working here with what they said about that time (in words:
 * Can / Can't (note) / Part (hours) / Outside the hours they gave / Not
 * said), whether they asked to work it, and Put on / Take off. A class with
 * several days also offers "every day" (one message listing the days).
 *
 * Every button is off while a change is saving (a double tap never sends two
 * messages). Someone on at a time they marked Can't gets "Check with them"
 * with Call and Text. A class or party that was cancelled keeps the people on
 * it until an owner takes them off. A read that fails says so, with Try
 * again, never "nobody can".
 */
import { useEffect, useRef, useState } from 'react'
import { MAX_NEEDED } from '@lib/staffing/rules'
import { api } from '../classes/api'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import {
  STAFFING, markWords, names, phoneWords, postAssign, postNeeded, smsHref, stateWords, telHref,
  type Contacts, type StaffingRow, type StaffPersonRow,
} from './api'

/** "Maya" from "Maya Lopez" (the Put … on button says who). */
const firstOfName = (name: string) => name.trim().split(/\s+/)[0] || 'them'

export interface StaffDay { key: string; startIso: string }

export function StaffRow({ eventKey, startIso, days, onChanged, headingLevel = 3, initial, bare }: {
  eventKey: string
  /** The time the sheet shows: only helps find a Square-booked party or a Square class. */
  startIso?: string
  /** Every day of a class (for "every day"); one day or none = no batch buttons. */
  days?: StaffDay[]
  /** After a change saved (the board refreshes its row). */
  onChanged?: (row: StaffingRow) => void
  headingLevel?: 2 | 3
  /** The row as the board already has it (no second read until Try again or a change). */
  initial?: { row: StaffingRow; contacts: Contacts }
  /** Inside a board card: no "Staff" heading. */
  bare?: boolean
}) {
  const toast = useToast()
  const { bump } = useRefresh()
  const [row, setRow] = useState<StaffingRow | null>(initial?.row ?? null)
  const [contacts, setContacts] = useState<Contacts>(initial?.contacts ?? {})
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [tell, setTell] = useState(true)
  /** Which change is saving ('' = none): every button waits for it. */
  const [busy, setBusy] = useState('')
  /** B5: the last message that didn't go through, so the owner can call or text them instead. */
  const [missed, setMissed] = useState<{ staffId: string; name: string } | null>(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  useEffect(() => {
    if (initial && tries === 0) return
    let current = true
    setError('')
    setRow(null)
    const q = new URLSearchParams({ key: eventKey, ...(startIso ? { start: startIso } : {}) })
    api<{ row: StaffingRow; contacts?: Contacts }>(`${STAFFING}?${q}`).then((r) => {
      if (!current) return
      if (r.ok && r.data) { setRow(r.data.row); setContacts(r.data.contacts ?? {}) }
      else setError(r.error ?? 'Couldn’t check staffing.')
    })
    return () => { current = false }
  }, [eventKey, startIso, tries])

  const H = `h${headingLevel}` as 'h2' | 'h3'
  const heading = bare ? null : <H className="adm-staff-h">Staff</H>
  if (error) return <section aria-label="Staff">{heading}<Failed message={error} onRetry={() => setTries((n) => n + 1)} /></section>
  if (!row) return <section aria-label="Staff">{heading}<Skeleton rows={2} label="Loading who’s on" /></section>

  const ev = row.event
  const past = Date.parse(ev.endIso) <= Date.now()
  const cancelled = ev.status !== 'on'
  const many = (days ?? []).length > 1 && ev.kind === 'class'
  const upcomingDays = (days ?? []).filter((d) => Date.parse(d.startIso) > Date.now() - 6 * 3_600_000)
  // From a day that already happened, Every day / Off every day still tell people about the days to come.
  const tellsAhead = many && upcomingDays.length > 0
  const showTell = !cancelled && (!past || tellsAhead)

  function applied(next: StaffingRow | null | undefined) {
    if (next && live.current) { setRow(next); onChanged?.(next) }
    bump()
  }

  async function change(p: { staffId: string; name: string }, action: 'assign' | 'unassign', all: boolean) {
    if (busy) return
    setBusy(`${action}-${p.staffId}-${all ? 'all' : 'one'}`)
    setMissed(null)
    const sendTell = tell && !cancelled && (all || !past)
    const keys = all ? (upcomingDays.length ? upcomingDays : days ?? []).map((d) => d.key) : null
    const r = keys
      ? await postAssign({ action, staffId: p.staffId, tell: sendTell, keys, hints: Object.fromEntries((days ?? []).map((d) => [d.key, d.startIso])) })
      : await postAssign({ action, staffId: p.staffId, tell: sendTell, key: eventKey, ...(startIso ? { startIso } : {}) })
    if (!live.current) return
    setBusy('')
    if (!r.ok || !r.data) { toast(r.error ?? DIDNT_SAVE); return }
    const mine = keys ? (r.data.rows ?? []).find((x) => x?.event.key === eventKey) : r.data.row
    applied(mine ?? null)
    const done = action === 'assign'
      ? keys ? `${p.name} is on ${keys.length === 1 ? 'that day' : `all ${keys.length} days`}.` : `${p.name} is on.`
      : keys ? `${p.name} is off ${keys.length === 1 ? 'that day' : `all ${keys.length} days`}.` : `${p.name} is off.`
    toast(r.warning ? `${done} ${r.warning}` : done)
    const u = r.extra.undelivered
    if (u && typeof u.staffId === 'string' && typeof u.name === 'string') setMissed({ staffId: u.staffId, name: u.name })
  }

  async function setNeeded(n: number | null) {
    if (busy) return
    setBusy('needed')
    const r = await postNeeded(eventKey, n, row!.entry?.updatedAt ?? null, startIso)
    if (!live.current) return
    setBusy('')
    if (r.ok && r.data) { applied(r.data.row); toast(n === null ? 'Back to the usual number.' : n === 0 ? 'Nobody needed on this one.' : `${n} ${n === 1 ? 'person' : 'people'} needed.`); return }
    toast(r.error ?? DIDNT_SAVE)
    // Someone else changed it: show the latest.
    if (r.status === 409) setTries((x) => x + 1)
  }

  const custom = typeof row.entry?.needed === 'number'
  const assigned = row.people.filter((p) => p.assigned)
  const shown = cancelled ? assigned : row.people
  const cant = assigned.filter((p) => p.verdict === 'cant')

  return (
    <section aria-label="Staff" className="adm-staff">
      {heading}
      {!bare && <p className="adm-staff-state" role="status">{stateWords(row)}</p>}

      {cancelled && (
        <div className="adm-panel is-warn adm-gap-bottom">
          <b>{ev.status === 'cancelled' ? 'This was cancelled' : 'This is no longer on the schedule'}</b>
          <span className="adm-small">{assigned.length || row.leftTeam.length ? 'Tell the people on it, then take them off. Nobody is told for you.' : 'Nobody is on it.'}</span>
        </div>
      )}
      {past && !cancelled && (
        <p className="adm-note">
          {tellsAhead
            ? 'This day already happened. Put on and Take off here are kept for the record, and nobody is told. Every day and Off every day tell them about the days still to come.'
            : 'This already happened. Changes are kept for the record, and nobody is told.'}
        </p>
      )}

      {!cancelled && (
        <div className="adm-staff-needed" role="group" aria-label="People needed">
          <span className="adm-staff-lbl">People needed</span>
          <div className="adm-stepper">
            <button type="button" className="adm-btn is-ghost is-sm" aria-label="One fewer person needed" disabled={!!busy || row.needed <= 0} onClick={() => setNeeded(row.needed - 1)}>−</button>
            <b aria-live="polite">{row.needed}</b>
            <button type="button" className="adm-btn is-ghost is-sm" aria-label="One more person needed" disabled={!!busy || row.needed >= MAX_NEEDED} onClick={() => setNeeded(row.needed + 1)}>+</button>
          </div>
          {custom
            ? <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => setNeeded(null)}>Usual</button>
            : <span className="adm-small adm-muted">Usual</span>}
        </div>
      )}

      {missed && (
        <div className="adm-panel is-warn adm-gap-bottom" role="group" aria-label={`Tell ${missed.name} yourself`}>
          <b>{`The message to ${missed.name} didn’t go through`}</b>
          <span className="adm-small">{`Call or text ${missed.name} to tell them yourself.`}</span>
          <ContactRow name={missed.name} phone={contacts[missed.staffId]?.phone ?? null} left={contacts[missed.staffId]?.left} />
          <button type="button" className="adm-quiet" onClick={() => setMissed(null)}>Done</button>
        </div>
      )}
      {cant.map((p) => <CheckWith key={p.staffId} person={p} contacts={contacts} />)}

      {showTell && (
        <label className="adm-check adm-staff-tell">
          <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />
          <span>Tell them by text and email</span>
        </label>
      )}

      {shown.length === 0 && !row.leftTeam.length && <p className="adm-empty">{cancelled ? 'Nobody is on it.' : 'Nobody is on the staff list yet. Add people in More › Staff › People.'}</p>}
      <ul className="adm-plain adm-staff-people" aria-label="Who can work">
        {shown.map((p) => (
          <li key={p.staffId} className="adm-staff-person">
            <div className="adm-rm">
              <b>{p.name}{p.assigned && <span className="adm-tag is-on">On</span>}</b>
              <small>
                <span>{markWords(p)}</span>
                {p.asked && <span className="adm-staff-asked">{` · ★ Asked${p.askNote ? ` · “${p.askNote}”` : ''}`}</span>}
              </small>
            </div>
            <div className="adm-staff-btns">
              {p.assigned
                ? <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => change(p, 'unassign', false)}>{busy === `unassign-${p.staffId}-one` ? 'Saving…' : 'Take off'}</button>
                : <button type="button" className="adm-btn is-pri is-sm" disabled={!!busy} onClick={() => change(p, 'assign', false)}>{busy === `assign-${p.staffId}-one` ? 'Saving…' : `Put ${firstOfName(p.name)} on`}</button>}
              {many && !cancelled && (
                <>
                  <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => change(p, 'assign', true)}>{busy === `assign-${p.staffId}-all` ? 'Saving…' : 'Every day'}</button>
                  {p.assigned && <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => change(p, 'unassign', true)}>{busy === `unassign-${p.staffId}-all` ? 'Saving…' : 'Off every day'}</button>}
                </>
              )}
            </div>
          </li>
        ))}
        {row.leftTeam.map((p) => (
          <li key={p.staffId} className="adm-staff-person">
            <div className="adm-rm">
              <b>{p.name}<span className="adm-tag is-on">On</span></b>
              <small>No longer works here, so this doesn’t count as someone on.</small>
            </div>
            <div className="adm-staff-btns">
              <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => change({ ...p }, 'unassign', false)}>{busy === `unassign-${p.staffId}-one` ? 'Saving…' : 'Take off'}</button>
            </div>
          </li>
        ))}
      </ul>
      {many && !cancelled && <p className="adm-small adm-muted">{`Every day puts them on all ${upcomingDays.length || (days ?? []).length} days still to come, with one message listing the days.`}</p>}
      {cancelled && assigned.length > 0 && <CancelledContacts people={assigned} contacts={contacts} />}
    </section>
  )
}

/** "Jessica marked this time as Can't. Check with Jessica." with Call and Text. */
export function CheckWith({ person, contacts }: { person: Pick<StaffPersonRow, 'staffId' | 'name' | 'markNote'>; contacts: Contacts }) {
  const phone = contacts[person.staffId]?.phone ?? null
  return (
    <div className="adm-panel is-warn adm-gap-bottom" role="group" aria-label={`Check with ${person.name}`}>
      <b>{`${person.name} marked this time as Can’t${person.markNote ? ` (${person.markNote})` : ''}`}</b>
      <span className="adm-small">{`Check with ${person.name}, or take ${person.name} off.`}</span>
      <ContactRow name={person.name} phone={phone} left={contacts[person.staffId]?.left} />
    </div>
  )
}

/** Call and Text as links, or how to add a number (someone who left can't be edited, so that's said instead). */
export function ContactRow({ name, phone, left }: { name: string; phone: string | null; left?: boolean }) {
  if (!phone && left) return <span className="adm-small">{`${name} no longer works here, and there’s no phone number saved for ${name}.`}</span>
  if (!phone) return <span className="adm-small">{`There’s no phone number saved for ${name}. Add one in More › Staff › People.`}</span>
  return (
    <div className="adm-contactrow">
      <a className="adm-btn is-ghost" href={telHref(phone)} aria-label={`Call ${name} at ${phoneWords(phone)}`}>{`Call ${name}`}</a>
      <a className="adm-btn is-ghost" href={smsHref(phone)} aria-label={`Text ${name} at ${phoneWords(phone)}`}>{`Text ${name}`}</a>
    </div>
  )
}

function CancelledContacts({ people, contacts }: { people: StaffPersonRow[]; contacts: Contacts }) {
  return (
    <div className="adm-gap-top" role="group" aria-label="Tell them">
      <p className="adm-small">{`Tell ${names(people.map((p) => p.name))}:`}</p>
      {people.map((p) => <ContactRow key={p.staffId} name={p.name} phone={contacts[p.staffId]?.phone ?? null} left={contacts[p.staffId]?.left} />)}
    </div>
  )
}
