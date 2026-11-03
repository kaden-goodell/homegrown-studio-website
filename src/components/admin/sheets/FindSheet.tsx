/**
 * Find a booking (final review I5): someone calls, she types their name,
 * email or part of their phone number, and sees their class bookings (with
 * Refund right there, the same panel as on the class), their parties and
 * their places on a waitlist, each with Open.
 */
import { partyDisplayName } from '@lib/parties/party-name'
import { useState, type FormEvent } from 'react'
import type { FindResult, FoundClassBooking } from '@lib/customer-find'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import RefundPanel from '@components/shared/RefundPanel'
import { api } from '../classes/api'
import { moneyWords, nameOf, seatsHeld } from '../classes/labels'
import { dayLabel } from '../classes/dates'
import { telHref } from '../inbox/describe'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { dayAndSpan } from '../shell/time'

export const FIND = '/api/admin/find.json'

export function FindSheet() {
  const { open } = useSheet()
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [r, setR] = useState<FindResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function search(e?: FormEvent) {
    e?.preventDefault()
    const text = q.trim()
    if (text.length < 2) { setError('Type at least two letters of their name, their email, or part of their phone number.'); return }
    setBusy(true)
    setError('')
    const x = await api<FindResult>(`${FIND}?q=${encodeURIComponent(text)}`)
    setBusy(false)
    if (x.ok && x.data) { setR(x.data); setAsked(text) } else setError(x.error ?? '')
  }

  const none = r && !r.classes.length && !r.parties.length && !r.waitlist.length
  const back = { back: { kind: 'more', page: 'find' } as const, label: 'Find a booking' }
  return (
    <SheetFrame tall title="Find a booking" subtitle="Their class bookings, parties and waitlist places">
      <form onSubmit={search} role="search" aria-label="Find a booking">
        <label className="adm-fld">
          <span>Name, email or phone</span>
          <input type="search" value={q} autoCapitalize="off" autoCorrect="off" placeholder="Like: Rivera, or 0100" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" className="adm-btn is-pri adm-gap-top" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {none && <p className="adm-empty" role="status">{`Nothing found for “${asked}”. Try part of their last name, their email, or the last 4 digits of their phone. Bookings made in Square before the switch aren’t here.`}</p>}
      {r && r.classes.length > 0 && (
        <section aria-label="Class bookings">
          <p className="adm-lbl">Class bookings</p>
          {r.classes.map((c) => <FoundBooking key={`${c.classId}-${c.booking.bookingId}`} c={c} onOpen={() => open({ kind: 'class', id: c.classId }, back)} onChanged={() => search()} />)}
        </section>
      )}
      {r && r.parties.length > 0 && (
        <section aria-label="Parties">
          <p className="adm-lbl">Parties</p>
          {r.parties.map((p) => (
            <article key={p.bookingId} className="adm-bkc" aria-label={partyDisplayName(p)}>
              <div className="adm-bk">
                <div className="adm-rm">
                  <b>{partyDisplayName(p)}</b>
                  <small>{[dayLabel(localDate(p.startIso)), p.hostName, `${p.guestCount} guests`, p.inSquare ? 'Booked in Square' : ''].filter(Boolean).join(' · ')}</small>
                </div>
                {p.status === 'cancelled' && <span className="adm-tag is-grey">Cancelled</span>}
              </div>
              <button type="button" className="adm-btn is-ghost is-sm" onClick={() => open({ kind: 'party', day: localDate(p.startIso), id: p.bookingId }, back)}>Open the party</button>
              <span className="adm-small adm-muted">{' Refunds for a party are on its Payments tab.'}</span>
            </article>
          ))}
        </section>
      )}
      {r && r.waitlist.length > 0 && (
        <section aria-label="Waitlist">
          <p className="adm-lbl">On a waitlist</p>
          {r.waitlist.map((w) => (
            <article key={`${w.classId}-${w.name}`} className="adm-bkc" aria-label={`${w.name} waiting`}>
              <div className="adm-rm">
                <b>{`${w.name} · ${w.className}`}</b>
                <small>{`${dayLabel(localDate(w.startIso))} · waiting for ${w.seats} ${w.seats === 1 ? 'seat' : 'seats'}`}</small>
              </div>
              <button type="button" className="adm-btn is-ghost is-sm" onClick={() => open({ kind: 'class', id: w.classId }, back)}>Open the class</button>
            </article>
          ))}
        </section>
      )}
      {r?.more && <p className="adm-small adm-muted">There are more. Type more of the name, or the email, to narrow it down.</p>}
    </SheetFrame>
  )
}

function FoundBooking({ c, onOpen, onChanged }: { c: FoundClassBooking; onOpen: () => void; onChanged: () => void }) {
  const b = c.booking
  const ticket = (id: string) => c.ticketTypes.find((t) => t.id === id)?.label ?? id
  const seats = seatsHeld(b)
  return (
    <article className={`adm-bkc${b.state !== 'held' && b.seatsComing === 0 ? ' is-gone' : ''}`} aria-label={`${nameOf(b)}, ${c.className}`}>
      <div className="adm-bk">
        <div className="adm-rm">
          <b>{`${nameOf(b)} · ${c.className}`}</b>
          <small>{[dayAndSpan(c.startIso, c.endIso), `${seats} ${seats === 1 ? 'seat' : 'seats'}`, moneyWords(b), b.refundedCents ? `refunded ${formatMoney(b.refundedCents)}` : ''].filter(Boolean).join(' · ')}</small>
        </div>
        {c.status === 'cancelled' && <span className="adm-tag is-red">Class cancelled</span>}
      </div>
      {b.customer && (b.customer.phone || b.customer.email) && (
        <p className="adm-small adm-links">
          {b.customer.phone && <a href={telHref(b.customer.phone)}>{b.customer.phone}</a>}
          {b.customer.email && <a href={`mailto:${b.customer.email}`}>{b.customer.email}</a>}
        </p>
      )}
      <button type="button" className="adm-btn is-ghost is-sm" onClick={onOpen}>Open the class</button>
      {b.state !== 'held' && <RefundPanel classId={c.classId} booking={b} ticketLabel={ticket} waiting={b.waiting} counterSalesAtRegister send={(url, body) => api(url, body)} onDone={onChanged} />}
    </article>
  )
}
