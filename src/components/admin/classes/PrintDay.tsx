import { useEffect, useState } from 'react'
import type { DayClass, DayEvent, SignedWaiver } from '@pages/api/admin/classes/day.json'
import type { Busy } from '@lib/classes/studio-schedule'
import { formatTimeSpan } from '@lib/studio-time'
import { api, DAY } from './api'
import { dayLabel } from './dates'
import { box, errorText, muted, row } from './ui'

interface DayData { day: string; classes: DayClass[]; events: DayEvent[]; other: Busy[] }

const counts = (m: Record<string, number>) => Object.entries(m).filter(([, n]) => n > 0)

/**
 * One day on paper: each class session with its roster (seats, picks, add-ons,
 * waiver signed or not), what to prepare, then parties and the rest of the day.
 * The Print button prints just this sheet.
 */
export default function PrintDay({ day: initialDay, onBack }: { day: string; onBack: () => void }) {
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
    <div className="print-day" style={{ display: 'grid', gap: '1rem' }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-day, .print-day * { visibility: visible; }
          .print-day { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .print-day section { break-inside: avoid; border-color: #999 !important; }
        }
        .print-day table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .print-day th, .print-day td { text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-line); vertical-align: top; }
      `}</style>
      <div className="no-print" style={row}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          <span className="field-label">Day</span>
          <input className="field-input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>
      <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>{dayLabel(day)}</h1>
      {error && <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary no-print" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
      {!error && !data && <p style={muted}>Loading…</p>}
      {data && !data.classes.length && !data.events.length && !data.other.length && <p style={muted}>Nothing on this day.</p>}
      {data?.classes.map((c) => <ClassSheet key={`${c.id}-${c.sessionId}`} c={c} />)}
      {data?.events.map((e) => (
        <section key={`${e.id}-${e.startIso}`} role="region" aria-label={e.label} style={box}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-dark)' }}>{e.label}</h2>
          <p style={muted}>{formatTimeSpan(e.startIso, e.endIso)} · {e.kind === 'party' ? 'Party' : 'Square class'}</p>
          <Waivers list={e.waivers} />
        </section>
      ))}
      {!!data?.other.length && (
        <section style={box}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-dark)' }}>Also today</h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {data.other.map((o) => <li key={o.id}>{o.kind === 'closed' ? o.label : `${o.label} · ${formatTimeSpan(o.startIso, o.endIso)}`}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function Waivers({ list }: { list: SignedWaiver[] | null }) {
  if (list === null) return <p style={muted}>Waivers couldn’t be read.</p>
  if (!list.length) return <p style={muted}>No waivers signed yet.</p>
  return (
    <p style={{ margin: 0 }}>
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
    <section role="region" aria-label={c.name} style={box}>
      <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-dark)' }}>{c.name}</h2>
      <p style={muted}>{formatTimeSpan(c.startIso, c.endIso)}</p>
      <p style={{ margin: 0, fontWeight: 700 }}>{`${seats} of ${c.capacity} seats`}</p>
      {c.content.ticketTypes.length > 1 && (
        <p style={{ margin: 0 }}>{c.content.ticketTypes.map((t) => `${t.label} ${seatTotals[t.id] ?? 0}`).join(' · ')}</p>
      )}
      {c.content.questions.map((q) => (
        <p key={q.id} style={{ margin: 0 }}>{`${q.label}: ${q.choices.map((ch) => `${ch} ${pickTotals[q.id]?.[ch] ?? 0}`).join(' · ')}`}</p>
      ))}
      {counts(addOnTotals).map(([id, n]) => (
        <p key={id} style={{ margin: 0 }}>{`${c.content.addOns.find((a) => a.id === id)?.label ?? id} ${n}`}</p>
      ))}
      {c.bookings.length === 0 ? <p style={muted}>No one booked yet.</p> : (
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
