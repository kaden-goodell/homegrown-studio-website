/**
 * One of our classes in one sheet: Bookings · Details · Dates (direction D).
 * Bookings: who's coming, refunds (the shared RefundPanel), Print list and
 * Text everyone. Details: the class's words, photo and prices; Save offers
 * "This class and the library" only when the details differ from the
 * library's. Dates: the one date picker, the status, and a move that asks
 * before it touches anyone's booking. Cancel lists who's booked first and
 * never refunds; "Refund everyone" is its own step with its own confirm.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClassBooking, PersonToTell } from '@lib/classes/admin-actions'
import { contentChanges, sameDetails } from '@lib/classes/content-diff'
import type { ClassContent, ClassStatus, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import RefundPanel, { ADMIN_REFUND } from '@components/shared/RefundPanel'
import { api, BOOKINGS, CLASSES, LIBRARY } from '../classes/api'
import { build, fieldOf, fixLine, toForm, type Errors, type Form } from '../classes/class-form'
import { DetailsFields, focusFirstError, PreviewButton } from '../classes/ClassDetails'
import DateRows, { checkRows, rowsOf, sameRows, type DateRow } from '../classes/DateRows'
import { dayLabel } from '../classes/dates'
import { isPast, latestOf, nameOf, nextSession, priceOf, seatsHeld, SOURCE, STATUS_TAG } from '../classes/labels'
import { useRefresh } from '../shell/data'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { dayAndSpan, timeSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { smsHref, telHref } from '../inbox/describe'

export type ClassTab = 'bookings' | 'details' | 'dates'
const TABS: [ClassTab, string][] = [['bookings', 'Bookings'], ['details', 'Details'], ['dates', 'Dates']]
export const STALE_KEPT = 'Someone else changed this class. Your edits are kept; check them and save again.'
const STATUS_NOTE: Record<Exclude<ClassStatus, 'cancelled'>, string> = {
  open: 'On the website. People can book.',
  draft: 'Saved, but not on the website yet. Only you see it.',
  closed: 'On the website, with sign-ups closed.',
}

interface Loaded { cls: ScheduledClass; bookings: ClassBooking[]; seatsTaken: Record<string, number> }

/** Several numbers in one text: iOS Messages opens a group with /open?addresses=. */
function smsAll(phones: string[]): string {
  const digits = phones.map((p) => p.replace(/[^\d+]/g, ''))
  return digits.length === 1 ? smsHref(phones[0]) : `sms:/open?addresses=${digits.join(',')}`
}

function newAttempt(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export function ClassSheet({ id, tab: firstTab = 'bookings' }: { id: string; tab?: ClassTab }) {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<ClassTab>(firstTab)
  const [library, setLibrary] = useState<ClassContent | null>(null)
  const body = useRef<HTMLDivElement>(null)

  // Details
  const [f, setF] = useState<Form | null>(null)
  const [base, setBase] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [staleNote, setStaleNote] = useState('')
  const [saving, setSaving] = useState(false)
  // Dates
  const [rows, setRows] = useState<DateRow[]>([])
  const [baseRows, setBaseRows] = useState<DateRow[]>([])
  const [status, setStatus] = useState<ClassStatus>('open')
  const [datesError, setDatesError] = useState('')
  const [toTell, setToTell] = useState<PersonToTell[] | null>(null)
  const [moved, setMoved] = useState<PersonToTell[] | null>(null)
  // Cancel and Refund everyone
  const [asking, setAsking] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [refundAll, setRefundAll] = useState<'idle' | 'confirm' | 'running'>('idle')
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const attempts = useRef<Record<string, string>>({})
  const [texting, setTexting] = useState(false)

  const detailsDirty = !!f && !!base && JSON.stringify(f) !== JSON.stringify(base)
  const datesDirty = !!data && (!sameRows(rows, baseRows) || status !== data.cls.status)
  useSheetDirty(detailsDirty || datesDirty)

  function fill(cls: ScheduledClass, which: { details?: boolean; dates?: boolean } = { details: true, dates: true }) {
    if (which.details) { const form = toForm(cls.content); setF(form); setBase(form) }
    if (which.dates) { const r = rowsOf(cls.sessions); setRows(r); setBaseRows(r); setStatus(cls.status) }
  }

  async function load(opts: { refill?: boolean } = {}): Promise<Loaded | null> {
    setLoadError('')
    const r = await api<{ class: ScheduledClass; bookings?: ClassBooking[]; seatsTaken?: Record<string, number> }>(`${BOOKINGS}?id=${encodeURIComponent(id)}`)
    if (!r.ok || !r.data) { if (!data) setLoadError(r.error ?? ''); else toast(r.error ?? DIDNT_SAVE); return null }
    const next: Loaded = { cls: r.data.class, bookings: r.data.bookings ?? [], seatsTaken: r.data.seatsTaken ?? {} }
    setData(next)
    if (!data || opts.refill) fill(next.cls)
    return next
  }
  useEffect(() => { load() }, [id])

  // The linked library version's details, to know whether "This class and the library" means anything.
  const libraryId = data?.cls.libraryId ?? null
  async function loadLibrary() {
    if (!libraryId) { setLibrary(null); return }
    const r = await api<{ library: LibraryClass[] }>(`${LIBRARY}?archived=1`)
    const lib = r.ok ? r.data?.library.find((l) => l.id === libraryId) : undefined
    setLibrary(lib ? latestOf(lib).content : null)
  }
  useEffect(() => { loadLibrary() }, [libraryId])

  if (loadError) return <SheetFrame title="Class"><Failed message={loadError} onRetry={() => load()} /></SheetFrame>
  if (!data || !f) return <SheetFrame title="Class"><Skeleton rows={4} label="Loading the class" /></SheetFrame>

  const { cls, bookings, seatsTaken } = data
  const c = cls.content
  const cancelled = cls.status === 'cancelled'
  const past = isPast(cls)
  const next = nextSession(cls)
  const tag = STATUS_TAG[cls.status]
  const subtitle = (
    <>
      {next ? `${dayLabel(localDate(next.startIso))} · ${timeSpan(next.startIso, next.endIso)}` : ''}{priceOf(c) ? ` · ${priceOf(c)}` : ''}
      {tag && <span className={`adm-tag${cancelled ? ' is-red' : ''}`}>{tag}</span>}
      {past && <span className="adm-tag is-grey">Past</span>}
    </>
  )
  const sessionsForPasses = cls.sessions.map((s) => ({ id: s.id, label: dayAndSpan(s.startIso, s.endIso) }))
  const ticket = (t: string) => c.ticketTypes.find((x) => x.id === t)?.label ?? t

  // ── Details ───────────────────────────────────────────────────────────
  const built = f ? build(f) : null
  const differsFromLibrary = !!library && !!built?.ok && !sameDetails(built.content, library)

  async function saveDetails(alsoLibrary: boolean) {
    if (!f) return
    setStaleNote('')
    const b = build(f)
    if (!b.ok) { setErrors(b.errors); requestAnimationFrame(() => focusFirstError(body.current, b.errors)); return }
    setErrors({})
    setSaving(true)
    const r = await api<{ class: ScheduledClass }>(CLASSES, {
      action: 'update', id: cls.id, expectedUpdatedAt: cls.updatedAt, content: b.content, ...(alsoLibrary ? { alsoUpdateLibrary: true } : {}),
    })
    setSaving(false)
    if (!r.ok || !r.data) {
      if (r.status === 409 && r.extra.stale === true) return keepAfterStale()
      const k = fieldOf(r.extra.field, f)
      const e = { [k]: r.error ?? DIDNT_SAVE } as Errors
      setErrors(e)
      if (k !== 'form') requestAnimationFrame(() => focusFirstError(body.current, e))
      return
    }
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { details: true })
    if (alsoLibrary) loadLibrary()
    bump()
    toast(r.warning ?? (alsoLibrary ? 'Saved. The library has it too.' : 'Saved.'))
  }

  /** Someone else saved first: take their copy as the base, keep what was typed, say what they changed. */
  async function keepAfterStale() {
    const before = cls.content
    const fresh = await load()
    if (!fresh) return
    const theirs = contentChanges(before, fresh.cls.content, { usual: false })
    setBase(toForm(fresh.cls.content))
    setBaseRows(rowsOf(fresh.cls.sessions))
    setStaleNote(`${STALE_KEPT}${theirs.length ? ` They changed: ${theirs.join(', ')}.` : ''}`)
  }

  // ── Dates ─────────────────────────────────────────────────────────────
  async function saveDates(confirmMove = false) {
    setDatesError('')
    setStaleNote('')
    setMoved(null)
    const checked = checkRows(rows)
    if (!checked.ok) { setDatesError(checked.error); return }
    setSaving(true)
    const r = await api<{ class: ScheduledClass; peopleToTell?: PersonToTell[] }>(CLASSES, {
      action: 'update', id: cls.id, expectedUpdatedAt: cls.updatedAt, sessions: checked.sessions, status: status === 'cancelled' ? undefined : status,
      ...(confirmMove ? { confirmMove: true } : {}),
    })
    setSaving(false)
    if (!r.ok || !r.data) {
      if (r.status === 409 && Array.isArray(r.extra.peopleToTell)) { setToTell(r.extra.peopleToTell); return }
      setToTell(null)
      if (r.status === 409 && r.extra.stale === true) return keepAfterStale()
      setDatesError(r.error ?? DIDNT_SAVE)
      return
    }
    setToTell(null)
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { dates: true })
    bump()
    if (confirmMove && r.data.peopleToTell?.length) {
      setMoved(r.data.peopleToTell)
      toast('Moved. Let the people below know.')
    } else toast(r.warning ?? 'Saved. The calendar is updated.')
  }

  // ── Cancel ────────────────────────────────────────────────────────────
  const live = bookings.filter((b) => b.state !== 'refunded' && b.state !== 'held')
  async function doCancel() {
    setSaving(true)
    setCancelError('')
    const r = await api<{ class: ScheduledClass }>(CLASSES, { action: 'cancel', id: cls.id, expectedUpdatedAt: cls.updatedAt })
    setSaving(false)
    if (!r.ok || !r.data) {
      setCancelError(r.status === 409 && r.extra.stale === true ? 'Someone else changed this class. It’s shown as it is now; cancel again if you still want to.' : r.error ?? DIDNT_SAVE)
      if (r.extra.stale === true) load({ refill: true })
      return
    }
    setAsking(false)
    await load({ refill: true })
    bump()
    setTab('bookings')
    toast(r.warning ?? 'Cancelled. Here is who to contact.')
  }

  // ── Refund everyone (after a cancel; never on its own) ────────────────
  const canRefund = (b: ClassBooking) => b.paidHere && b.refundableCents > 0 && !b.waiting && b.state !== 'held'
  const toRefund = bookings.filter(canRefund)
  const notHere = live.filter((b) => !canRefund(b) && (b.paidCents - b.refundedCents) > 0)
  async function runRefunds(list: ClassBooking[]) {
    setRefundAll('running')
    for (const b of list) {
      attempts.current[b.bookingId] ??= newAttempt()
      const r = await api<{ cents: number; emailed: boolean; already?: { message: string } }>(ADMIN_REFUND, {
        classId: cls.id, bookingId: b.bookingId, kind: 'booking', freeSeat: true, reason: 'Class cancelled', attempt: attempts.current[b.bookingId],
      })
      const text = !r.ok || !r.data
        ? `Didn’t go through. ${r.error ?? ''}`.trim()
        : r.data.already ? r.data.already.message : `Refunded ${formatMoney(r.data.cents)}.${r.data.emailed ? ' They’ve been emailed.' : ''}`
      setResults((cur) => ({ ...cur, [b.bookingId]: { ok: !!r.ok, text } }))
    }
    setRefundAll('idle')
    await load()
    bump()
  }
  const failed = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => bookings.find((b) => b.bookingId === k)).filter((b): b is ClassBooking => !!b && canRefund(b))

  // ── Footer per tab ────────────────────────────────────────────────────
  let footer: ReactNode = null
  if (tab === 'bookings') {
    footer = refundAll === 'confirm'
      ? (
        <div className="adm-panel is-warn" role="group" aria-label="Refund everyone?">
          <b>Refund everyone?</b>
          <ul className="adm-plain" aria-label="Refunds to make">
            {toRefund.map((b) => <li key={b.bookingId}>{`${nameOf(b)} · ${formatMoney(b.refundableCents)}`}</li>)}
          </ul>
          <span className="adm-small">Each gets their whole booking back on their card, and their seats are freed.{notHere.length ? ` Not included: ${notHere.map(nameOf).join(', ')} (paid in Square or not paid here).` : ''}</span>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setRefundAll('idle')}>Never mind</button>
            <button type="button" className="adm-btn is-danger" onClick={() => runRefunds(toRefund)}>{`Refund ${toRefund.length} ${toRefund.length === 1 ? 'person' : 'people'}`}</button>
          </div>
        </div>
      )
      : (
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => next && open({ kind: 'print', day: localDate(next.startIso) })}>Print list</button>
          <button type="button" className="adm-btn is-ghost" aria-expanded={texting} onClick={() => setTexting(!texting)}>Text everyone</button>
        </div>
      )
  } else if (tab === 'details' && !cancelled) {
    const line = errors.form || fixLine(errors, 'under Details')
    footer = (
      <div className="adm-stack">
        {line && <p className="adm-footline" role="alert">{line}</p>}
        {detailsDirty && differsFromLibrary
          ? (
            <>
              <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDetails(false)}>Only this class</button>
              <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => saveDetails(true)}>This class and the library</button>
            </>
          )
          : <button type="button" className="adm-btn is-pri" disabled={!detailsDirty || saving} onClick={() => saveDetails(false)}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>
    )
  } else if (tab === 'dates' && !cancelled) {
    footer = toTell
      ? (
        <div className="adm-panel" role="group" aria-label="People are booked on the dates you moved">
          <b>People are booked on the dates you moved</b>
          <PeopleList people={toTell} label="People to tell" />
          <span className="adm-small">Nobody is told for you. Move it, then let them know.</span>
          <div className="adm-stack">
            <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDates(true)}>Move and I’ll tell them</button>
            <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => { setToTell(null); setRows(baseRows) }}>Don’t move</button>
          </div>
        </div>
      )
      : <button type="button" className="adm-btn is-pri" disabled={!datesDirty || saving} onClick={() => saveDates()}>{saving ? 'Saving…' : 'Save dates'}</button>
  }

  const phones = [...new Set(live.map((b) => b.customer?.phone ?? '').filter(Boolean))]
  const totalTaken = bookings.filter((b) => b.state !== 'held').reduce((s, b) => s + b.paidCents - b.refundedCents, 0)

  return (
    <SheetFrame tall title={c.name} subtitle={subtitle} footer={footer}>
      <div ref={body}>
        <Seg label="Show" value={tab} options={TABS} onChange={(t) => { setTab(t); setTexting(false) }} />

        {tab === 'bookings' && (
          <section aria-label="Bookings">
            <div className="adm-sum">
              <div><b>{next ? `${seatsTaken[next.id] ?? 0} of ${next.capacity}` : '0'}</b><small>seats booked{cls.sessions.length > 1 && next ? `, ${dayLabel(localDate(next.startIso))}` : ''}</small></div>
              <div><b>{formatMoney(totalTaken)}</b><small>taken so far</small></div>
            </div>
            {cls.sessions.length > 1 && (
              <ul className="adm-plain adm-perdate" aria-label="Seats on each date">
                {cls.sessions.map((s) => <li key={s.id}><span>{dayAndSpan(s.startIso, s.endIso)}</span><b>{`${seatsTaken[s.id] ?? 0} of ${s.capacity}`}</b></li>)}
              </ul>
            )}
            {texting && (
              <div className="adm-panel" role="group" aria-label="Text everyone">
                {phones.length
                  ? (
                    <>
                      <b>{`Text the ${phones.length} ${phones.length === 1 ? 'person' : 'people'} booked`}</b>
                      <p className="adm-selectable" aria-label="Phone numbers">{phones.join(', ')}</p>
                      <div className="adm-two">
                        <button type="button" className="adm-btn is-ghost" onClick={() => navigator.clipboard?.writeText(phones.join(', ')).then(() => toast('Copied the numbers.'), () => toast('Couldn’t copy. Press and hold the numbers to copy them.'))}>Copy the numbers</button>
                        <a className="adm-btn is-pri" href={smsAll(phones)}>Open Messages</a>
                      </div>
                    </>
                  )
                  : <span>Nobody booked has a phone number on file.</span>}
              </div>
            )}
            {cancelled && (
              <div className="adm-panel is-warn" role="group" aria-label="Who to contact">
                <b>{live.length ? 'Cancelled. Let these people know.' : 'Cancelled. Nobody was booked.'}</b>
                {live.length > 0 && (
                  <>
                    <ul className="adm-plain" aria-label="People to contact">
                      {live.map((b) => (
                        <li key={b.bookingId}>
                          {[nameOf(b), b.customer?.phone, b.customer?.email, `${seatsHeld(b)} ${seatsHeld(b) === 1 ? 'seat' : 'seats'}`, `paid ${formatMoney(b.paidCents)}`].filter(Boolean).join(' · ')}
                        </li>
                      ))}
                    </ul>
                    <span className="adm-small">Nobody has been refunded. Refund each person on their row below, or everyone at once.</span>
                  </>
                )}
                {toRefund.length > 0 && refundAll === 'idle' && (
                  <button type="button" className="adm-btn is-ghost" onClick={() => setRefundAll('confirm')}>Refund everyone…</button>
                )}
                {refundAll === 'running' && <span role="status">Refunding…</span>}
                {Object.keys(results).length > 0 && (
                  <ul className="adm-plain" aria-label="Refund results">
                    {Object.entries(results).map(([k, v]) => {
                      const b = bookings.find((x) => x.bookingId === k)
                      return <li key={k} className={v.ok ? '' : 'adm-error'}>{`${b ? nameOf(b) : k}: ${v.text}`}</li>
                    })}
                  </ul>
                )}
                {failed.length > 0 && refundAll === 'idle' && (
                  <button type="button" className="adm-btn is-ghost" onClick={() => runRefunds(failed)}>Try the ones that didn’t go through</button>
                )}
              </div>
            )}
            {bookings.length === 0 && (
              <p className="adm-empty">
                {cls.status === 'draft' ? 'No bookings yet. It’s a draft, so it isn’t on the website.'
                  : cls.status === 'closed' ? 'No bookings. Sign-ups are closed.'
                    : cancelled ? 'No bookings.' : 'No bookings yet. It’s live on the What’s On page.'}
              </p>
            )}
            {bookings.map((b) => <BookingRow key={b.bookingId} b={b} cls={cls} ticket={ticket} onChanged={() => { load(); bump() }} />)}
          </section>
        )}

        {tab === 'details' && (
          <section aria-label="Details">
            {cancelled && <p className="adm-note">This class is cancelled, so its details can’t change. To run it again, use Run it again on Dates.</p>}
            {staleNote && <p className="adm-panel is-warn" role="alert">{staleNote}</p>}
            <PreviewButton f={f} sessions={cls.sessions} />
            <fieldset className="adm-bare" disabled={cancelled}>
              <DetailsFields f={f} set={(fn) => setF((cur) => (cur ? fn(cur) : cur))} errors={errors} sessions={sessionsForPasses} />
            </fieldset>
            {!cancelled && (
              asking
                ? (
                  <div className="adm-panel is-warn" role="group" aria-label="Cancel the class">
                    <b>{`Cancel ${c.name}?`}</b>
                    {live.length
                      ? (
                        <>
                          <span>{`${live.length === 1 ? 'This person is' : 'These people are'} booked. You’ll contact them; nobody is refunded unless you choose to after.`}</span>
                          <ul className="adm-plain" aria-label="Booked on this class">
                            {live.map((b) => <li key={b.bookingId}>{[nameOf(b), `${seatsHeld(b)} ${seatsHeld(b) === 1 ? 'seat' : 'seats'}`, b.customer?.phone].filter(Boolean).join(' · ')}</li>)}
                          </ul>
                        </>
                      )
                      : <span>Nobody is booked.</span>}
                    <span className="adm-small">It comes off the website and the POS.</span>
                    {cancelError && <p role="alert" className="adm-error">{cancelError}</p>}
                    <div className="adm-two">
                      <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setCancelError('') }}>Keep it</button>
                      <button type="button" className="adm-btn is-danger" disabled={saving} onClick={doCancel}>Cancel class</button>
                    </div>
                  </div>
                )
                : <button type="button" className="adm-btn is-danger adm-cancelbtn" onClick={() => setAsking(true)}>Cancel this class</button>
            )}
          </section>
        )}

        {tab === 'dates' && (
          <section aria-label="Dates">
            {staleNote && <p className="adm-panel is-warn" role="alert">{staleNote}</p>}
            <DateRows rows={rows} onChange={setRows} error={datesError} disabled={cancelled} />
            {!cancelled && (
              <>
                <p className="adm-lbl">Status</p>
                <Seg label="Status" value={status === 'cancelled' ? 'open' : status} options={[['open', 'Open'], ['draft', 'Draft'], ['closed', 'Closed']]} onChange={(s) => setStatus(s as ClassStatus)} />
                <p className="adm-small adm-muted">{STATUS_NOTE[status === 'cancelled' ? 'open' : status]}</p>
              </>
            )}
            {moved && (
              <div className="adm-panel" role="group" aria-label="Moved">
                <b>Moved. Let these people know.</b>
                <PeopleList people={moved} label="People to tell" />
              </div>
            )}
            <button type="button" className="adm-btn is-ghost adm-again" onClick={() => open({ kind: 'again', id: cls.id })}>Run it again on new dates</button>
          </section>
        )}
      </div>
    </SheetFrame>
  )
}

function PeopleList({ people, label }: { people: PersonToTell[]; label: string }) {
  return (
    <ul className="adm-plain" aria-label={label}>
      {people.map((p, i) => (
        <li key={i}>{[p.name || 'No name', p.phone, p.email].filter(Boolean).join(' · ')}{p.sessions.length ? ` (booked ${p.sessions.join(', ')})` : ''}</li>
      ))}
    </ul>
  )
}

/** One booking: who, what they bought, how they paid, then the refund panel. */
function BookingRow({ b, cls, ticket, onChanged }: { b: ClassBooking; cls: ScheduledClass; ticket: (id: string) => string; onChanged: () => void }) {
  const c = cls.content
  const name = nameOf(b)
  const seatCount = Object.values(b.seats).reduce((a, n) => a + n, 0)
  const seats = c.ticketTypes.length > 1
    ? Object.entries(b.seats).map(([t, n]) => `${n} ${ticket(t)}`).join(', ')
    : `${seatCount} ${seatCount === 1 ? 'seat' : 'seats'}`
  const pass = c.passes.length > 1 ? c.passes.find((p) => p.id === b.passId)?.label : ''
  const paid = b.source === 'comp' ? 'comp' : b.paidHere || b.paidCents ? `paid ${formatMoney(b.paidCents)}` : 'not paid yet'
  const tag = b.state === 'refunded' ? 'Refunded' : b.state === 'part refunded' ? 'Part refunded' : b.state === 'held' ? 'Paying now' : ''
  const answers = c.questions.length > 0 && b.picks.some((p) => Object.keys(p.answers).length)
    ? b.picks.map((p) => `Seat ${p.seat} (${ticket(p.ticketTypeId)}) · ${c.questions.map((q) => (p.answers[q.id] ? `${q.label} ${p.answers[q.id]}` : '')).filter(Boolean).join(', ')}`)
    : []
  const extras = Object.entries(b.addOns).map(([a, n]) => `${n} ${c.addOns.find((x) => x.id === a)?.label ?? a}`)
  return (
    <article className={`adm-bkc${b.state === 'refunded' ? ' is-gone' : ''}`} aria-label={name}>
      <div className="adm-bk">
        <div className="adm-rm">
          <b>{name}</b>
          <small>{[seats, pass, paid, SOURCE[b.source] ?? b.source, b.refundedCents ? `refunded ${formatMoney(b.refundedCents)}` : ''].filter(Boolean).join(' · ')}</small>
        </div>
        {tag && <span className={`adm-tag ${b.state === 'held' ? '' : 'is-grey'}`}>{tag}</span>}
      </div>
      {(answers.length > 0 || extras.length > 0) && (
        <ul className="adm-plain adm-small">
          {answers.map((a) => <li key={a}>{a}</li>)}
          {extras.length > 0 && <li>{`Extras: ${extras.join(', ')}`}</li>}
        </ul>
      )}
      {b.customer && (b.customer.phone || b.customer.email) && (
        <p className="adm-small adm-links">
          {b.customer.phone && <a href={telHref(b.customer.phone)}>{b.customer.phone}</a>}
          {b.customer.email && <a href={`mailto:${b.customer.email}`}>{b.customer.email}</a>}
        </p>
      )}
      {b.overCapacity && <p className="adm-small adm-warntext">This seat landed after the class was full. Check the room has space.</p>}
      <div data-refund-slot={b.bookingId}>
        {b.state !== 'held' && <RefundPanel classId={cls.id} booking={b} ticketLabel={ticket} waiting={b.waiting} send={(url, body) => api(url, body)} onDone={onChanged} />}
      </div>
    </article>
  )
}

/** `edit-<id>`: the same sheet, opened on Details. */
export function EditClassSheet({ id }: { id: string }) {
  return <ClassSheet id={id} tab="details" />
}

