/**
 * Book a party for someone (`#book-party[-day]`), usually with them on the
 * phone. Top to bottom in the order she asks: the day, a free time, the
 * package (only when there is more than one), the craft, how many guests,
 * extras, the host, then how they pay:
 *
 * - Send payment link: the time is held, the host gets a link by email and
 *   text for the studio fee and extras (never crafts, D1).
 * - Take card now: Square's own card box (cards only, S2-R3); the card number
 *   never touches a field of ours.
 *
 * Prices come from Parties setup and the catalog; the server prices it again.
 * One create key per sheet (R35): tapping Book again after a lost answer finds
 * the first try's party instead of making a second. A card try keeps its
 * attempt id while the outcome is unknown, so a retry never charges twice.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import { newAttemptId } from '@lib/checkout-attempt'
import { formatMoney } from '@lib/money'
import { quoteParty } from '@lib/parties/pricing'
import type { PartyAddOn, PartyPackage } from '@lib/parties/types'
import { partySummary } from '@lib/party-summary'
import { localDate, localToUtcISO } from '@lib/party-slots'
import { studioClock } from '@lib/studio-time'
import { api } from '../classes/api'
import { dayLabel, today } from '../classes/dates'
import { useRefresh } from '../shell/data'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { clock } from '../shell/time'
import { useToast } from '../shell/Toast'
import {
  byStudioDay, newKey, PARTY_BOOK, timesWindow, useCrafts, usePartySettings, usePartyTimes, type AdminParty,
} from './api'

type Pay = 'link' | 'card'
type Field = 'start' | 'craft' | 'guests' | 'firstName' | 'email' | 'phone' | 'card'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CARD_UNREAD = 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.'

/** "2 PM" for a start. */

/** "Another time" (owners, DV3): any day, a start from 8 AM to 8 PM; the server checks the rest. */
export const OWNER_EARLIEST = '08:00'
export const OWNER_LATEST = '20:00'
export const ANOTHER_TIME_HINT = 'Any day, starting between 8 AM and 8 PM. It’s checked against classes, other parties, the café and blocked time when you book.'

export const startClock = (iso: string) => clock(studioClock(iso))

/** What the party sheet shows on top after a booking (the toast goes after 4 seconds). */
export interface PartyNotice { id: string; text: string; warn?: boolean }

export function BookPartySheet({ day }: { day?: string }) {
  const party = usePartySettings()
  const crafts = useCrafts()
  const title = 'Book a party'
  if (party.error && !party.settings) return <SheetFrame title={title}><Failed message={party.error} onRetry={party.retry} /></SheetFrame>
  if (!party.settings) return <SheetFrame title={title}><Skeleton rows={4} label="Loading party times" /></SheetFrame>
  const packages = party.settings.packages.filter((p) => !p.archived)
  const addOns = party.settings.addOns.filter((a) => !a.archived)
  return <BookForm day={day} packages={packages} addOns={addOns} settings={party.settings} crafts={crafts} onPriceChanged={party.retry} />
}

function BookForm({ day: openedOn, packages, addOns, settings, crafts, onPriceChanged }: {
  day?: string
  packages: PartyPackage[]
  addOns: PartyAddOn[]
  settings: NonNullable<ReturnType<typeof usePartySettings>['settings']>
  crafts: ReturnType<typeof useCrafts>
  /** the server's prices differ from the sheet's: load Parties setup again (I1) */
  onPriceChanged: () => void
}) {
  const { open, setDirty } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const firstPkg = packages.find((p) => p.who === 'everyone') ?? packages[0]
  const [day, setDay] = useState(openedOn ?? '')
  const [start, setStart] = useState('')
  const [other, setOther] = useState(false)
  const [otherTime, setOtherTime] = useState('')
  const [pkgId, setPkgId] = useState(firstPkg?.id ?? '')
  const pkg = packages.find((p) => p.id === pkgId) ?? firstPkg
  const [guests, setGuests] = useState(String(pkg?.defaultGuests ?? 10))
  const [craftId, setCraftId] = useState('')
  const [extras, setExtras] = useState<Record<string, number>>({})
  const [host, setHost] = useState({ firstName: '', lastName: '', phone: '', email: '' })
  const [pay, setPay] = useState<Pay>('link')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [refusal, setRefusal] = useState('')
  const [busy, setBusy] = useState(false)
  const [cardReady, setCardReady] = useState(false)
  const createKey = useRef(newKey())
  const attemptId = useRef(newAttemptId())
  const cardRef = useRef<PaymentFormRef>(null)
  const formRef = useRef<HTMLDivElement>(null)
  // After a refusal: focus the first part marked, so she isn't left hunting on a tall sheet (m6).
  const [focusSeq, setFocusSeq] = useState(0)
  useEffect(() => {
    if (!focusSeq) return
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    el?.focus()
    el?.scrollIntoView?.({ block: 'center' })
  }, [focusSeq])

  const touched = day !== (openedOn ?? '') || !!start || !!otherTime || craftId !== '' || Object.values(extras).some((n) => n > 0)
    || Object.values(host).some((v) => v.trim() !== '') || guests !== String(pkg?.defaultGuests ?? 10)
  useSheetDirty(touched)

  const chosenExtras = Object.fromEntries(Object.entries(extras).filter(([, n]) => n > 0))
  const extraKey = JSON.stringify(chosenExtras)
  const want = { packageId: pkg?.id, addOns: chosenExtras }
  const dayTimes = usePartyTimes(day ? { from: day, to: day, ...want } : null)
  const upcoming = usePartyTimes({ ...timesWindow(), ...want })

  // A different package or extra time changes which times fit: a picked time that no longer does is dropped.
  useEffect(() => {
    if (!other && start && dayTimes.times && !dayTimes.times.open.includes(start)) setStart('')
  }, [dayTimes.times, other])
  useEffect(() => { setErrors((e) => ({ ...e, start: undefined })) }, [pkgId, extraKey])

  const guestN = Number(guests)
  const guestsOk = Number.isInteger(guestN) && !!pkg && guestN >= pkg.minGuests && guestN <= pkg.maxGuests
  const craft = crafts.crafts?.find((c) => c.id === craftId) ?? null
  const startIso = other ? (day && /^\d{2}:\d{2}$/.test(otherTime) ? localToUtcISO(day, otherTime) : '') : start
  const quote = useMemo(() => {
    const q = quoteParty(settings, { packageId: pkg?.id, guests: guestsOk ? guestN : (pkg?.minGuests ?? 1), addOns: chosenExtras }, 'admin')
    return q.ok ? q.value : null
  }, [settings, pkg?.id, guestN, guestsOk, extraKey])
  const nowCents = quote?.totalCents ?? pkg?.priceCents ?? 0
  const crafts$ = partySummary({ craft, guests: guestsOk ? guestN : 0, pkg: { priceCents: pkg?.priceCents ?? 0, minGuests: pkg?.minGuests ?? 1 } }).atStudio[0]
  const hasExtras = (quote?.items ?? []).some((it) => it.kind === 'addon' && it.cents > 0)
  const forWhat = hasExtras ? 'the studio fee and extras' : 'the studio fee'
  const hostFirst = host.firstName.trim() || 'the host'

  function check(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {}
    if (!startIso) e.start = other ? 'Pick the day and type a start time.' : 'Pick a day and a free time.'
    if (!craftId) e.craft = 'Pick a craft.'
    if (!guestsOk && pkg) e.guests = `Parties are for ${pkg.minGuests} to ${pkg.maxGuests} guests.`
    if (!host.firstName.trim()) e.firstName = 'Add the host’s name.'
    if (host.phone.replace(/\D/g, '').length < 10) e.phone = 'Add a phone number with the area code.'
    if (!EMAIL_RE.test(host.email.trim())) e.email = 'Check the email address.'
    return e
  }

  async function book() {
    if (busy) return
    setRefusal('')
    const e = check()
    setErrors(e)
    if (Object.keys(e).length) { setFocusSeq((n) => n + 1); return }
    setBusy(true)
    let token = ''
    if (pay === 'card') {
      try {
        token = (await cardRef.current!.tokenize()).token
      } catch {
        setBusy(false)
        setErrors({ card: CARD_UNREAD })
        return
      }
    }
    const body = {
      createKey: createKey.current,
      startIso,
      packageId: pkg?.id,
      guests: guestN,
      craftId,
      addOns: chosenExtras,
      // What the button and the summary said (I1): a different saved price is refused, nothing charged.
      expectedCents: nowCents,
      host: { firstName: host.firstName.trim(), lastName: host.lastName.trim(), phone: host.phone.trim(), email: host.email.trim() },
      pay: pay === 'link' ? { kind: 'link' } : { kind: 'card', attemptId: attemptId.current, paymentToken: token },
    }
    const r = await api<{ party: AdminParty; message: string }>(PARTY_BOOK, body)
    setBusy(false)
    if (r.ok && r.data) {
      bump()
      const p = r.data.party
      // A reply to an earlier tap that got lost (same key): that booking stands, at its own time (m7).
      const replayElsewhere = (r.data as { replay?: boolean }).replay && Date.parse(p.startIso) !== Date.parse(startIso)
      const text = replayElsewhere
        ? `This party was already booked from your first tap, for ${dayLabel(localDate(p.startIso))} at ${startClock(p.startIso)}. Nothing new was booked or sent. Use Move if it should be at another time.`
        : r.warning ?? r.data.message
      toast(text)
      // Booked: nothing is left unsaved, so the party opens without "Leave without saving?".
      setDirty(false)
      open({ kind: 'party', day: localDate(p.startIso), id: p.bookingId }, { notice: { id: p.bookingId, text, warn: !!r.warning || !!replayElsewhere } satisfies PartyNotice })
      return
    }
    // A plain answer ends this card try; "not sure yet" and "still going through" keep it, so a retry is recognised.
    const unsure = r.status === 0 || r.extra.code === 'unknown_outcome' || r.extra.code === 'in_progress'
    if (pay === 'card' && !unsure) attemptId.current = newAttemptId()
    // A plain refusal booked nothing: the next tap is a new booking, with whatever she changes (m7).
    if (pay === 'link' && !unsure) createKey.current = newKey()
    if (r.extra.why === 'price_changed') {
      setRefusal(r.error ?? 'The price changed. Nothing was charged or booked.')
      onPriceChanged()
      return
    }
    const msg = r.error ?? 'That didn’t book. Try again.'
    const field = String(r.extra.field ?? '')
    const at: Field | null = field === 'startIso' ? 'start' : field === 'craftId' ? 'craft' : field === 'guests' ? 'guests'
      : field === 'host.firstName' ? 'firstName' : field === 'host.email' ? 'email' : field === 'host.phone' ? 'phone' : field === 'pay' ? 'card' : null
    if (at) { setErrors({ [at]: msg }); setFocusSeq((n) => n + 1) }
    setRefusal(msg)
    // Someone else may have just taken the time: show the times as they are now.
    if (at === 'start' || r.status === 409) { dayTimes.retry(); upcoming.retry() }
  }

  // One alert (the footer line); the field lines are plain text next to their field, and focus goes to the first (m6).
  const fieldErr = (f: Field) => errors[f] ? <p className="adm-error adm-fielderr">{errors[f]}</p> : null
  const label = pay === 'link' ? 'Book and send link' : `Charge ${formatMoney(nowCents)} and book`
  const footer = (
    <div className="adm-stack">
      {(refusal || Object.keys(errors).some((k) => errors[k as Field])) && (
        <p className="adm-footline" role="alert">{refusal || 'Check the parts marked above.'}</p>
      )}
      <button type="button" className="adm-btn is-pri" disabled={busy || (pay === 'card' && !cardReady)} onClick={book}>
        {busy ? (pay === 'card' ? 'Charging…' : 'Booking…') : label}
      </button>
    </div>
  )

  const dayOffered = dayTimes.times?.offered ?? []
  const dayOpen = dayTimes.times?.open ?? []
  const next = (upcoming.times?.open ?? []).filter((s) => localDate(s) !== day).slice(0, 8)
  const showNext = !day || (dayTimes.times && !dayOpen.length)

  return (
    <SheetFrame tall title="Book a party" subtitle={openedOn ? `On ${dayLabel(openedOn)}` : `${pkg?.name ?? 'Party'} · ${formatMoney(pkg?.priceCents ?? 0)} + crafts`} footer={footer}>
      <div ref={formRef}>
      <p className="adm-lbl adm-lbl-first">Day and time</p>
      <label className="adm-fld">
        <span>Day</span>
        <input type="date" min={today()} value={day} aria-invalid={!!errors.start || undefined} onChange={(e) => { setDay(e.target.value); setStart(''); setErrors((x) => ({ ...x, start: undefined })) }} />
      </label>
      {day && !other && (
        dayTimes.error ? <Failed message={dayTimes.error} onRetry={dayTimes.retry} />
          : !dayTimes.times ? <Skeleton rows={1} label="Loading the free times" />
            : dayOffered.length === 0
              ? <p className="adm-note">{`No party times on ${dayLabel(day)}. Pick another day, a time below, or Another time.`}</p>
              : (
                <div className="adm-times" role="group" aria-label={`Party times on ${dayLabel(day)}`}>
                  {dayOffered.map((s) => {
                    const free = dayOpen.includes(s)
                    return (
                      <button key={s} type="button" className="adm-time" aria-pressed={start === s} disabled={!free} aria-label={free ? undefined : `${startClock(s)}, taken`} onClick={() => { setStart(s); setErrors((x) => ({ ...x, start: undefined })) }}>
                        {startClock(s)}{!free && <small>Taken</small>}
                      </button>
                    )
                  })}
                </div>
              )
      )}
      {day && (other
        ? (
          <div className="adm-panel adm-gap-bottom">
            <label className="adm-fld" style={{ margin: 0 }}>
              <span>{`Start time on ${dayLabel(day)}`}</span>
              <input type="time" value={otherTime} step={900} min={OWNER_EARLIEST} max={OWNER_LATEST} onChange={(e) => { setOtherTime(e.target.value); setErrors((x) => ({ ...x, start: undefined })) }} />
            </label>
            <span className="adm-small">{ANOTHER_TIME_HINT}</span>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setOther(false); setOtherTime('') }}>Back to the party times</button>
          </div>
        )
        : <button type="button" className="adm-quiet" onClick={() => { setOther(true); setStart('') }}>Another time on this day</button>)}
      {fieldErr('start')}
      {showNext && (
        <>
          <p className="adm-small adm-muted adm-gap-top">{day ? 'Next free party times' : 'Pick a day, or one of the next free party times'}</p>
          {upcoming.error ? <Failed message={upcoming.error} onRetry={upcoming.retry} />
            : !upcoming.times ? <Skeleton rows={1} label="Loading the next free times" />
              : next.length === 0 ? <p className="adm-small adm-muted">No free party times in the next eight weeks.</p>
                : (
                  <div className="adm-times" role="group" aria-label="Next free party times">
                    {byStudioDay(next).flatMap(([d, list]) => list.map((s) => (
                      <button key={s} type="button" className="adm-time is-wide" aria-pressed={start === s} onClick={() => { setDay(d); setOther(false); setStart(s); setErrors((x) => ({ ...x, start: undefined })) }}>
                        {`${dayLabel(d)} · ${startClock(s)}`}
                      </button>
                    )))}
                  </div>
                )}
        </>
      )}

      {packages.length > 1 && (
        <>
          <p className="adm-lbl">Package</p>
          <Seg label="Package" value={pkgId} className="is-wrap" onChange={(id) => {
            setPkgId(id)
            const p = packages.find((x) => x.id === id)
            // Still the old package's usual number: use the new one's.
            if (p && guests === String(pkg?.defaultGuests)) setGuests(String(p.defaultGuests))
          }} options={packages.map((p) => [p.id, `${p.name} · ${formatMoney(p.priceCents)}`] as [string, string])} />
        </>
      )}

      <p className="adm-lbl">Party</p>
      {crafts.error ? <Failed message={crafts.error} onRetry={crafts.retry} />
        : !crafts.crafts ? <Skeleton rows={1} label="Loading the party crafts" />
          : (
            <label className="adm-fld">
              <span>Craft</span>
              <select value={craftId} aria-invalid={!!errors.craft || undefined} onChange={(e) => { setCraftId(e.target.value); setErrors((x) => ({ ...x, craft: undefined })) }}>
                <option value="">Pick a craft</option>
                {crafts.crafts.map((c) => (
                  <option key={c.id} value={c.id}>{`${c.name} · ${c.perHeadMaxCents > c.perHeadCents ? `${formatMoney(c.perHeadCents)}–${formatMoney(c.perHeadMaxCents)}` : formatMoney(c.perHeadCents)} a guest`}</option>
                ))}
              </select>
            </label>
          )}
      {fieldErr('craft')}
      <label className="adm-fld">
        <span>{`Guests (${pkg?.minGuests ?? 1}–${pkg?.maxGuests ?? 60})`}</span>
        <input type="number" inputMode="numeric" min={pkg?.minGuests} max={pkg?.maxGuests} value={guests} aria-invalid={!!errors.guests || undefined}
          onChange={(e) => { setGuests(e.target.value); setErrors((x) => ({ ...x, guests: undefined })) }}
          onBlur={() => { if (!guestsOk && pkg && guests !== '') setErrors((x) => ({ ...x, guests: `Parties are for ${pkg.minGuests} to ${pkg.maxGuests} guests.` })) }} />
      </label>
      {fieldErr('guests')}
      <p className="adm-small adm-muted" style={{ marginTop: '-0.4rem' }}>An estimate is fine. Crafts are paid at the studio for whoever comes.</p>

      {addOns.length > 0 && (
        <>
          <p className="adm-lbl">Extras</p>
          {addOns.map((a) => <ExtraPick key={a.id} a={a} value={extras[a.id] ?? 0} onChange={(n) => setExtras({ ...extras, [a.id]: n })} />)}
        </>
      )}

      <p className="adm-lbl">Host</p>
      <div className="adm-two">
        <label className="adm-fld"><span>First name</span><input autoComplete="off" value={host.firstName} aria-invalid={!!errors.firstName || undefined} onChange={(e) => { setHost({ ...host, firstName: e.target.value }); setErrors((x) => ({ ...x, firstName: undefined })) }} /></label>
        <label className="adm-fld"><span>Last name</span><input autoComplete="off" value={host.lastName} onChange={(e) => setHost({ ...host, lastName: e.target.value })} /></label>
      </div>
      {fieldErr('firstName')}
      <label className="adm-fld"><span>Phone</span><input type="tel" inputMode="tel" autoComplete="off" value={host.phone} aria-invalid={!!errors.phone || undefined} onChange={(e) => { setHost({ ...host, phone: e.target.value }); setErrors((x) => ({ ...x, phone: undefined })) }} /></label>
      {fieldErr('phone')}
      <label className="adm-fld"><span>Email</span><input type="email" inputMode="email" autoComplete="off" autoCapitalize="off" value={host.email} aria-invalid={!!errors.email || undefined} onChange={(e) => { setHost({ ...host, email: e.target.value }); setErrors((x) => ({ ...x, email: undefined })) }} /></label>
      {fieldErr('email')}

      <section className="adm-panel adm-gap-bottom" aria-label="What they pay">
        <b>Pay now</b>
        {(quote?.items ?? []).map((it) => (
          <div key={it.refId} className="adm-kv adm-kv-tight"><span>{it.kind === 'package' ? (packages.length > 1 ? `${it.label} (studio fee)` : 'Studio fee') : it.qty > 1 ? `${it.label} × ${it.qty}` : it.label}</span><span>{formatMoney(it.cents)}</span></div>
        ))}
        <div className="adm-kv adm-kv-tight is-tot"><span>Pay now</span><span>{formatMoney(nowCents)}</span></div>
        <b>At the studio</b>
        {crafts$
          ? <div className="adm-kv adm-kv-tight"><span>{crafts$.label}<br /><span className="adm-small adm-muted">{crafts$.note}</span></span><span>{crafts$.amount}</span></div>
          : <span className="adm-small">Crafts, for whoever comes. Pick a craft to see an estimate.</span>}
      </section>

      <p className="adm-lbl">How they pay</p>
      <Seg label="How they pay" value={pay} onChange={(p) => { setPay(p); setErrors((x) => ({ ...x, card: undefined })); setRefusal('') }} options={[['link', 'Send payment link'], ['card', 'Take card now']]} />
      {pay === 'link'
        ? <p className="adm-note">{`We email and text ${hostFirst} a link to pay ${formatMoney(nowCents)} for ${forWhat}. The time is held for them, and the party shows Waiting on payment until they pay.`}</p>
        : (
          <>
            <p className="adm-note">{`Type their card into Square’s card box below. ${formatMoney(nowCents)} for ${forWhat} is charged when you book, and ${hostFirst} gets the confirmation email. Crafts are paid at the studio after the party.`}</p>
            <PaymentForm ref={cardRef} giftCards="cards-only" onReadyChange={setCardReady} />
            {!cardReady && <p className="adm-small adm-muted">The card box is loading…</p>}
            {fieldErr('card')}
          </>
        )}
      </div>
    </SheetFrame>
  )
}

/** One extra: a tick box when it's once per party, a count when more are allowed. */
function ExtraPick({ a, value, onChange }: { a: PartyAddOn; value: number; onChange: (n: number) => void }) {
  const price = `${formatMoney(a.priceCents)}${a.per === 'guest' ? ' a guest' : ''}`
  const time = a.extraMinutes ? ` · adds ${a.extraMinutes} minutes` : ''
  if (a.maxQty <= 1) {
    return (
      <label className="adm-check">
        <input type="checkbox" checked={value > 0} onChange={(e) => onChange(e.target.checked ? 1 : 0)} />
        <span>{`${a.label} · ${price}${time}`}</span>
      </label>
    )
  }
  return (
    <label className="adm-fld">
      <span>{`${a.label} · ${price}${time}`}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>None</option>
        {Array.from({ length: a.maxQty }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{a.per === 'guest' ? `${n} for each guest` : String(n)}</option>)}
      </select>
    </label>
  )
}

