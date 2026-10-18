import { useEffect, useState } from 'react'
import type { SeatOption } from '@lib/seat-options'
import { btn, field } from '@components/staff/ui'

interface FoundCustomer { id: string; givenName: string; familyName: string; email: string; phone: string }
interface Household { recordId: string; status: 'ok' | 'expired' | 'outdated'; people: { id: string; name: string; adult: boolean }[] }

const last4 = (phone: string) => phone.replace(/\D/g, '').slice(-4)

/**
 * Roster "Comp a seat": one form. The site adds the seat in Square with no
 * charge, records the picks and sends the usual confirmation email.
 * If the site's Square sign-in has expired, the sheet falls back to adding
 * them in Square's own screen and then recording it here.
 * Sheet chrome copied from AddFamilySheet.
 *
 * "Find a customer" (Kaden, 18 Oct 2026) picks a known Square customer; if
 * they have a waiver in date, the Seats box becomes "Who's coming" — one seat
 * per person checked, plus anyone not on the waiver by name.
 */
export default function CompSeatSheet({
  event,
  options,
  onRecorded,
  onClose,
  mode = 'comp',
  priceCents,
}: {
  event: { id: string; title: string; day: string }
  /** 'sell': same add, but the money is taken at the register ("Sell a seat"). */
  mode?: 'comp' | 'sell'
  /** Price of one seat, for the "take $X at the register" line. */
  priceCents?: number
  options: SeatOption[]
  onRecorded: () => void
  onClose: () => void
}) {
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // The field keeps what's typed (so it can be cleared and retyped); the count
  // used everywhere else is clamped to 1–10.
  const [seatsText, setSeatsText] = useState('1')
  const seats = Math.min(10, Math.max(1, Math.floor(Number(seatsText)) || 1))
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | { warning: string | null; byHand: boolean; dueCents: number | null; name: string }>(null)
  const sell = mode === 'sell'
  const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
  const [signedOut, setSignedOut] = useState(false)

  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundCustomer[]>([])
  const [picked, setPicked] = useState<null | { customer: FoundCustomer; household: Household | null }>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [guests, setGuests] = useState<string[]>([])

  useEffect(() => {
    if (picked || query.trim().length < 2) { setFound([]); return }
    const q = query.trim()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/staff/customers.json?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        setFound(res.ok && Array.isArray(body?.data) ? body.data : [])
      } catch {
        setFound([])
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, picked])

  async function pick(c: FoundCustomer) {
    setError(null)
    try {
      const res = await fetch(`/api/staff/customers.json?id=${encodeURIComponent(c.id)}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof body?.error === 'string' ? body.error : 'Couldn’t load that customer.'); return }
      const customer: FoundCustomer = body.data.customer
      setPicked({ customer, household: body.data.household ?? null })
      setGivenName(customer.givenName)
      setFamilyName(customer.familyName)
      setEmail(customer.email)
      setPhone(customer.phone)
      setChosen([])
      setGuests([])
      setSelections({})
    } catch {
      setError('Could not reach the server. Try again.')
    }
  }

  function notThem() {
    setPicked(null)
    setQuery('')
    setGivenName(''); setFamilyName(''); setEmail(''); setPhone('')
    setChosen([]); setGuests([]); setSelections({})
  }

  // "Who's coming" replaces the Seats box when the picked customer's waiver is in date.
  const household = picked?.household?.status === 'ok' ? picked.household : null
  const chosenInOrder = household ? household.people.filter((p) => chosen.includes(p.id)) : []
  const guestNames = guests.map((g) => g.trim())
  // One token per seat, so a pick stays with its person when others are ticked or unticked.
  const seatTokens = household
    ? [...chosenInOrder.map((p) => ({ token: p.id, name: p.name })), ...guestNames.map((g, i) => ({ token: `guest:${i}`, name: g || `Guest ${i + 1}` }))]
    : Array.from({ length: seats }, (_, i) => ({ token: `seat:${i + 1}`, name: `Seat ${i + 1}` }))
  const seatCount = seatTokens.length

  const key = (token: string, optionId: string) => `${token}|${optionId}`
  const squareUrl = `https://app.squareup.com/dashboard/appointments/calendar/classes/${event.id}?date=${event.day}&view=week`

  async function submit(e: React.FormEvent, alreadyInSquare = signedOut) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    if (household && seatCount === 0) { setError('Pick who’s coming.'); setBusy(false); return }
    if (household && guestNames.some((g) => !g)) { setError('Add a name for everyone not on the waiver, or remove the empty line.'); setBusy(false); return }
    const picks = seatTokens.flatMap((t, i) =>
      options.map((o) => ({ seat: i + 1, optionId: o.id, choice: selections[key(t.token, o.id)] ?? '' })),
    )
    try {
      const res = await fetch('/api/staff/comp-seat.json', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: event.id,
          givenName: givenName.trim(),
          familyName: familyName.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          seats: seatCount,
          picks,
          ...(picked ? { customerId: picked.customer.id } : {}),
          ...(household ? { waiverId: household.recordId, people: chosenInOrder.map((p) => p.id), guests: guestNames } : {}),
          ...(alreadyInSquare ? { alreadyInSquare: true } : {}),
          ...(sell ? { payAtRegister: true } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setDone({
          warning: typeof body?.data?.warning === 'string' ? body.data.warning : null,
          byHand: alreadyInSquare,
          dueCents: typeof body?.data?.dueCents === 'number' ? body.data.dueCents : null,
          name: `${givenName.trim()} ${familyName.trim()}`,
        })
        onRecorded()
      } else if (body?.code === 'square_signed_out') {
        setSignedOut(true)
        setError(body.error)
      } else {
        setError(typeof body?.error === 'string' && body.error ? body.error : 'Could not record that seat.')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = { display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.2rem' } as const
  const input = { ...field, width: '100%', boxSizing: 'border-box' } as const
  const row = { marginBottom: '0.65rem' } as const

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={sell ? 'Sell a seat' : 'Comp a seat'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div
        style={{
          width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto',
          padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>{sell ? 'Sell a seat' : 'Comp a seat'}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          {sell
            ? <>A seat in <strong>{event.title}</strong>{priceCents ? ` (${money(priceCents)} each)` : ''}, paid at the register. We add them in Square and send the confirmation email, then you take the payment.</>
            : <>A free seat in <strong>{event.title}</strong>. We add them in Square with no charge and send the usual confirmation email.</>}
        </p>
        {signedOut && !done && (
          <div style={{ margin: '0 0 1.1rem', padding: '0.75rem', borderRadius: '0.6rem', background: 'rgba(245, 158, 11, 0.12)' }}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
              Add them in Square first, then tap “I added them in Square”.
            </p>
            <a href={squareUrl} target="_blank" rel="noopener" style={{ ...btn(true), textDecoration: 'none', display: 'inline-block' }}>
              Open this class in Square
            </a>
            <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
              <li>Add attendee</li>
              <li>Pick or create the person</li>
              <li>Add to class, then {sell ? 'Take payment' : 'Skip payment'}</li>
            </ol>
          </div>
        )}
        {done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p role="status" style={{ margin: 0, fontWeight: 700, color: 'rgb(21,128,61)' }}>
              {done.byHand ? 'Recorded.' : sell ? 'Added in Square.' : 'Added in Square, no charge.'} They’ll get the usual confirmation email.
            </p>
            {sell && !done.byHand && (
              <div data-testid="take-payment" style={{ margin: '0.9rem 0 0', padding: '0.8rem', borderRadius: '0.6rem', background: 'rgba(245, 158, 11, 0.14)', textAlign: 'left' }}>
                <p style={{ margin: '0 0 0.35rem', fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-dark)' }}>
                  Now take {done.dueCents !== null ? money(done.dueCents) : 'the payment'} at the register
                </p>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-dark)' }}>
                  In Square, open {event.title}, tap {done.name}, then Take payment.
                </p>
              </div>
            )}
            {done.warning && <p role="alert" style={{ margin: '0.6rem 0 0', color: '#b45309', fontSize: '0.875rem', fontWeight: 600 }}>{done.warning}</p>}
            <button type="button" onClick={onClose} style={{ ...btn(true), marginTop: '1.2rem', padding: '0.7rem 2rem', minHeight: '2.75rem' }}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {!picked && (
              <div style={row}>
                <label htmlFor="comp-find" style={label}>Find a customer</label>
                <input id="comp-find" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email or phone" style={input} autoComplete="off" />
                {found.length > 0 && (
                  <ul aria-label="Matching customers" style={{ listStyle: 'none', margin: '0.35rem 0 0', padding: 0, display: 'grid', gap: '0.3rem' }}>
                    {found.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => pick(c)} style={{ ...btn(), width: '100%', textAlign: 'left', fontWeight: 400 }}>
                          <strong>{c.givenName} {c.familyName}</strong>
                          <span style={{ color: 'var(--color-muted)' }}>{[c.email, c.phone ? `••${last4(c.phone)}` : ''].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Or type someone new below.</p>
              </div>
            )}

            {picked ? (
              <div data-testid="picked-customer" style={{ ...row, padding: '0.7rem 0.8rem', borderRadius: '0.6rem', background: 'rgba(var(--color-primary-rgb), 0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
                  <strong style={{ color: 'var(--color-dark)' }}>{picked.customer.givenName} {picked.customer.familyName}</strong>
                  <button type="button" onClick={notThem} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }}>Not them</button>
                </div>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                  {[picked.customer.email, picked.customer.phone ? `••${last4(picked.customer.phone)}` : ''].filter(Boolean).join(' · ') || 'No email or phone in Square'}
                </p>
                {!picked.customer.email && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <label htmlFor="comp-email" style={label}>Email</label>
                    <input id="comp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoComplete="off" />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={row}>
                  <label htmlFor="comp-given" style={label}>First name</label>
                  <input id="comp-given" required value={givenName} onChange={(e) => setGivenName(e.target.value)} style={input} autoComplete="off" />
                </div>
                <div style={row}>
                  <label htmlFor="comp-family" style={label}>Last name</label>
                  <input id="comp-family" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} style={input} autoComplete="off" />
                </div>
                <div style={row}>
                  <label htmlFor="comp-email" style={label}>Email</label>
                  <input id="comp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoComplete="off" />
                </div>
                <div style={row}>
                  <label htmlFor="comp-phone" style={label}>Phone (optional)</label>
                  <input id="comp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={input} autoComplete="off" />
                </div>
              </>
            )}

            {household ? (
              <fieldset style={{ ...row, border: 'none', padding: 0, margin: '0 0 0.65rem' }}>
                <legend style={label}>Who’s coming</legend>
                {household.people.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.95rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(p.id)}
                      onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                    />
                    {p.name}{p.adult ? ' (adult)' : ''}
                  </label>
                ))}
                {guests.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
                    <input
                      aria-label={`Name of guest ${i + 1}`}
                      value={g}
                      onChange={(e) => { const v = e.target.value; setGuests((list) => list.map((x, j) => (j === i ? v : x))) }}
                      placeholder="Their name"
                      style={input}
                      autoComplete="off"
                    />
                    <button type="button" aria-label={`Remove guest ${i + 1}`} onClick={() => setGuests((list) => list.filter((_, j) => j !== i))} style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
                  </div>
                ))}
                {seatCount < 10 && (
                  <button type="button" onClick={() => setGuests((list) => [...list, ''])} style={{ border: 'none', background: 'none', padding: '0.4rem 0 0', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }}>
                    + Add someone not on the waiver
                  </button>
                )}
                {guests.length > 0 && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>They’ll sign the waiver at the door.</p>
                )}
              </fieldset>
            ) : (
              <>
                {picked && (
                  <p style={{ margin: '0 0 0.65rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                    {picked.household ? 'Their waiver is out of date, so they’ll sign again at the door.' : 'No waiver on file yet, so they’ll sign at the door.'}
                  </p>
                )}
                <div style={row}>
                  <label htmlFor="comp-seats" style={label}>Seats</label>
                  <input
                    id="comp-seats" type="number" min={1} max={10} value={seatsText}
                    onChange={(e) => setSeatsText(e.target.value)}
                    onBlur={() => setSeatsText(String(seats))}
                    style={{ ...input, width: '6rem' }}
                  />
                </div>
              </>
            )}

            {options.length > 0 && seatTokens.map((t) =>
              options.map((o) => {
                const k = key(t.token, o.id)
                const id = `comp-pick-${t.token.replace(':', '-')}-${o.id}`
                return (
                  <div key={k} style={row}>
                    <label htmlFor={id} style={label}>{t.name} · {o.label}</label>
                    <select
                      id={id}
                      value={selections[k] ?? ''}
                      onChange={(e) => { const v = e.target.value; setSelections((s) => ({ ...s, [k]: v })) }}
                      style={input}
                    >
                      <option value="" disabled>Choose…</option>
                      {o.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )
              }),
            )}

            {error && <p role="alert" style={{ margin: '0 0 0.6rem', color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600 }}>{error}</p>}
            <button type="submit" disabled={busy} style={{ ...btn(true), padding: '0.7rem 1.4rem', minHeight: '2.75rem', opacity: busy ? 0.6 : 1 }}>
              {busy ? (signedOut ? 'Recording…' : 'Adding…') : signedOut ? 'I added them in Square' : sell ? 'Add seat, pay at register' : 'Add comped seat'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
