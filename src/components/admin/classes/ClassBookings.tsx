import { useEffect, useState } from 'react'
import type { BookedPerson, BookingView } from '@lib/classes/admin-actions'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { formatDayAndSpan } from '@lib/studio-time'
import { api, BOOKINGS, CLASSES } from './api'
import RefundPanel from './RefundPanel'
import ScheduleDialog from './ScheduleDialog'
import { box, errorText, muted, row, warnText } from './ui'

const STATUS: Record<string, string> = { draft: 'Draft (only you see it)', open: 'Open for booking', closed: 'Sign-ups closed', cancelled: 'Cancelled' }
const STATE: Record<BookingView['state'], string> = { held: 'Paying now', confirmed: 'Paid', refunded: 'Refunded', 'part refunded': 'Part refunded' }
const SOURCE: Record<string, string> = { online: 'Online', 'door-card': 'At the door (card)', 'door-counter': 'At the counter', comp: 'Comp', pos: 'POS' }

const nameOf = (b: BookingView) => (b.customer ? `${b.customer.givenName} ${b.customer.familyName}`.trim() || 'No name yet' : 'No name yet')

/**
 * One scheduled class and everyone booked on it. Each paid booking has a
 * Refund button (RefundPanel). From here the class can be edited,
 * run again on new dates, or cancelled (which never refunds anyone).
 */
export default function ClassBookings({ id, onEdit, onBack, onDuplicated }: {
  id: string
  onEdit: (cls: ScheduledClass) => void
  onBack: () => void
  onDuplicated?: (cls: ScheduledClass) => void
}) {
  const [cls, setCls] = useState<ScheduledClass | null>(null)
  const [bookings, setBookings] = useState<BookingView[]>([])
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const [stale, setStale] = useState(false)
  const [warning, setWarning] = useState('')
  const [booked, setBooked] = useState<BookedPerson[] | null>(null)
  const [copying, setCopying] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    setStale(false)
    const r = await api<{ class: ScheduledClass; bookings: BookingView[] }>(`${BOOKINGS}?id=${encodeURIComponent(id)}`)
    if (r.ok && r.data) { setCls(r.data.class); setBookings(r.data.bookings) } else setError(r.error ?? '')
  }
  useEffect(() => { load() }, [id])

  async function cancel() {
    if (!cls) return
    setBusy(true)
    setError('')
    const r = await api<{ class: ScheduledClass; booked: BookedPerson[] }>(CLASSES, { action: 'cancel', id: cls.id, expectedUpdatedAt: cls.updatedAt })
    setBusy(false)
    setAsking(false)
    if (r.ok && r.data) {
      setCls(r.data.class)
      setBooked(r.data.booked)
      setWarning(r.warning ?? '')
      return
    }
    setError(r.error ?? '')
    setStale(r.status === 409 && r.extra.stale === true)
  }

  if (!cls) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start' }} onClick={onBack}>Back</button>
        {error ? <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></p> : <p style={muted}>Loading…</p>}
      </div>
    )
  }

  const c = cls.content
  const ticket = (t: string) => c.ticketTypes.find((x) => x.id === t)?.label ?? t
  const live = bookings.filter((b) => b.state !== 'refunded')
  const takenOn = (sid: string) => live.filter((b) => b.sessionIds.includes(sid)).reduce((s, b) => s + Object.values(b.seats).reduce((a, n) => a + n, 0), 0)

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.6rem', color: 'var(--color-dark)' }}>{c.name}</h1>
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
      </div>
      <p style={{ margin: 0, fontWeight: 600 }}>{STATUS[cls.status]}</p>
      <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
        {cls.sessions.map((s) => (
          <li key={s.id}>{formatDayAndSpan(s.startIso, s.endIso)} · <span>{`${takenOn(s.id)} of ${s.capacity} seats taken`}</span></li>
        ))}
      </ul>
      {cls.status !== 'cancelled' && !copying && (
        <div style={row}>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(cls)}>Edit class</button>
          <button type="button" className="btn btn-secondary" onClick={() => setCopying(true)}>Run it again</button>
          {!asking && <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>Cancel this class</button>}
        </div>
      )}
      {cls.status === 'cancelled' && !copying && (
        <div style={row}><button type="button" className="btn btn-secondary" onClick={() => setCopying(true)}>Run it again</button></div>
      )}
      {copying && (
        <ScheduleDialog
          name={c.name}
          duplicateId={cls.id}
          copyOf={cls.sessions}
          defaultMinutes={c.defaultMinutes}
          defaultCapacity={c.defaultCapacity}
          onCancel={() => setCopying(false)}
          onDone={(next) => { setCopying(false); onDuplicated?.(next) }}
        />
      )}
      {asking && (
        <div role="group" aria-label="Cancel the class" style={{ ...box, borderColor: '#b91c1c' }}>
          <p style={{ margin: 0 }}>Cancelling takes the class off sale and off the POS. Nobody is refunded and no seat is freed. You’ll get a list of who to contact.</p>
          <div style={row}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={cancel}>Yes, cancel the class</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Keep it</button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={errorText}>{error}</p>}
      {stale && <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={load}>Reload</button>}
      {warning && <p role="alert" style={warnText}>{warning}</p>}
      {booked && (
        <div style={box}>
          <p style={{ margin: 0, fontWeight: 700 }}>{booked.length ? 'Cancelled. Let these people know.' : 'Cancelled. Nobody was booked.'}</p>
          {booked.length > 0 && (
            <ul aria-label="People to contact" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {booked.map((p) => <li key={p.bookingId}>{[p.name || 'No name', p.email, p.phone, `${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}`, `paid ${formatMoney(p.paidCents)}`].filter(Boolean).join(' · ')}</li>)}
            </ul>
          )}
        </div>
      )}
      <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>Bookings</h2>
      {bookings.length === 0 && <p style={muted}>No bookings yet.</p>}
      {bookings.map((b) => {
        const name = nameOf(b)
        const pass = c.passes.length > 1 ? c.passes.find((p) => p.id === b.passId)?.label : ''
        return (
          <article key={b.bookingId} aria-label={name} style={box}>
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-dark)' }}>{name}</h3>
              <span style={{ fontWeight: 700 }}>{STATE[b.state]}</span>
            </div>
            <p style={{ margin: 0 }}>{Object.entries(b.seats).map(([t, n]) => `${n} ${ticket(t)}`).join(', ')}</p>
            {pass && <p style={{ margin: 0 }}>{pass}</p>}
            {b.customer && (
              <p style={{ ...row, margin: 0 }}>
                {b.customer.email && <a href={`mailto:${b.customer.email}`} style={{ color: 'var(--color-primary)' }}>{b.customer.email}</a>}
                {b.customer.phone && <a href={`tel:${b.customer.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--color-primary)' }}>{b.customer.phone}</a>}
              </p>
            )}
            {c.questions.length > 0 && b.picks.some((p) => Object.keys(p.answers).length) && (
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {b.picks.map((p) => (
                  <li key={p.seat}>{`Seat ${p.seat} (${ticket(p.ticketTypeId)}) · ${c.questions.map((q) => (p.answers[q.id] ? `${q.label} ${p.answers[q.id]}` : '')).filter(Boolean).join(', ')}`}</li>
                ))}
              </ul>
            )}
            {Object.keys(b.addOns).length > 0 && (
              <p style={{ margin: 0 }}>{Object.entries(b.addOns).map(([a, n]) => `${n} ${c.addOns.find((x) => x.id === a)?.label ?? a}`).join(', ')}</p>
            )}
            <p style={{ ...muted, fontSize: '0.9rem' }}>
              {[`Paid ${formatMoney(b.paidCents)}`, b.refundedCents ? `refunded ${formatMoney(b.refundedCents)}` : '', SOURCE[b.source] ?? b.source].filter(Boolean).join(' · ')}
            </p>
            {b.overCapacity && <p style={warnText}>This seat landed after the class was full. Check the room has space.</p>}
            <div data-refund-slot={b.bookingId}>
              {b.state !== 'held' && <RefundPanel classId={cls.id} booking={b} ticketLabel={ticket} onDone={load} />}
            </div>
          </article>
        )
      })}
    </div>
  )
}
