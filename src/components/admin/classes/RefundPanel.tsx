import { useEffect, useMemo, useState } from 'react'

/** A fresh token for one refund ask (kept across its retries). */
function newAttempt(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}
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
  const all = booking.refundable ?? []
  const seats = all.filter((s) => s.remainingCents > 0)
  const multi = seats.filter((s) => s.sessionCents > 0)
  const holding = all.filter((s) => !s.freed)
  const [open, setOpen] = useState(false)
  const [freeing, setFreeing] = useState(false)
  const [freeWho, setFreeWho] = useState('all')
  const [kind, setKind] = useState<Kind>('booking')
  const [person, setPerson] = useState(seats[0]?.id ?? '')
  const [sessionSeats, setSessionSeats] = useState<string[]>(multi.map((s) => s.id))
  const [amount, setAmount] = useState('')
  const [freeSeat, setFreeSeat] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  /** the same refund was already made: what the server said; nothing was sent */
  const [already, setAlready] = useState('')
  // The same token on every retry of this refund, so the server continues it instead of making a second one.
  const [attempt, setAttempt] = useState(newAttempt)

  const label = (t: string) => ticketLabel?.(t) ?? t
  // A different ask is not the one already made: back to "Confirm refund".
  useEffect(() => setAlready(''), [kind, person, sessionSeats, amount, freeSeat])
  const left = Math.min(seats.reduce((s, x) => s + x.remainingCents, 0), booking.refundableCents ?? Infinity)
  const amountCents = Math.round(Number(amount) * 100)

  const preview = useMemo(() => {
    if (kind === 'booking') return left
    if (kind === 'person') return Math.min(seats.find((s) => s.id === person)?.remainingCents ?? 0, left)
    if (kind === 'session') return multi.filter((s) => sessionSeats.includes(s.id)).reduce((a, s) => a + s.sessionCents, 0)
    return Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 0
  }, [kind, person, sessionSeats, amountCents, left])

  const canRefund = booking.paidHere && left > 0
  if (!canRefund && !holding.length) return done ? <p role="status" style={{ margin: 0, fontWeight: 600 }}>{done}</p> : null

  function choose(k: Kind) {
    setKind(k)
    // One session keeps the seat by default: the seat covers every session of the pass.
    setFreeSeat(k === 'booking' || k === 'person')
    setError('')
  }

  async function free() {
    setBusy(true)
    setError('')
    const body: Record<string, unknown> = { action: 'free-seat', classId, bookingId: booking.bookingId, reason: reason.trim() }
    if (freeWho !== 'all') body.lineIds = [freeWho]
    const r = await api<{ lines: unknown[] }>(endpoint, body)
    setBusy(false)
    if (!r.ok) { setError(r.error ?? ''); return }
    setDone(freeWho === 'all' && holding.length > 1 ? 'Seats freed.' : 'Seat freed.')
    setFreeing(false)
    setReason('')
    onDone?.()
  }

  const reasonOk = !reasonRequired || reason.trim().length >= 3
  // Same as the server: custom and one session can't go past what the booking has left.
  const tooMuch = (kind === 'custom' || kind === 'session') && preview > left
  const canGo = preview > 0 && !tooMuch && reasonOk && !busy

  async function go(again = false) {
    setBusy(true)
    setError('')
    // "Refund again" is a new refund on purpose: a new token, and the server is told it's deliberate.
    const token = again ? newAttempt() : attempt
    if (again) setAttempt(token)
    const body: Record<string, unknown> = { classId, bookingId: booking.bookingId, kind, freeSeat, reason: reason.trim(), attempt: token }
    if (kind === 'person') body.lineIds = [person]
    if (kind === 'session') body.lineIds = sessionSeats
    if (kind === 'custom') body.cents = amountCents
    if (again) body.again = true
    const r = await api<{ cents: number; emailed: boolean; already?: { message: string } }>(endpoint, body)
    setBusy(false)
    if (!r.ok || !r.data) { setError(r.error ?? ''); return }
    if (r.data.already) { setAlready(r.data.already.message); return }
    setAlready('')
    setDone(`Refunded ${formatMoney(r.data.cents)}.${r.data.emailed ? ' They’ve been emailed.' : ''}`)
    setAttempt(newAttempt())
    setOpen(false)
    setReason('')
    setAmount('')
    onDone?.()
  }

  const reasonBox = (
    <label style={{ display: 'grid', gap: '0.3rem' }}>
      <span>{reasonRequired ? 'Reason' : 'Reason (optional)'}</span>
      <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={input} />
    </label>
  )

  if (freeing) {
    return (
      <div role="group" aria-label="Free their seat" style={{ ...box, borderColor: 'var(--color-primary)' }}>
        <p style={{ margin: 0, fontWeight: 700 }}>Free their seat</p>
        <p style={{ margin: 0 }}>No money goes back. The seat opens up for someone else to book.</p>
        {holding.length > 1 && (
          <select aria-label="Which seat" value={freeWho} onChange={(e) => setFreeWho(e.target.value)} style={input}>
            <option value="all">{`Every seat on this booking (${holding.length})`}</option>
            {holding.map((s) => <option key={s.id} value={s.id}>{`Seat ${s.seat} (${label(s.ticketTypeId)})`}</option>)}
          </select>
        )}
        {reasonBox}
        {error && <p role="alert" style={errorText}>{error}</p>}
        <div style={row}>
          <button type="button" className="btn btn-primary" disabled={!reasonOk || busy} onClick={free}>{busy ? 'Freeing…' : 'Yes, free the seat'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setFreeing(false); setError('') }}>Back</button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <div style={row}>
        {canRefund && <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setDone('') }}>Refund</button>}
        {holding.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setFreeing(true); setDone('') }}>Free their seat</button>}
        {!booking.paidHere && booking.source !== 'comp' && <span style={{ ...muted, fontSize: '0.9rem' }}>Refund this one in Square, where it was paid.</span>}
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
      {reasonBox}
      {tooMuch && <p role="alert" style={errorText}>That is more than is left to refund.</p>}
      {preview > 0 && !tooMuch && (
        <p style={{ margin: 0, fontWeight: 600 }}>{`Refund ${formatMoney(preview)} ${last4 ? `to the card ending in ${last4}` : 'to their card'}.`}</p>
      )}
      {error && <p role="alert" style={errorText}>{error}</p>}
      {already ? (
        <>
          <p role="status" style={{ margin: 0, fontWeight: 600 }}>{already}</p>
          <div style={row}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => go(true)}>{busy ? 'Refunding…' : 'Refund again'}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setAlready(''); setError('') }}>Back</button>
          </div>
        </>
      ) : (
        <div style={row}>
          <button type="button" className="btn btn-primary" disabled={!canGo} onClick={() => go()}>{busy ? 'Refunding…' : 'Confirm refund'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError('') }}>Back</button>
        </div>
      )}
    </div>
  )
}
