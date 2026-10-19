import { useEffect, useState } from 'react'
import type { DayClass, DayEvent, SignedWaiver } from '@pages/api/admin/classes/day.json'
import type { Busy } from '@lib/classes/studio-schedule'
import { timeSpan as formatTimeSpan } from '../shell/time'
import { api, DAY } from './api'
import { dayLabel } from './dates'

interface DayData { day: string; classes: DayClass[]; events: DayEvent[]; other: Busy[] }

const counts = (m: Record<string, number>) => Object.entries(m).filter(([, n]) => n > 0)

/**
 * One day on paper: each class session with its roster (seats, picks, add-ons,
 * waiver signed or not), what to prepare, then parties and the rest of the day.
 * The Print button prints just this sheet.
 */
export default function PrintDay({ day: initialDay, onBack, hideBack }: { day: string; onBack: () => void; hideBack?: boolean }) {
  const [day, setDay] = useState(initialDay)
  const [data, setData] = useState<DayData | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    api<DayData>(`${DAY}?day=${day}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setData(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [day, reload])

  return (
    <div className="print-day">
      <div className="no-print print-day-bar">
        {!hideBack && <button type="button" className="adm-btn is-ghost" onClick={onBack}>Back</button>}
        <label className="adm-fld">
          <span>Day</span>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <button type="button" className="adm-btn is-pri" onClick={() => window.print()}>Print</button>
      </div>
      <h1 className="adm-h1">{dayLabel(day)}</h1>
      {error && <p role="alert" className="adm-error">{error} <button type="button" className="adm-btn is-ghost is-sm no-print" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
      {!error && !data && <p className="adm-muted">Loading…</p>}
      {data && !data.classes.length && !data.events.length && !data.other.length && <p className="adm-muted">Nothing on this day.</p>}
      {data?.classes.map((c) => <ClassSheet key={`${c.id}-${c.sessionId}`} c={c} />)}
      {data?.events.map((e) => (
        <section key={`${e.id}-${e.startIso}`} role="region" aria-label={e.label} className="print-day-box">
          <h2 className="adm-h2">{e.label}</h2>
          <p className="adm-muted">{formatTimeSpan(e.startIso, e.endIso)} · {e.kind === 'party' ? 'Party' : 'Square class'}</p>
          <Waivers list={e.waivers} />
        </section>
      ))}
      {!!data?.other.length && (
        <section className="print-day-box">
          <h2 className="adm-h2">Also today</h2>
          <ul className="print-day-list">
            {data.other.map((o) => <li key={o.id}>{o.kind === 'closed' ? o.label : `${o.label} · ${formatTimeSpan(o.startIso, o.endIso)}`}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function Waivers({ list }: { list: SignedWaiver[] | null }) {
  if (list === null) return <p className="adm-muted">Waivers couldn’t be read.</p>
  if (!list.length) return <p className="adm-muted">No waivers signed yet.</p>
  return (
    <p>
      Waivers signed {list.length} · {list.map((w) => (w.kids ? `${w.name} (+${w.kids} ${w.kids === 1 ? 'kid' : 'kids'})` : w.name)).join(', ')}
    </p>
  )
}

function ClassSheet({ c }: { c: DayClass }) {
  const ticket = (id: string) => c.content.ticketTypes.find((t) => t.id === id)?.label ?? id
  const seatTotals: Record<string, number> = {}
  const addOnTotals: Record<string, number> = {}
  const pickTotals: Record<string, Record<string, number>> = {}
  for (const b of c.bookings) {
    for (const [t, n] of Object.entries(b.seats)) seatTotals[t] = (seatTotals[t] ?? 0) + n
    for (const [a, n] of Object.entries(b.addOns)) addOnTotals[a] = (addOnTotals[a] ?? 0) + n
    for (const p of b.picks) for (const [q, v] of Object.entries(p.answers)) {
      const m = (pickTotals[q] ??= {})
      m[v] = (m[v] ?? 0) + 1
    }
  }
  const seats = Object.values(seatTotals).reduce((s, n) => s + n, 0)
  const signed = c.waivers ? new Set(c.waivers.map((w) => w.email.trim().toLowerCase())) : null

  return (
    <section role="region" aria-label={c.name} className="print-day-box">
      <h2 className="adm-h2">{c.name}</h2>
      <p className="adm-muted">{formatTimeSpan(c.startIso, c.endIso)}</p>
      <p className="print-day-seats">{`${seats} of ${c.capacity} seats`}</p>
      {c.content.ticketTypes.length > 1 && (
        <p>{c.content.ticketTypes.map((t) => `${t.label} ${seatTotals[t.id] ?? 0}`).join(' · ')}</p>
      )}
      {c.content.questions.map((q) => (
        <p key={q.id}>{`${q.label}: ${q.choices.map((ch) => `${ch} ${pickTotals[q.id]?.[ch] ?? 0}`).join(' · ')}`}</p>
      ))}
      {counts(addOnTotals).map(([id, n]) => (
        <p key={id}>{`${c.content.addOns.find((a) => a.id === id)?.label ?? id} ${n}`}</p>
      ))}
      {c.bookings.length === 0 ? <p className="adm-muted">No one booked yet.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Seats</th>{c.content.questions.length > 0 && <th>Picks</th>}<th>Phone</th><th>Waiver</th></tr></thead>
          <tbody>
            {c.bookings.map((b) => {
              const name = b.customer ? `${b.customer.givenName} ${b.customer.familyName}`.trim() : 'No name yet'
              const email = b.customer?.email.trim().toLowerCase() ?? ''
              return (
                <tr key={b.bookingId}>
                  <td>{name}{b.state === 'held' ? ' (paying now)' : ''}</td>
                  <td>{counts(b.seats).map(([t, n]) => `${n} ${ticket(t)}`).join(', ')}</td>
                  {c.content.questions.length > 0 && (
                    <td>{b.picks.map((p) => c.content.questions.map((q) => p.answers[q.id]).filter(Boolean).join(' / ')).filter(Boolean).join('; ')}</td>
                  )}
                  <td>{b.customer?.phone ?? ''}</td>
                  <td>{signed === null ? 'Unknown' : email && signed.has(email) ? 'Waiver signed' : 'No waiver yet'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
