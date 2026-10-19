import { useMemo, useState } from 'react'
import type { BookingView } from '@lib/classes/admin-actions'
import { formatMoney } from '@lib/money'
import { api } from './api'
import { box, errorText, input, muted, row } from './ui'

export const ADMIN_REFUND = '/api/admin/classes/refund.json'
export const STAFF_REFUND = '/api/staff/class-refund.json'

type Kind = 'booking' | 'person' | 'session' | 'custom'

/**
 * A "Refund" button for one class booking that opens an in-page panel (no
 * browser dialogs). Self-contained so any layout can mount it: give it the
 * booking, the class id, which route to call, and whether a reason is
 * required (crew) or optional (owners). The amounts shown are a preview; the
 * server works them out again from the ledger.
 */
export default function RefundPanel({ classId, booking, ticketLabel, endpoint = ADMIN_REFUND, reasonRequired = false, last4, onDone }: {
  classId: string
  booking: BookingView
  ticketLabel?: (ticketTypeId: string) => string
  endpoint?: string
  reasonRequired?: boolean
  /** the card's last four digits, when the screen knows them */
  last4?: string
  onDone?: () => void
}) {
  const seats = booking.refundable.filter((s) => s.remainingCents > 0)
  const multi = seats.filter((s) => s.sessionCents > 0)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('booking')
  const [person, setPerson] = useState(seats[0]?.id ?? '')
  const [sessionSeats, setSessionSeats] = useState<string[]>(multi.map((s) => s.id))
  const [amount, setAmount] = useState('')
  const [freeSeat, setFreeSeat] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const label = (t: string) => ticketLabel?.(t) ?? t
  const left = seats.reduce((s, x) => s + x.remainingCents, 0)
  const amountCents = Math.round(Number(amount) * 100)

  const preview = useMemo(() => {
    if (kind === 'booking') return left
    if (kind === 'person') return seats.find((s) => s.id === person)?.remainingCents ?? 0
    if (kind === 'session') return multi.filter((s) => sessionSeats.includes(s.id)).reduce((a, s) => a + s.sessionCents, 0)
    return Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 0
  }, [kind, person, sessionSeats, amountCents, left])

  if (!booking.paidHere) return booking.source === 'comp' ? null : <p style={{ ...muted, fontSize: '0.9rem' }}>Refund this one in Square, where it was paid.</p>
  if (!seats.length) return null

  function choose(k: Kind) {
    setKind(k)
    setFreeSeat(k !== 'custom')
    setError('')
  }

  const reasonOk = !reasonRequired || reason.trim().length >= 3
  const tooMuch = kind === 'custom' && preview > left
  const canGo = preview > 0 && !tooMuch && reasonOk && !busy

  async function go() {
    setBusy(true)
    setError('')
    const body: Record<string, unknown> = { classId, bookingId: booking.bookingId, kind, freeSeat, reason: reason.trim() }
    if (kind === 'person') body.lineIds = [person]
    if (kind === 'session') body.lineIds = sessionSeats
    if (kind === 'custom') body.cents = amountCents
    const r = await api<{ cents: number; emailed: boolean }>(endpoint, body)
    setBusy(false)
    if (!r.ok || !r.data) { setError(r.error ?? ''); return }
    setDone(`Refunded ${formatMoney(r.data.cents)}.${r.data.emailed ? ' They’ve been emailed.' : ''}`)
    setOpen(false)
    setReason('')
    setAmount('')
    onDone?.()
  }

  if (!open) {
    return (
      <div style={row}>
        <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setDone('') }}>Refund</button>
        {done && <span role="status" style={{ fontWeight: 600 }}>{done}</span>}
      </div>
    )
  }

  const radio = (k: Kind, text: string) => (
    <label style={{ ...row, cursor: 'pointer' }}>
      <input type="radio" name={`refund-kind-${booking.bookingId}`} checked={kind === k} onChange={() => choose(k)} />
      {text}
    </label>
  )

  return (
    <div role="group" aria-label="Refund" style={{ ...box, borderColor: 'var(--color-primary)' }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Refund</p>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {radio('booking', `The whole booking (${formatMoney(left)})`)}
        {seats.length > 1 && radio('person', 'One person')}
        {multi.length > 0 && radio('session', 'One session')}
        {radio('custom', 'Another amount')}
      </div>
      {kind === 'person' && (
        <select aria-label="Who" value={person} onChange={(e) => setPerson(e.target.value)} style={input}>
          {seats.map((s) => <option key={s.id} value={s.id}>{`Seat ${s.seat} (${label(s.ticketTypeId)}) · ${formatMoney(s.remainingCents)}`}</option>)}
        </select>
      )}
      {kind === 'session' && (
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          <p style={{ ...muted, fontSize: '0.9rem' }}>One session’s share of the seat, with its tax. Add-ons aren’t included.</p>
          {multi.map((s) => (
            <label key={s.id} style={{ ...row, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sessionSeats.includes(s.id)}
                onChange={(e) => setSessionSeats((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
              />
              {`Seat ${s.seat} (${label(s.ticketTypeId)}) · ${formatMoney(s.sessionCents)} of ${s.sessions} sessions`}
            </label>
          ))}
        </div>
      )}
      {kind === 'custom' && (
        <label style={{ display: 'grid', gap: '0.3rem' }}>
          <span>{`Amount (up to ${formatMoney(left)})`}</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
        </label>
      )}
      <label style={{ ...row, cursor: 'pointer' }}>
        <input type="checkbox" checked={freeSeat} onChange={(e) => setFreeSeat(e.target.checked)} />
        Free the seat so someone else can book it
      </label>
      <label style={{ display: 'grid', gap: '0.3rem' }}>
        <span>{reasonRequired ? 'Reason' : 'Reason (optional)'}</span>
        <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={input} />
      </label>
      {tooMuch && <p role="alert" style={errorText}>That is more than is left to refund.</p>}
      {preview > 0 && !tooMuch && (
        <p style={{ margin: 0, fontWeight: 600 }}>{`Refund ${formatMoney(preview)} ${last4 ? `to the card ending in ${last4}` : 'to their card'}.`}</p>
      )}
      {error && <p role="alert" style={errorText}>{error}</p>}
      <div style={row}>
        <button type="button" className="btn btn-primary" disabled={!canGo} onClick={go}>{busy ? 'Refunding…' : 'Confirm refund'}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError('') }}>Back</button>
      </div>
    </div>
  )
}
