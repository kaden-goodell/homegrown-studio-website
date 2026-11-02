/**
 * D2: the customer's "Can't make it?" page (/classes/cancel/<token>). The
 * server sends the booking as it stands (what can be cancelled, for how much)
 * and decides everything again on every press; this island only shows it.
 *   self      pick seats → "Cancel and refund $X" → asked once in the page →
 *             cancelled (or "being finished" when Square didn't answer)
 *   free      the same, nothing to refund
 *   request   the policy (or why it isn't online) + "Send us a note"
 * One press = one attempt token, sent again on a retry, so a double tap, a
 * slow network or two tabs never refund twice.
 */
import { useMemo, useRef, useState } from 'react'
import type { CancelView } from '@lib/classes/self-cancel'
import { newAttemptId } from '@lib/checkout-attempt'
import { formatMoney } from '@lib/money'

const API = '/api/classes/cancel.json'

type Busy = null | 'cancel' | 'note'

export default function CancelBooking({ token, initial }: { token: string; initial: CancelView }) {
  const [view, setView] = useState<CancelView>(initial)
  const pickable = useMemo(() => view.seats.filter((s) => s.canPick), [view])
  const [picked, setPicked] = useState<string[]>(() => (initial.wholeOnly || initial.seats.filter((s) => s.canPick).length === 1 ? initial.seats.filter((s) => s.canPick).map((s) => s.lineId) : []))
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<null | { kind: 'cancelled' | 'cancelling' | 'requested'; cents: number }>(null)
  const [writing, setWriting] = useState(initial.mode === 'request' && initial.state === 'open')
  const [note, setNote] = useState('')
  const attempt = useRef(newAttemptId())

  const total = view.seats.filter((s) => picked.includes(s.lineId)).reduce((n, s) => n + s.cents, 0)
  const free = view.mode === 'free'
  const seatsWord = (n: number) => (n === 1 ? 'seat' : `${n} seats`)

  function take(v: CancelView) {
    setView(v)
    const still = v.seats.filter((s) => s.canPick).map((s) => s.lineId)
    setPicked((cur) => (v.wholeOnly || still.length === 1 ? still : cur.filter((id) => still.includes(id))))
  }

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; code?: string; data?: any; error?: string; view?: CancelView }> {
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, ...body }) })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.data) return { ok: true, status: res.status, data: j.data }
      return { ok: false, status: res.status, code: typeof j?.code === 'string' ? j.code : undefined, error: j?.error ?? 'We couldn’t do that just now. Try again in a minute. You’ll never be refunded twice.', view: j?.view }
    } catch {
      // F4: we can't tell whether the press reached us, so we never say "nothing changed" here.
      return { ok: false, status: 0, error: 'We couldn’t reach the studio’s site. Check your connection and tap the button again. You’ll never be refunded twice.' }
    }
  }

  async function cancel() {
    setBusy('cancel')
    setError('')
    const r = await post({ action: 'cancel', lineIds: picked, attempt: attempt.current })
    setBusy(null)
    setSure(false)
    if (r.ok) {
      take(r.data.view)
      setDone({ kind: r.data.result, cents: r.data.cents })
      attempt.current = newAttemptId()
      return
    }
    if (r.view) take(r.view)
    setError(r.error ?? '')
    // F4: no reply, or the site failed: the same press again (it continues, never a second refund).
    // A refused or changed press is over: the next one is a new press.
    if (!(r.status === 0 || (r.status >= 500 && r.code !== 'square'))) attempt.current = newAttemptId()
  }

  async function send() {
    setBusy('note')
    setError('')
    const r = await post({ action: 'request', note })
    setBusy(null)
    if (r.ok) {
      take(r.data.view)
      setDone({ kind: 'requested', cents: 0 })
      setWriting(false)
      setNote('')
      return
    }
    if (r.view) take(r.view)
    setError(r.error ?? '')
  }

  const heading = view.state === 'cancelled'
    ? 'Your booking is cancelled'
    : view.state === 'cancelling'
      ? 'Your cancel is in'
      : view.state === 'over' ? 'Nothing to cancel here' : 'Can’t make it?'

  return (
    <section aria-labelledby="cancel-heading" style={{ textAlign: 'left' }}>
      <h1 id="cancel-heading" className="text-3xl sm:text-4xl font-heading font-bold" style={{ color: 'var(--color-dark)', textAlign: 'center' }}>{heading}</h1>
      <p className="mt-3 font-semibold" style={{ color: 'var(--color-dark)', textAlign: 'center' }}>{view.className}</p>
      {view.whenLabel && <p style={{ color: 'var(--color-text)', textAlign: 'center' }}>{view.whenLabel}</p>}

      <div role="status" aria-live="polite">
        {done?.kind === 'cancelled' && (
          <p className="mt-5" style={{ color: 'var(--color-dark)' }}>
            {done.cents > 0
              ? `Done. We refunded ${formatMoney(done.cents)} to the card you paid with, and we sent you an email to say so.`
              : 'Done. Your seat is cancelled. This booking was free, so there’s nothing to refund.'}
          </p>
        )}
        {(done?.kind === 'cancelling' || (view.state === 'cancelling' && !done)) && (
          <p className="mt-5" style={{ color: 'var(--color-dark)' }}>
            We’re finishing your refund with our card processor. Your seats stay held until it’s done, and you don’t need to do anything. We’ll email you once the refund goes through.
          </p>
        )}
        {done?.kind === 'requested' && <p className="mt-5" style={{ color: 'var(--color-dark)' }}>Thanks, we got your note. We’ll reply by email or text.</p>}
      </div>

      {view.state === 'cancelled' && !done && (
        <p className="mt-5" style={{ color: 'var(--color-text)' }}>
          {view.refundedCents > 0 ? `${formatMoney(view.refundedCents)} was refunded to the card you paid with.` : 'There’s nothing left on this booking.'}
        </p>
      )}
      {view.state === 'over' && view.why && <p className="mt-5" style={{ color: 'var(--color-text)' }}>{view.why}</p>}

      {(view.mode === 'self' || view.mode === 'free') && pickable.length > 0 && (
        <div className="mt-6">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="font-semibold" style={{ color: 'var(--color-dark)' }}>{view.wholeOnly ? 'Your booking' : 'Which seats can’t make it?'}</legend>
            {view.wholeOnly && <p className="text-sm" style={{ color: 'var(--color-text)' }}>This booking covers more than one date, so all of its seats are cancelled together.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
              {view.seats.map((s) => (
                <li key={s.lineId} style={{ padding: '0.4rem 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: s.canPick ? 'var(--color-dark)' : 'var(--color-text)' }}>
                    <input
                      type="checkbox"
                      checked={picked.includes(s.lineId)}
                      disabled={!s.canPick || view.wholeOnly || !!busy}
                      onChange={(e) => { setSure(false); setPicked((cur) => (e.target.checked ? [...cur, s.lineId] : cur.filter((x) => x !== s.lineId))) }}
                      style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--color-primary)' }}
                    />
                    <span>
                      {`Seat ${s.seat} · ${s.label}`}
                      {s.state === 'cancelled' ? ' · cancelled' : s.state === 'cancelling' ? ' · being cancelled' : !free && s.canPick ? ` · ${formatMoney(s.cents)} back` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {free
            ? <p className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>This booking was free, so there’s nothing to refund. Cancelling gives your seat to someone else.</p>
            : <p className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>{`You’re more than ${view.policyHours} hours out, so you get back everything those seats cost, tax included, on the card you paid with.`}</p>}
          {sure ? (
            <div role="group" aria-label="Cancel for sure?" className="mt-4" style={{ border: '1px solid var(--color-border, #e8e0d8)', borderRadius: '0.75rem', padding: '1rem' }}>
              <p className="font-semibold" style={{ color: 'var(--color-dark)' }}>
                {free ? `Cancel your ${seatsWord(picked.length)}?` : `Cancel your ${seatsWord(picked.length)} and refund ${formatMoney(total)}?`}
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>Once it’s cancelled the seat goes to someone else, so it can’t be undone here.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button type="button" className="btn btn-quiet" style={{ width: 'auto' }} disabled={!!busy} onClick={() => setSure(false)}>Keep my booking</button>
                <button type="button" className="btn btn-primary" style={{ width: 'auto' }} disabled={!!busy} onClick={cancel}>
                  {busy === 'cancel' ? 'Cancelling…' : free ? 'Yes, cancel' : 'Yes, cancel and refund'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-primary mt-4" disabled={!picked.length || !!busy} onClick={() => setSure(true)}>
              {free ? (picked.length > 1 ? `Cancel ${picked.length} seats` : 'Cancel my seat') : picked.length ? `Cancel and refund ${formatMoney(total)}` : 'Pick the seats to cancel'}
            </button>
          )}
        </div>
      )}

      {view.mode === 'request' && view.state !== 'cancelled' && (
        <div className="mt-6">
          {view.why && <p style={{ color: 'var(--color-text)' }}>{view.why}</p>}
          {view.request && !done && (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-text)' }}>{`We got your note${view.request.note ? ` (“${view.request.note}”)` : ''}. We’ll reply by email or text.`}</p>
          )}
        </div>
      )}

      {error && <p className="field-error mt-4" role="alert">{error}</p>}

      {view.state !== 'cancelled' && view.state !== 'over' && (
        writing ? (
          <div className="mt-6">
            <label htmlFor="cancel-note" className="font-semibold" style={{ color: 'var(--color-dark)' }}>Your note</label>
            <textarea
              id="cancel-note"
              value={note}
              maxLength={500}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tell us what happened and what would help, like a credit or another date."
              style={{ display: 'block', width: '100%', marginTop: '0.4rem', padding: '0.6rem', borderRadius: '0.5rem', border: '1px solid var(--color-border, #d9cfc6)' }}
            />
            <button type="button" className="btn btn-primary mt-3" disabled={!!busy || !note.trim()} onClick={send}>{busy === 'note' ? 'Sending…' : 'Send us a note'}</button>
          </div>
        ) : (
          <p className="mt-6 text-sm" style={{ textAlign: 'center' }}>
            <button type="button" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => setWriting(true)}>
              {view.request ? 'Send another note' : view.mode === 'request' ? 'Send us a note' : 'Something else? Send us a note'}
            </button>
          </p>
        )
      )}
    </section>
  )
}
