import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { BookingView } from '@lib/classes/admin-actions'
import { formatMoney } from '@lib/money'
import type { AskAnswer } from '@lib/booking-core/ask-square'

/** A fresh token for one refund ask (kept across its retries). */
function newAttempt(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

// Plain styles of its own, so /admin and /staff can both mount it.
const row: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }
const box: CSSProperties = { display: 'grid', gap: '0.6rem', padding: '1rem', borderRadius: '1rem', border: '1px solid var(--color-line)', background: 'var(--color-surface)', minWidth: 0 }
const muted: CSSProperties = { color: 'var(--color-muted)', margin: 0 }
const errorText: CSSProperties = { color: '#b91c1c', margin: 0, fontWeight: 600 }
/** The site's field: a visible border, 16px text (iPad Safari doesn't zoom), 44px tall. */
const input: CSSProperties = {
  fontSize: '1rem', minHeight: '2.75rem', width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem',
  borderRadius: '0.75rem', border: '1.5px solid var(--color-field-border)', background: 'var(--color-surface)', color: 'var(--color-dark)',
}
const fieldLabel: CSSProperties = { fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }
/** A button that can't be used yet looks it (the site's .btn doesn't dim on /staff). */
const dim = (disabled: boolean): CSSProperties => (disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {})
/** A checkbox or radio with its words: always on one line, the box at the top-left of the text (no wrapping apart on a phone). */
const checkRow: CSSProperties = { display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', minHeight: '2.75rem' }
const hintText: CSSProperties = { margin: 0, fontSize: '0.875rem', color: 'var(--color-muted)' }

const OFFLINE = "Couldn't reach the studio. Check the connection and try again."
export interface Reply<T> { ok: boolean; status: number; data?: T; error?: string; extra: Record<string, any> }
/** How the panel posts: /admin passes its own (who is signed in, and a 401 back to sign-in); /staff uses the plain one here. */
export type Send = <T>(url: string, body: unknown) => Promise<Reply<T>>
async function api<T>(url: string, body: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    const { data, error, ...extra } = json ?? {}
    if (res.ok) return { ok: true, status: res.status, data, extra }
    return { ok: false, status: res.status, error: error || (res.status === 401 ? 'Sign in first.' : 'That didn’t work. Try again.'), extra }
  } catch {
    return { ok: false, status: 0, error: OFFLINE, extra: {} }
  }
}

/** A refund saved and sent to Square that never got an answer (the server's describeRequest). */
export interface WaitingRefund {
  requestId: string
  cents: number
  at: string
  by: { id: string; name: string }
  people: { name: string; cents: number }[]
  dates: string[]
}

/**
 * A refund still waiting on Square's answer: Ask Square (read only), then only
 * the buttons that fit what Square shows (the same flow as /admin › To decide):
 * It went through (recorded with Square's refund) · Try the refund again (the
 * same request when Square shows none, a new one when it failed: never twice)
 * · It didn't go through. Nobody types what they saw: the reason comes from
 * Square's answer, and each step is logged with who tapped it.
 */
function WaitingOnSquare({ text, endpoint, ids, send, onSettled }: {
  text: string
  endpoint: string
  /** which request: { classId, bookingId, requestId } or { partyId, requestId } */
  ids: Record<string, string>
  send: Send
  onSettled: (message: string) => void
}) {
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const next = answer?.next ?? []
  const amount = formatMoney(answer?.cents ?? 0)

  async function ask() {
    setBusy('ask')
    setError('')
    const r = await send<{ asked: AskAnswer }>(endpoint, { action: 'ask-request', ...ids })
    setBusy(null)
    if (r.ok && r.data?.asked) setAnswer(r.data.asked)
    else setError(r.error ?? 'Square couldn’t be asked just now. Try again in a minute.')
  }

  async function act(outcome: 'went-through' | 'retry' | 'did-not-go-through') {
    setBusy(outcome)
    setError('')
    const r = await send<{ cents: number; emailed: boolean }>(endpoint, { action: 'request-decide', ...ids, outcome })
    setBusy(null)
    setRetrying(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? '')
      // Square showed something else by now: its new answer, with the buttons that fit it.
      if (r.extra?.asked) setAnswer(r.extra.asked as AskAnswer)
      return
    }
    const emailed = r.data.emailed ? ' They’ve been emailed.' : ''
    onSettled(outcome === 'did-not-go-through'
      ? 'Saved. That refund didn’t go through, so you can refund again.'
      : `Saved. ${formatMoney(r.data.cents)} refunded.${emailed}`)
  }

  return (
    <div role="group" aria-label="A refund is waiting on Square" style={{ ...box, borderColor: '#b45309' }}>
      <p style={{ margin: 0, fontWeight: 700 }}>A refund is waiting on Square</p>
      <p style={{ margin: 0 }}>{text}</p>
      {answer && (
        <div role="status" style={{ display: 'grid', gap: '0.2rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{answer.state === 'done' ? 'Square shows it went through' : answer.state === 'pending' ? 'Square shows it still going through' : answer.state === 'failed' ? 'Square shows it failed' : 'Square shows no refund'}</p>
          <p style={hintText}>{answer.message}</p>
        </div>
      )}
      {error && <p role="alert" style={errorText}>{error}</p>}
      {retrying ? (
        <div role="group" aria-label={`Try the ${amount} refund again?`} style={{ display: 'grid', gap: '0.4rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{`Try the ${amount} refund again?`}</p>
          <p style={hintText}>{answer?.state === 'failed' ? `Square is asked for a new ${amount} refund on the same payment. Tapping twice never refunds twice.` : 'The same request goes to Square again, so it can never refund twice.'}</p>
          <div style={row}>
            <button type="button" className="btn btn-primary" disabled={!!busy} style={dim(!!busy)} onClick={() => act('retry')}>{busy === 'retry' ? 'Refunding…' : 'Try the refund again'}</button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { setRetrying(false); setError('') }}>Back</button>
          </div>
        </div>
      ) : (
        <div style={row}>
          {next.includes('went-through') && <button type="button" className="btn btn-primary" disabled={!!busy} style={dim(!!busy)} onClick={() => act('went-through')}>{busy === 'went-through' ? 'Recording…' : 'It went through'}</button>}
          {next.includes('retry') && <button type="button" className="btn btn-primary" disabled={!!busy} style={dim(!!busy)} onClick={() => { setRetrying(true); setError('') }}>Try the refund again</button>}
          {next.includes('did-not-go-through') && <button type="button" className="btn btn-secondary" disabled={!!busy} style={dim(!!busy)} onClick={() => act('did-not-go-through')}>{busy === 'did-not-go-through' ? 'Saving…' : 'It didn’t go through'}</button>}
          <button type="button" className={answer ? 'btn btn-secondary' : 'btn btn-primary'} disabled={!!busy} style={dim(!!busy)} onClick={ask}>{busy === 'ask' ? 'Asking Square…' : answer ? 'Ask Square again' : 'Ask Square'}</button>
        </div>
      )}
    </div>
  )
}

export const ADMIN_REFUND = '/api/admin/classes/refund.json'
export const STAFF_REFUND = '/api/staff/class-refund.json'

type Kind = 'booking' | 'person' | 'session' | 'custom'

/**
 * A "Refund" button for one class booking that opens an in-page panel (no
 * browser dialogs). Shared by /admin and /staff (crew: reason required,
 * logged with their name): give it the booking, the class id, which route to
 * call, and whether a reason is required. The amounts shown are a preview;
 * the server works them out again from the ledger.
 *
 * A refund still waiting on Square (`waiting`, or a 409 naming one) shows
 * Ask Square, then only the steps that fit what Square shows (WaitingOnSquare). "Refund again" sends again:{of, token},
 * one token per "Already refunded" answer, reused across retries (R31); when
 * a retry finds its own repeat already finished, it shows as refunded.
 */
export default function RefundPanel({ classId, booking, ticketLabel, endpoint = ADMIN_REFUND, reasonRequired = false, last4, waiting: waitingProp = null, counterSalesAtRegister = false, crew = false, send = api, onDone }: {
  classId: string
  booking: BookingView
  ticketLabel?: (ticketTypeId: string) => string
  endpoint?: string
  reasonRequired?: boolean
  /** the card's last four digits, when the screen knows them */
  last4?: string
  /** a refund on this booking still waiting on Square's answer */
  waiting?: WaitingRefund | null
  /** /staff: a counter (POS) sale is refunded at the register where it was rung up, not from here */
  counterSalesAtRegister?: boolean
  /** /staff: crew wording (who to ask instead of "in Square"; the button names the amount and the person) */
  crew?: boolean
  send?: Send
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
  /**
   * "Refund again" (R31): which refund it repeats and ONE token made when the
   * "Already refunded" reply arrived, reused on every retry until it succeeds
   * or the refund is closed or changed, so a retry can never make a third.
   */
  const [againOf, setAgainOf] = useState<{ of: string; token: string } | null>(null)
  // The same token on every retry of this refund, so the server continues it instead of making a second one.
  const [attempt, setAttempt] = useState(newAttempt)
  // A refund waiting on Square: from the screen's data, or named by a 409 when a new refund was refused.
  const [waiting, setWaiting] = useState<WaitingRefund | null>(waitingProp)
  useEffect(() => { setWaiting(waitingProp) }, [waitingProp?.requestId])

  const label = (t: string) => ticketLabel?.(t) ?? t
  const customerName = booking.customer ? `${booking.customer.givenName} ${booking.customer.familyName}`.trim() : ''
  // A different ask is not the one already made: back to "Confirm refund".
  useEffect(() => { setAlready(''); setAgainOf(null) }, [kind, person, sessionSeats, amount, freeSeat])
  const left = Math.min(seats.reduce((s, x) => s + x.remainingCents, 0), booking.refundableCents ?? Infinity)
  const amountCents = Math.round(Number(amount) * 100)

  const preview = useMemo(() => {
    if (kind === 'booking') return left
    if (kind === 'person') return Math.min(seats.find((s) => s.id === person)?.remainingCents ?? 0, left)
    if (kind === 'session') return multi.filter((s) => sessionSeats.includes(s.id)).reduce((a, s) => a + s.sessionCents, 0)
    return Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 0
  }, [kind, person, sessionSeats, amountCents, left])

  const atRegister = counterSalesAtRegister && (booking.source === 'pos' || (booking.source === 'door-counter' && booking.paidHere))
  const canRefund = booking.paidHere && left > 0 && !atRegister
  if (!canRefund && !holding.length && !waiting) return done ? <p role="status" style={{ margin: 0, fontWeight: 600 }}>{done}</p> : null

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
    const r = await send<{ lines: unknown[] }>(endpoint, body)
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
  // What is still missing before Confirm refund works, said under the button.
  const missing = !reasonOk ? 'Add a reason to refund.'
    : preview > 0 || tooMuch ? null
      : kind === 'custom' ? 'Add an amount to refund.'
        : kind === 'session' ? 'Pick a seat to refund.'
          : null

  async function go(again = false) {
    setBusy(true)
    setError('')
    const body: Record<string, unknown> = { classId, bookingId: booking.bookingId, kind, freeSeat, reason: reason.trim(), attempt }
    if (kind === 'person') body.lineIds = [person]
    if (kind === 'session') body.lineIds = sessionSeats
    if (kind === 'custom') body.cents = amountCents
    // "Refund again" names the refund it repeats and keeps its one token across retries.
    if (again && againOf) body.again = againOf
    const r = await send<{ cents: number; emailed: boolean; already?: { message: string; askedId?: string; latest: { requestId: string; cents: number } } }>(endpoint, body)
    setBusy(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? '')
      if (r.extra?.pending) setWaiting(r.extra.pending as WaitingRefund)
      return
    }
    if (r.data.already && again && againOf && r.data.already.askedId === r.data.already.latest.requestId) {
      // This screen's own "Refund again", finished by Square before the retry: it worked.
      finished(r.data.already.latest.cents, false)
      return
    }
    if (r.data.already) {
      setAlready(r.data.already.message)
      // A new "Already refunded" answer: a new repeat of the latest refund, with its own token.
      setAgainOf({ of: r.data.already.latest.requestId, token: newAttempt() })
      return
    }
    finished(r.data.cents, r.data.emailed)
  }

  function finished(cents: number, emailed: boolean) {
    setAlready('')
    setAgainOf(null)
    setDone(`Refunded ${formatMoney(cents)}.${emailed ? ' They’ve been emailed.' : ''}`)
    setAttempt(newAttempt())
    setOpen(false)
    setReason('')
    setAmount('')
    onDone?.()
  }

  const reasonBox = (
    <label style={{ display: 'grid', gap: '0.3rem' }}>
      <span style={fieldLabel}>{reasonRequired ? 'Reason' : 'Reason (optional)'}</span>
      <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={input} />
    </label>
  )

  if (waiting) {
    const when = new Date(waiting.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
    return (
      <WaitingOnSquare
        text={`${formatMoney(waiting.cents)} for ${waiting.people.map((p) => p.name).join(', ') || 'this booking'}, asked by ${waiting.by.name} on ${when}. Square never said whether it went through. Tap Ask Square: it reads the payment and shows what Square did, then the right next step.`}
        endpoint={endpoint}
        ids={{ classId, bookingId: booking.bookingId, requestId: waiting.requestId }}
        send={send}
        onSettled={(message) => { setDone(message); setWaiting(null); setError(''); onDone?.() }}
      />
    )
  }

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
          <button type="button" className="btn btn-primary" disabled={!reasonOk || busy} style={dim(!reasonOk || busy)} onClick={free}>{busy ? 'Freeing…' : 'Yes, free the seat'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setFreeing(false); setError('') }}>Back</button>
        </div>
        {!reasonOk && <p data-testid="refund-hint" style={hintText}>Add a reason to free the seat.</p>}
      </div>
    )
  }

  if (!open) {
    return (
      <div style={row}>
        {canRefund && <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setDone('') }}>Refund</button>}
        {holding.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setFreeing(true); setDone('') }}>Free their seat</button>}
        {booking.source === 'door-counter' && !booking.paidHere
          ? <span style={{ ...muted, fontSize: '0.9rem' }}>Nothing was paid for this seat. Free the seat instead.</span>
          : atRegister && booking.source === 'door-counter'
            ? <span style={{ ...muted, fontSize: '0.9rem' }}>Paid at the counter. Refund it at the register, then free the seat here.</span>
          : atRegister
            ? <span style={{ ...muted, fontSize: '0.9rem' }}>Refund this at the register, where it was rung up.</span>
            : booking.free
              ? <span style={{ ...muted, fontSize: '0.9rem' }}>This booking was free, so there’s nothing to refund. Free the seat instead.</span>
            : !booking.paidHere && booking.source !== 'comp' && <span style={{ ...muted, fontSize: '0.9rem' }}>{crew ? 'This one was paid in Square. Ask Catherine or Kaden to refund it.' : 'Refund this one in Square, where it was paid.'}</span>}
        {done && <span role="status" style={{ fontWeight: 600 }}>{done}</span>}
      </div>
    )
  }

  const radio = (k: Kind, text: string) => (
    <label style={{ ...checkRow }}>
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
            <label key={s.id} style={{ ...checkRow }}>
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
          <span style={fieldLabel}>{`Amount (up to ${formatMoney(left)})`}</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
        </label>
      )}
      <label style={{ ...checkRow }}>
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
            <button type="button" className="btn btn-primary" disabled={busy || !againOf} style={dim(busy || !againOf)} onClick={() => go(true)}>{busy ? 'Refunding…' : 'Refund again'}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setAlready(''); setAgainOf(null); setError('') }}>Back</button>
          </div>
        </>
      ) : (
        <div style={row}>
          <button type="button" className="btn btn-primary" disabled={!canGo} style={dim(!canGo)} onClick={() => go()}>{busy ? 'Refunding…' : crew && preview > 0 && !tooMuch ? `Refund ${formatMoney(preview)}${customerName ? ` to ${customerName}` : ''}` : 'Confirm refund'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError('') }}>Back</button>
        </div>
      )}
      {!already && missing && <p data-testid="refund-hint" style={hintText}>{missing}</p>}
    </div>
  )
}

// ── Amount mode: parties ─────────────────────────────────────────────────────

/** One payment on a party that can be refunded: what Square took and what's left on it. */
export interface AmountCharge {
  id: string
  /** what is left to refund on it */
  left: number
  /** "Card · Sat Oct 17 · $300" */
  label: string
}

/** A party refund saved and sent to Square that never got an answer (the server's describePartyRequest). */
export interface WaitingAmountRefund {
  requestId: string
  cents: number
  at: string
  by: { id: string; name: string }
  chargeId: string | null
}

export const ADMIN_PARTY_REFUND = '/api/admin/parties/refund.json'
export const STAFF_PARTY_REFUND = '/api/staff/party-refund.json'

const givenName = (name: string) => name.trim().split(/\s+/)[0] || 'they'

/**
 * Refund all or part of one payment on a party (S2-R25: a refund is one
 * charge). Shared by /admin and /staff (crew: reason required): pick the
 * payment when there is more than one, all that's left or another amount, an
 * optional reason, then one tap on a button that names the money and the
 * person ("Refund $300 to Stefanie Justice? This sends money back to their
 * card."). The server checks the amount against the payment again.
 *
 * The same flows as RefundPanel: one attempt token across retries, "Already
 * refunded" with Refund again (R31), and a refund still waiting on Square
 * turns into Ask Square and the steps that fit its answer (WaitingOnSquare).
 */
export function AmountRefundPanel({ partyId, payer, charges, endpoint = ADMIN_PARTY_REFUND, reasonRequired = false, waiting: waitingProp = null, send = api, onDone, cancelled = false }: {
  partyId: string
  /** who the money goes back to: "Stefanie Justice" */
  payer: string
  charges: AmountCharge[]
  endpoint?: string
  reasonRequired?: boolean
  waiting?: WaitingAmountRefund | null
  send?: Send
  /** after a refund or a check: the sentence shown (so the sheet can keep it when this panel goes away, m4) */
  onDone?: (message: string) => void
  /** the party was cancelled: the confirm never says it stays booked (I5) */
  cancelled?: boolean
}) {
  const refundable = charges.filter((c) => c.left > 0)
  const [open, setOpen] = useState(false)
  const [chargeId, setChargeId] = useState(refundable[0]?.id ?? '')
  const [all, setAll] = useState(true)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [already, setAlready] = useState('')
  const [againOf, setAgainOf] = useState<{ of: string; token: string } | null>(null)
  const [attempt, setAttempt] = useState(newAttempt)
  const [waiting, setWaiting] = useState<WaitingAmountRefund | null>(waitingProp)
  useEffect(() => { setWaiting(waitingProp) }, [waitingProp?.requestId])
  // A different ask is not the one already made.
  useEffect(() => { setAlready(''); setAgainOf(null) }, [chargeId, all, amount])
  useEffect(() => { if (!refundable.some((c) => c.id === chargeId) && refundable[0]) setChargeId(refundable[0].id) }, [refundable.map((c) => c.id).join()])

  const charge = refundable.find((c) => c.id === chargeId) ?? refundable[0]
  const left = charge?.left ?? 0
  const typed = Math.round(Number(amount) * 100)
  const cents = all ? left : Number.isFinite(typed) && typed > 0 ? typed : 0
  const tooMuch = cents > left
  const reasonOk = !reasonRequired || reason.trim().length >= 3
  const canGo = !!charge && cents > 0 && !tooMuch && reasonOk && !busy
  const missing = !reasonOk ? 'Add a reason to refund.' : !all && cents === 0 ? 'Add an amount to refund.' : null
  const first = givenName(payer)

  if (!refundable.length && !waiting) return done ? <p role="status" style={{ margin: 0, fontWeight: 600 }}>{done}</p> : null

  async function go(again = false) {
    if (!charge) return
    setBusy(true)
    setError('')
    const body: Record<string, unknown> = { partyId, chargeId: charge.id, cents, reason: reason.trim(), attempt }
    if (again && againOf) body.again = againOf
    const r = await send<{ cents: number; emailed: boolean; already?: { message: string; askedId?: string; latest: { requestId: string; cents: number } } }>(endpoint, body)
    setBusy(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? '')
      if (r.extra?.pending) setWaiting(r.extra.pending as WaitingAmountRefund)
      return
    }
    if (r.data.already && again && againOf && r.data.already.askedId === r.data.already.latest.requestId) {
      finished(r.data.already.latest.cents, false)
      return
    }
    if (r.data.already) {
      setAlready(r.data.already.message)
      setAgainOf({ of: r.data.already.latest.requestId, token: newAttempt() })
      return
    }
    finished(r.data.cents, r.data.emailed)
  }

  function finished(c: number, emailed: boolean) {
    setAlready('')
    setAgainOf(null)
    const text = `Refunded ${formatMoney(c)} to ${payer}.${emailed ? ` ${first} got an email about it.` : ''}`
    setDone(text)
    setAttempt(newAttempt())
    setOpen(false)
    setReason('')
    setAmount('')
    setAll(true)
    onDone?.(text)
  }

  if (waiting) {
    const when = new Date(waiting.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
    return (
      <WaitingOnSquare
        text={`${formatMoney(waiting.cents)} back to ${payer}, asked by ${waiting.by.name} on ${when}. Square never said whether it went through. Tap Ask Square: it reads the payment and shows what Square did, then the right next step.`}
        endpoint={endpoint}
        ids={{ partyId, requestId: waiting.requestId }}
        send={send}
        onSettled={(message) => { setDone(message); setWaiting(null); setError(''); onDone?.(message) }}
      />
    )
  }

  if (!open) {
    return (
      <div style={row}>
        <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setDone('') }}>Refund</button>
        {done && <span role="status" style={{ fontWeight: 600 }}>{done}</span>}
      </div>
    )
  }

  const name = `refund-${partyId}`
  return (
    <div role="group" aria-label="Refund" style={{ ...box, borderColor: 'var(--color-primary)' }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Refund</p>
      {refundable.length > 1 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.3rem' }}>
          <legend style={{ ...fieldLabel, padding: 0, marginBottom: '0.2rem' }}>Which payment</legend>
          {refundable.map((c) => (
            <label key={c.id} style={checkRow}>
              <input type="radio" name={`${name}-charge`} checked={charge?.id === c.id} onChange={() => setChargeId(c.id)} />
              {`${c.label} · ${formatMoney(c.left)} left`}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.3rem' }}>
        <legend style={{ ...fieldLabel, padding: 0, marginBottom: '0.2rem' }}>How much</legend>
        <label style={checkRow}>
          <input type="radio" name={`${name}-amount`} checked={all} onChange={() => setAll(true)} />
          {`All that’s left (${formatMoney(left)})`}
        </label>
        <label style={checkRow}>
          <input type="radio" name={`${name}-amount`} checked={!all} onChange={() => setAll(false)} />
          Another amount
        </label>
      </fieldset>
      {!all && (
        <label style={{ display: 'grid', gap: '0.3rem' }}>
          <span style={fieldLabel}>{`Amount (up to ${formatMoney(left)})`}</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
        </label>
      )}
      <label style={{ display: 'grid', gap: '0.3rem' }}>
        <span style={fieldLabel}>{reasonRequired ? 'Reason' : 'Reason (optional)'}</span>
        <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={input} />
      </label>
      {tooMuch && <p role="alert" style={errorText}>That is more than is left to refund on this payment.</p>}
      {cents > 0 && !tooMuch && (
        <p style={{ margin: 0, fontWeight: 600 }}>{`Refund ${formatMoney(cents)} to ${payer}? This sends money back to their card.${cancelled ? ' The party stays cancelled.' : ' The party stays booked.'}`}</p>
      )}
      {error && <p role="alert" style={errorText}>{error}</p>}
      {already ? (
        <>
          <p role="status" style={{ margin: 0, fontWeight: 600 }}>{already}</p>
          <div style={row}>
            <button type="button" className="btn btn-primary" disabled={busy || !againOf} style={dim(busy || !againOf)} onClick={() => go(true)}>{busy ? 'Refunding…' : 'Refund again'}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setAlready(''); setAgainOf(null); setError('') }}>Back</button>
          </div>
        </>
      ) : (
        <div style={row}>
          <button type="button" className="btn btn-primary" disabled={!canGo} style={dim(!canGo)} onClick={() => go()}>{busy ? 'Refunding…' : cents > 0 && !tooMuch ? `Refund ${formatMoney(cents)}` : 'Refund'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError('') }}>Back</button>
        </div>
      )}
      {!already && missing && <p data-testid="refund-hint" style={hintText}>{missing}</p>}
    </div>
  )
}
