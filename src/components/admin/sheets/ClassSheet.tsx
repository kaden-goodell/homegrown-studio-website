/**
 * One of our classes in one sheet: Bookings · Details · Dates · Staff (direction D).
 * Bookings: who's coming, refunds (the shared RefundPanel), Print list and
 * Text everyone. Details: the class's words, photo and prices; Save offers
 * "This class and the library" only when the details differ from the
 * library's. Dates: the one date picker, the status, and a move that asks
 * before it touches anyone's booking. Cancel lists who's booked first and
 * never refunds; "Refund everyone" is its own step with its own confirm.
 * Staff (stage 3): who's on each day, with "every day" for a class that
 * runs on several days; a staffing line opens the sheet here on its day.
 */
import { earlyBirdRunning } from '@lib/classes/early-bird'
import { shortDay } from '@lib/classes/chicago-day'
import { notOnRegister, posPricesStale, registerSetupStale, type RegisterInForce } from '@lib/classes/pos-plan'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BookedPerson, ClassBooking, PersonToTell } from '@lib/classes/admin-actions'
import type { SeriesMember, SeriesSkip } from '@lib/classes/series'
import { contentChanges, sameDetails } from '@lib/classes/content-diff'
import type { ClassContent, ClassStatus, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import RefundPanel, { ADMIN_REFUND } from '@components/shared/RefundPanel'
import WaitlistSection from '../classes/WaitlistSection'
import { api, BOOKINGS, CLASSES, LIBRARY } from '../classes/api'
import { build, fieldOf, fixLine, toForm, type Errors, type Form } from '../classes/class-form'
import { DetailsFields, focusFirstError, PreviewButton } from '../classes/ClassDetails'
import DateRows, { checkRows, rowsOf, sameRows, type DateRow } from '../classes/DateRows'
import { dayLabel } from '../classes/dates'
import { isComingBooking, isPast, latestOf, moneyWords, nameOf, nextSession, priceOf, seatsHeld, STATUS_TAG } from '../classes/labels'
import { takenCents } from '@lib/classes/booking-words'
import { useRefresh } from '../shell/data'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { dayAndSpan, timeSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { smsHref, telHref } from '../inbox/describe'
import { StaffRow } from '../staffing/StaffRow'
import { staffOpenOf } from '../staffing/api'

export type ClassTab = 'bookings' | 'details' | 'dates' | 'staff'
const TABS: [ClassTab, string][] = [['bookings', 'Bookings'], ['details', 'Details'], ['dates', 'Dates'], ['staff', 'Staff']]
export const STALE_KEPT = 'Someone else changed this class. Your edits are kept; check them and save again.'
const STATUS_NOTE: Record<Exclude<ClassStatus, 'cancelled'>, string> = {
  open: 'On the website. People can book.',
  draft: 'Saved, but not on the website yet. Only you see it.',
  closed: 'On the website, with sign-ups closed.',
}

interface Loaded { cls: ScheduledClass; bookings: ClassBooking[]; seatsTaken: Record<string, number>; register?: RegisterInForce | null }

/** Several numbers in one text: iOS Messages opens a group with /open?addresses=. */
export function smsAll(phones: string[]): string {
  const digits = phones.map((p) => p.replace(/[^\d+]/g, ''))
  return digits.length === 1 ? smsHref(phones[0]) : `sms:/open?addresses=${digits.join(',')}`
}

function newAttempt(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export function ClassSheet({ id, tab: firstTab = 'bookings' }: { id: string; tab?: ClassTab }) {
  const { open, data: handed } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState('')
  /** A staffing line or the Staff board opens the class on Staff, on that day. */
  const staffOpen = staffOpenOf(handed)
  const [tab, setTab] = useState<ClassTab>(staffOpen ? 'staff' : firstTab)
  const [staffKey, setStaffKey] = useState<string | null>(staffOpen?.staffKey ?? null)
  const [library, setLibrary] = useState<ClassContent | null>(null)
  /** I3: the dates still to come in this class's Repeat series (this one too); null = not loaded or not in one. */
  const [series, setSeries] = useState<SeriesMember[] | null>(null)
  /** What the last "All dates in this series" did: changed dates, skipped ones and why, and who to tell after a cancel. */
  const [seriesNote, setSeriesNote] = useState<{ text: string; skipped: SeriesSkip[]; cancelled?: { id: string; date: string; booked: BookedPerson[] }[] } | null>(null)
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
  const [moved, setMoved] = useState<{ people: PersonToTell[]; movedFrom: Record<string, string> } | null>(null)
  // Cancel and Refund everyone
  const [asking, setAsking] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [refundAll, setRefundAll] = useState<'idle' | 'confirm' | 'running'>('idle')
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const attempts = useRef<Record<string, string>>({})
  const [texting, setTexting] = useState(false)
  const [printing, setPrinting] = useState(false)
  /** Which footer button is working, so it can say "Saving…" (M5). */
  const [busy, setBusy] = useState('')
  const textPanel = useRef<HTMLDivElement>(null)
  const healed = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => { if (texting) textPanel.current?.scrollIntoView?.({ block: 'nearest' }) }, [texting])

  const detailsDirty = !!f && !!base && JSON.stringify(f) !== JSON.stringify(base)
  const datesDirty = !!data && (!sameRows(rows, baseRows) || status !== data.cls.status)
  useSheetDirty(detailsDirty || datesDirty)

  function fill(cls: ScheduledClass, which: { details?: boolean; dates?: boolean } = { details: true, dates: true }) {
    if (which.details) { const form = toForm(cls.content); setF(form); setBase(form) }
    if (which.dates) { const r = rowsOf(cls.sessions); setRows(r); setBaseRows(r); setStatus(cls.status) }
  }

  async function load(opts: { refill?: boolean } = {}): Promise<Loaded | null> {
    setLoadError('')
    const r = await api<{ class: ScheduledClass; bookings?: ClassBooking[]; seatsTaken?: Record<string, number>; register?: RegisterInForce | null }>(`${BOOKINGS}?id=${encodeURIComponent(id)}`)
    if (!r.ok || !r.data) { if (!data) setLoadError(r.error ?? ''); else toast(r.error ?? DIDNT_SAVE); return null }
    const next: Loaded = { cls: r.data.class, bookings: r.data.bookings ?? [], seatsTaken: r.data.seatsTaken ?? {}, register: r.data.register ?? null }
    setData(next)
    if (!data || opts.refill) fill(next.cls)
    return next
  }
  useEffect(() => { load() }, [id])

  // R36: a class that isn't in the library yet (made before every class went there) goes there now, quietly.
  useEffect(() => {
    if (!data || data.cls.libraryId || healed.current) return
    healed.current = true
    api<{ class: ScheduledClass; libraryAdded?: boolean }>(CLASSES, { action: 'link-library', id: data.cls.id }).then((r) => {
      if (r.ok && r.data?.class) {
        const linked = r.data.class
        setData((d) => (d ? { ...d, cls: linked } : d))
        if (r.data.libraryAdded) bump()
      } else if (!r.ok && r.status !== 401) toast('This class isn’t in your library yet. It’ll go in when you save it.')
    })
  }, [data?.cls.id, data?.cls.libraryId])

  // The linked library version's details, to know whether "This class and the library" means anything.
  const libraryId = data?.cls.libraryId ?? null
  async function loadLibrary() {
    if (!libraryId) { setLibrary(null); return }
    const r = await api<{ library: LibraryClass[] }>(`${LIBRARY}?archived=1`)
    const lib = r.ok ? r.data?.library.find((l) => l.id === libraryId) : undefined
    setLibrary(lib ? latestOf(lib).content : null)
  }
  useEffect(() => { loadLibrary() }, [libraryId])

  const seriesId = data?.cls.seriesId ?? null
  async function loadSeries() {
    if (!seriesId) { setSeries(null); return }
    const r = await api<{ members: SeriesMember[] }>(`${CLASSES}?series=${encodeURIComponent(id)}`)
    setSeries(r.ok && r.data ? r.data.members : null)
  }
  useEffect(() => { loadSeries() }, [seriesId, id])

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
      {c.earlyBird && earlyBirdRunning(c, new Date()) ? ` · Early-bird until ${shortDay(c.earlyBird.untilYmd)}` : ''}
      {tag && <span className={`adm-tag${cancelled ? ' is-red' : ''}`}>{tag}</span>}
      {past && <span className="adm-tag is-grey">Past</span>}
    </>
  )
  const sessionsForPasses = cls.sessions.map((s) => ({ id: s.id, label: dayAndSpan(s.startIso, s.endIso) }))
  const ticket = (t: string) => c.ticketTypes.find((x) => x.id === t)?.label ?? t

  // ── Details ───────────────────────────────────────────────────────────
  const built = f ? build(f) : null
  const differsFromLibrary = !!library && !!built?.ok && !sameDetails(built.content, library)

  async function saveDetails(alsoLibrary: boolean, expected = cls.updatedAt, retried = false) {
    if (!f) return
    setStaleNote('')
    const b = build(f)
    if (!b.ok) { setErrors(b.errors); requestAnimationFrame(() => focusFirstError(body.current, b.errors)); return }
    setErrors({})
    setSaving(true)
    setBusy(alsoLibrary ? 'both' : 'only')
    const r = await api<{ class: ScheduledClass; libraryAdded?: boolean }>(CLASSES, {
      action: 'update', id: cls.id, expectedUpdatedAt: expected, content: b.content, ...(alsoLibrary ? { alsoUpdateLibrary: true } : {}),
    })
    setSaving(false)
    setBusy('')
    if (!r.ok || !r.data) {
      if (r.status === 409 && r.extra.stale === true) {
        const again = await keepAfterStale(retried)
        if (again) return saveDetails(alsoLibrary, again, true)
        return
      }
      const k = fieldOf(r.extra.field, f)
      const e = { [k]: r.error ?? DIDNT_SAVE } as Errors
      setErrors(e)
      if (k !== 'form') requestAnimationFrame(() => focusFirstError(body.current, e))
      return
    }
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { details: true })
    if (alsoLibrary || r.data.libraryAdded) loadLibrary()
    bump()
    toast(r.warning ?? `${r.data.libraryAdded ? 'Saved. It’s in your library now.' : alsoLibrary ? 'Saved. The library has it too.' : 'Saved.'}${keptPriceNote(b.content)}`)
  }

  /** M5: a price change on a class with bookings says booked people keep what they paid. */
  function keptPriceNote(next: ClassContent): string {
    const priced = JSON.stringify(next.prices) !== JSON.stringify(cls.content.prices) || JSON.stringify(next.earlyBird ?? null) !== JSON.stringify(cls.content.earlyBird ?? null)
    return priced && bookings.some(isComingBooking) ? ' People already booked keep the price they paid.' : ''
  }

  /** I3: Details › All dates in this series. This class saves as Save does; the others take the same changes where they safely can. */
  async function saveSeries() {
    if (!f) return
    setStaleNote('')
    setSeriesNote(null)
    const b = build(f)
    if (!b.ok) { setErrors(b.errors); requestAnimationFrame(() => focusFirstError(body.current, b.errors)); return }
    setErrors({})
    setSaving(true)
    setBusy('series')
    const r = await api<{ class: ScheduledClass; series: { changed: string[]; skipped: SeriesSkip[] } }>(CLASSES, { action: 'update-series', id: cls.id, expectedUpdatedAt: cls.updatedAt, content: b.content })
    setSaving(false)
    setBusy('')
    if (!r.ok || !r.data) {
      if (r.status === 409 && r.extra.stale === true) { await keepAfterStale(true); return }
      const k = fieldOf(r.extra.field, f)
      setErrors({ [k]: r.error ?? DIDNT_SAVE } as Errors)
      return
    }
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { details: true })
    bump()
    loadSeries()
    const { changed, skipped } = r.data.series
    const text = `Saved on this date${changed.length ? ` and ${changed.length} more (${changed.join(', ')})` : ''}.${keptPriceNote(b.content)}`
    setSeriesNote({ text, skipped })
    toast(r.warning ?? (skipped.length ? `${text} Some dates weren’t changed: see below.` : text))
  }

  /** I3: Dates › the seats for all dates in this series. */
  async function saveSeriesCapacity(capacity: number) {
    setDatesError('')
    setSeriesNote(null)
    setSaving(true)
    setBusy('series')
    const r = await api<{ class: ScheduledClass; series: { changed: string[]; skipped: SeriesSkip[] } }>(CLASSES, { action: 'series-capacity', id: cls.id, capacity })
    setSaving(false)
    setBusy('')
    if (!r.ok || !r.data) { setDatesError(r.error ?? DIDNT_SAVE); return }
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { dates: true })
    bump()
    loadSeries()
    const { changed, skipped } = r.data.series
    const text = `${capacity} seats on ${changed.length === 1 ? '1 date' : `${changed.length} dates`}.`
    setSeriesNote({ text, skipped })
    toast(skipped.length ? `${text} Some dates weren’t changed: see below.` : text)
  }

  /**
   * Someone else saved first: take their copy as the base, keep what was
   * typed, say what they changed. When nothing she can see changed (only the
   * background library link, N5), returns the fresh updatedAt so the save goes
   * again quietly (once).
   */
  async function keepAfterStale(retried = false): Promise<string | null> {
    const before = cls.content
    const beforeCls = cls
    // What she hadn't touched follows the fresh copy, so it never shows as her unsaved change (Q3).
    const detailsUntouched = !detailsDirty
    const datesUntouched = sameRows(rows, baseRows) && status === cls.status
    const fresh = await load()
    if (!fresh) return null
    const theirs = contentChanges(before, fresh.cls.content, { usual: false })
    const nothingSeen = !theirs.length && fresh.cls.status === beforeCls.status
      && JSON.stringify(fresh.cls.sessions) === JSON.stringify(beforeCls.sessions)
    if (nothingSeen && !retried) return fresh.cls.updatedAt
    const freshForm = toForm(fresh.cls.content)
    setBase(freshForm)
    if (detailsUntouched) setF(freshForm)
    const freshRows = rowsOf(fresh.cls.sessions)
    setBaseRows(freshRows)
    if (datesUntouched) { setRows(freshRows); setStatus(fresh.cls.status) }
    setStaleNote(`${STALE_KEPT}${theirs.length ? ` They changed: ${theirs.join(', ')}.` : ''}`)
    return null
  }

  // ── Dates ─────────────────────────────────────────────────────────────
  async function saveDates(confirmMove = false, expected = cls.updatedAt, retried = false) {
    setDatesError('')
    setStaleNote('')
    setMoved(null)
    const checked = checkRows(rows)
    if (!checked.ok) { setDatesError(checked.error); return }
    setSaving(true)
    setBusy(confirmMove ? 'move' : 'dates')
    const r = await api<{ class: ScheduledClass; peopleToTell?: PersonToTell[]; movedFrom?: Record<string, string>; libraryAdded?: boolean }>(CLASSES, {
      action: 'update', id: cls.id, expectedUpdatedAt: expected, sessions: checked.sessions, status: status === 'cancelled' ? undefined : status,
      ...(confirmMove ? { confirmMove: true } : {}),
    })
    setSaving(false)
    setBusy('')
    if (!r.ok || !r.data) {
      if (r.status === 409 && Array.isArray(r.extra.peopleToTell)) { setToTell(r.extra.peopleToTell); return }
      setToTell(null)
      if (r.status === 409 && r.extra.stale === true) {
        const again = await keepAfterStale(retried)
        if (again) return saveDates(confirmMove, again, true)
        return
      }
      setDatesError(r.error ?? DIDNT_SAVE)
      return
    }
    setToTell(null)
    const saved = r.data.class
    setData((d) => (d ? { ...d, cls: saved } : d))
    fill(saved, { dates: true })
    bump()
    if (confirmMove && r.data.peopleToTell?.length) {
      setMoved({ people: r.data.peopleToTell, movedFrom: r.data.movedFrom ?? {} })
      toast('Moved. Let the people below know.')
    } else toast(r.warning ?? (r.data.libraryAdded ? 'Saved. It’s in your library now.' : 'Saved. The calendar is updated.'))
  }

  // ── Cancel ────────────────────────────────────────────────────────────
  // Who is coming (R43): a refund that kept the seat is still coming; a booking whose seats were all freed isn't.
  const live = bookings.filter(isComingBooking)
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

  /** I3: Cancel › All dates in this series (never refunds; who to contact on each date is listed after). */
  async function doCancelSeries() {
    setSaving(true)
    setCancelError('')
    const r = await api<{ class: ScheduledClass; series: { cancelled: { id: string; date: string; booked: BookedPerson[] }[]; skipped: SeriesSkip[] } }>(CLASSES, { action: 'cancel-series', id: cls.id })
    setSaving(false)
    if (!r.ok || !r.data) { setCancelError(r.error ?? DIDNT_SAVE); return }
    setAsking(false)
    await load({ refill: true })
    bump()
    loadSeries()
    setTab('bookings')
    const { cancelled: done, skipped } = r.data.series
    setSeriesNote({ text: `Cancelled ${done.length === 1 ? '1 date' : `${done.length} dates`}. Nobody was refunded. Let the people below know.`, skipped, cancelled: done.filter((x) => x.id !== cls.id) })
    toast(r.warning ?? `Cancelled ${done.length === 1 ? '1 date' : `all ${done.length} dates`}. Here is who to contact.`)
  }

  // ── Refund everyone (after a cancel; never on its own) ────────────────
  const canRefund = (b: ClassBooking) => b.paidHere && b.refundableCents > 0 && !b.waiting && b.state !== 'held'
  const toRefund = bookings.filter(canRefund)
  const notHere = live.filter((b) => !canRefund(b) && takenCents(b) > 0)
  async function runRefunds(list: ClassBooking[]) {
    setRefundAll('running')
    let done = 0
    for (const b of list) {
      attempts.current[b.bookingId] ??= newAttempt()
      const r = await api<{ cents: number; emailed: boolean; already?: { message: string } }>(ADMIN_REFUND, {
        classId: cls.id, bookingId: b.bookingId, kind: 'booking', freeSeat: true, reason: 'Class cancelled', attempt: attempts.current[b.bookingId],
      })
      const text = !r.ok || !r.data
        ? `Didn’t go through. ${r.error ?? ''}`.trim()
        : r.data.already ? r.data.already.message : `Refunded ${formatMoney(r.data.cents)}.${r.data.emailed ? ' They’ve been emailed.' : ''}`
      if (r.ok) done++
      setResults((cur) => ({ ...cur, [b.bookingId]: { ok: !!r.ok, text } }))
    }
    setRefundAll('idle')
    // Said again as a toast, which stays on screen even if the sheet was closed while it ran (M8).
    toast(done === list.length ? `Refunded ${done === 1 ? '1 person' : `all ${done}`}.`
      : `Refunded ${done} of ${list.length}. ${mounted.current ? 'Try the rest below.' : 'Open the class to try the rest.'}`)
    await load()
    bump()
  }
  const failed = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => bookings.find((b) => b.bookingId === k)).filter((b): b is ClassBooking => !!b && canRefund(b))

  // ── Series (I3) ───────────────────────────────────────────────────────
  const others = (series ?? []).filter((m) => m.id !== cls.id)
  /** Only the seats changed on Dates (same days and times, one number for every date): that number, else null. */
  const seatsOnly = (() => {
    if (!datesDirty || status !== cls.status || rows.length !== baseRows.length) return null
    const same = rows.every((r, i) => r.id === baseRows[i].id && r.day === baseRows[i].day && r.start === baseRows[i].start && r.end === baseRows[i].end)
    const caps = new Set(rows.map((r) => r.capacity.trim()))
    const n = Number([...caps][0])
    return same && caps.size === 1 && Number.isInteger(n) && n > 0 ? n : null
  })()

  // ── Footer per tab ────────────────────────────────────────────────────
  let footer: ReactNode = null
  if (tab === 'bookings') {
    footer = refundAll === 'confirm'
      ? (
        <div className="adm-panel is-warn" role="group" aria-label="Refund everyone">
          <b>{`Refund ${toRefund.length === 1 ? '1 person' : `${toRefund.length} people`} · ${formatMoney(toRefund.reduce((a, b) => a + b.refundableCents, 0))}${toRefund.length > 1 ? ' in all' : ''}?`}</b>
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
          <button
            type="button"
            className="adm-btn is-ghost"
            aria-expanded={cls.sessions.length > 1 ? printing : undefined}
            onClick={() => (cls.sessions.length > 1 ? setPrinting(!printing) : next && printDay(localDate(next.startIso)))}
          >
            Print list
          </button>
          <button type="button" className="adm-btn is-ghost" aria-expanded={texting} onClick={() => setTexting(!texting)}>Text everyone</button>
        </div>
      )
    if (printing && cls.sessions.length > 1 && refundAll !== 'confirm') {
      footer = (
        <div className="adm-panel" role="group" aria-label="Print which date?">
          <b>Print which date?</b>
          {cls.sessions.map((s) => (
            <button key={s.id} type="button" className="adm-btn is-ghost" onClick={() => printDay(localDate(s.startIso))}>{dayAndSpan(s.startIso, s.endIso)}</button>
          ))}
          <button type="button" className="adm-quiet" onClick={() => setPrinting(false)}>Never mind</button>
        </div>
      )
    }
  } else if (tab === 'details' && !cancelled) {
    const line = errors.form || fixLine(errors, 'under Details')
    footer = (
      <div className="adm-stack">
        {line && <p className="adm-footline" role="alert">{line}</p>}
        {detailsDirty && others.length > 0
          ? (
            <>
              <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDetails(false)}>{busy === 'only' ? 'Saving…' : 'Just this date'}</button>
              <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={saveSeries}>{busy === 'series' ? 'Saving…' : 'All dates in this series'}</button>
              <span className="adm-small adm-muted">{`This class was repeated: ${others.length} other ${others.length === 1 ? 'date is' : 'dates are'} still to come. All dates in this series changes them too. People already booked keep what they paid.`}</span>
              {differsFromLibrary && <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => saveDetails(true)}>{busy === 'both' ? 'Saving…' : 'This class and the library'}</button>}
            </>
          )
          : detailsDirty && differsFromLibrary
          ? (
            <>
              <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDetails(false)}>{busy === 'only' ? 'Saving…' : 'Only this class'}</button>
              <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => saveDetails(true)}>{busy === 'both' ? 'Saving…' : 'This class and the library'}</button>
            </>
          )
          : <button type="button" className="adm-btn is-pri" disabled={!detailsDirty || saving} onClick={() => saveDetails(false)}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>
    )
  } else if (tab === 'dates' && !cancelled && !past) {
    footer = toTell
      ? (
        <div className="adm-panel" role="group" aria-label="People are booked on the dates you moved">
          <b>People are booked on the dates you moved</b>
          <PeopleList people={toTell} label="People to tell" />
          <span className="adm-small">Nobody is told for you. Move it, then let them know.</span>
          <div className="adm-stack">
            <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDates(true)}>{busy === 'move' ? 'Moving…' : 'Move and I’ll tell them'}</button>
            <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => { setToTell(null); setRows(baseRows) }}>Don’t move</button>
          </div>
        </div>
      )
      : seatsOnly !== null && others.length > 0
        ? (
          <div className="adm-stack">
            <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => saveDates()}>{busy === 'dates' ? 'Saving…' : 'Just this date'}</button>
            <button type="button" className="adm-btn is-ghost" disabled={saving} onClick={() => saveSeriesCapacity(seatsOnly)}>{busy === 'series' ? 'Saving…' : 'All dates in this series'}</button>
            <span className="adm-small adm-muted">{`${seatsOnly} seats. All dates in this series gives the ${others.length} other ${others.length === 1 ? 'date' : 'dates'} still to come ${seatsOnly} seats too (never fewer than are booked).`}</span>
          </div>
        )
        : <button type="button" className="adm-btn is-pri" disabled={!datesDirty || saving} onClick={() => saveDates()}>{saving ? 'Saving…' : 'Save dates'}</button>
  }

  const phones = [...new Set(live.map((b) => b.customer?.phone ?? '').filter(Boolean))]
  // Money in: comps and counter seats nobody has rung up yet bring in nothing (I3).
  const totalTaken = bookings.filter((b) => b.state !== 'held').reduce((s, b) => s + takenCents(b), 0)
  const settled = bookings.filter((b) => b.state !== 'held')
  const bookingCount = settled.filter(isComingBooking).length
  // After a cancel: how much has gone back so far (Q2).
  const paidOnes = settled.filter((b) => takenCents(b) > 0 || b.refundedCents > 0)
  const refundedOnes = paidOnes.filter((b) => b.refundedCents > 0)
  const refundedCents = refundedOnes.reduce((a, b) => a + b.refundedCents, 0)
  function printDay(day: string) {
    setPrinting(false)
    open({ kind: 'print', day }, { back: { kind: 'class', id: cls.id }, label: c.name })
  }

  // I2: the same Cancel at the bottom of Bookings (where she decides) and of Details.
  const cancelBlock = asking
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
        {others.length > 0 && (
          <>
            <span>{`It was repeated: ${others.length} other ${others.length === 1 ? 'date is' : 'dates are'} still to come.`}</span>
            <ul className="adm-plain" aria-label="Other dates in this series">
              {others.map((m) => (
                <li key={m.id}>{`${dayAndSpan(m.startIso, m.endIso)}: ${m.booked.length ? m.booked.map((p) => [p.name || 'No name', `${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}`, p.phone].filter(Boolean).join(' · ')).join('; ') : 'nobody booked'}`}</li>
              ))}
            </ul>
          </>
        )}
        <span className="adm-small">It comes off the website and the register.</span>
        {cancelError && <p role="alert" className="adm-error">{cancelError}</p>}
        {others.length > 0
          ? (
            <div className="adm-stack">
              <button type="button" className="adm-btn is-danger" disabled={saving} onClick={doCancel}>Just this date</button>
              <button type="button" className="adm-btn is-danger" disabled={saving} onClick={doCancelSeries}>All dates in this series</button>
              <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setCancelError('') }}>Keep it</button>
            </div>
          )
          : (
            <div className="adm-two">
              <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setCancelError('') }}>Keep it</button>
              <button type="button" className="adm-btn is-danger" disabled={saving} onClick={doCancel}>Cancel class</button>
            </div>
          )}
      </div>
    )
    : <button type="button" className="adm-btn is-danger adm-cancelbtn" onClick={() => setAsking(true)}>Cancel this class</button>

  return (
    <SheetFrame tall title={c.name} subtitle={subtitle} footer={footer}>
      <div ref={body}>
        <Seg label="Show" value={tab} options={TABS} onChange={(t) => { setTab(t); setTexting(false) }} />
        {/* UI review (3 Nov): the register panel once, on Bookings (it repeated on every tab). */}
        {tab === 'bookings' && <RegisterPanel cls={cls} register={data.register} onFixed={(saved) => { setData((d) => (d ? { ...d, cls: saved } : d)); bump() }} />}
        {seriesNote && <SeriesNote note={seriesNote} onClose={() => setSeriesNote(null)} />}

        {tab === 'bookings' && (
          <section aria-label="Bookings">
            <div className="adm-sum">
              {cls.sessions.length > 1
                ? <div><b>{bookingCount}</b><small>{`${bookingCount === 1 ? 'booking' : 'bookings'} on ${cls.sessions.length} dates`}</small></div>
                : <div><b>{next ? `${seatsTaken[next.id] ?? 0} of ${next.capacity}` : '0'}</b><small>seats booked</small></div>}
              <div><b>{formatMoney(totalTaken)}</b><small>taken so far</small></div>
            </div>
            {cls.sessions.length > 1 && (
              <ul className="adm-plain adm-perdate" aria-label="Seats on each date">
                {cls.sessions.map((s) => <li key={s.id}><span>{dayAndSpan(s.startIso, s.endIso)}</span><b>{`${seatsTaken[s.id] ?? 0} of ${s.capacity}`}</b></li>)}
              </ul>
            )}
            {texting && (
              <div ref={textPanel} className="adm-panel" role="group" aria-label="Text everyone">
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
                <b>{settled.length ? 'Cancelled. Let these people know.' : 'Cancelled. Nobody was booked.'}</b>
                {settled.length > 0 && (
                  <>
                    <ul className="adm-plain adm-contacts" aria-label="People to contact">
                      {settled.map((b) => (
                        <li key={b.bookingId}>
                          <span>{[nameOf(b), `${seatsHeld(b)} ${seatsHeld(b) === 1 ? 'seat' : 'seats'}`, moneyWords(b), b.refundedCents ? `refunded ${formatMoney(b.refundedCents)}` : ''].filter(Boolean).join(' · ')}</span>
                          {(b.customer?.phone || b.customer?.email) && (
                            <span className="adm-links">
                              {b.customer?.phone && <a href={telHref(b.customer.phone)}>{b.customer.phone}</a>}
                              {b.customer?.email && <a href={`mailto:${b.customer.email}`}>{b.customer.email}</a>}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <span className="adm-small" role="status">
                      {!paidOnes.length ? 'Nobody paid online here, so there’s nothing to refund from this page.'
                        : refundedOnes.length ? `Refunded ${refundedOnes.length} of ${paidOnes.length} · ${formatMoney(refundedCents)}.${toRefund.length ? ' Refund the rest on their rows below, or all at once.' : ''}`
                          : 'Nobody has been refunded yet. Refund each person on their row below, or everyone at once.'}
                    </span>
                  </>
                )}
                {toRefund.length > 0 && refundAll === 'idle' && !Object.keys(results).length && (
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
                    : cancelled ? 'No bookings.'
                      : notOnRegister(cls, new Date()) ? 'No bookings yet. People see it on the What’s On page but can’t pay for it until it’s on the register (the button above).'
                        : 'No bookings yet. People can find it and book it on the What’s On page.'}
              </p>
            )}
            {bookings.map((b) => <BookingRow key={b.bookingId} b={b} cls={cls} ticket={ticket} canEmail={!cancelled && !past} onChanged={() => { load(); bump() }} />)}
            <WaitlistSection classId={cls.id} onChanged={() => { load(); bump() }} />
            {!cancelled && cancelBlock}
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
            {!cancelled && cancelBlock}
          </section>
        )}

        {tab === 'dates' && (
          <section aria-label="Dates">
            {staleNote && <p className="adm-panel is-warn" role="alert">{staleNote}</p>}
            {past && !cancelled && <p className="adm-note">Every date has ended, so the dates stay as they were. To run it again, use Run it again.</p>}
            <DateRows rows={rows} onChange={(r) => { setRows(r); setToTell(null) }} error={datesError} disabled={cancelled || past} booked={seatsTaken} />
            {!cancelled && !past && (
              <>
                <p className="adm-lbl">Status</p>
                <Seg label="Status" value={status === 'cancelled' ? 'open' : status} options={[['open', 'Open'], ['draft', 'Draft'], ['closed', 'Closed']]} onChange={(s) => setStatus(s as ClassStatus)} />
                {status !== 'draft' && notOnRegister(cls, new Date())
                  ? (
                    <p className="adm-small adm-warntext" data-testid="status-not-bookable">
                      {status === 'closed' ? 'On the website, with sign-ups closed.' : 'On the website, but people can’t pay for it yet: it isn’t on the register.'}{' '}
                      <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setTab('bookings')}>Put it on the register</button>
                    </p>
                  )
                  : <p className="adm-small adm-muted">{STATUS_NOTE[status === 'cancelled' ? 'open' : status]}</p>}
              </>
            )}
            {moved && <MovedPanel cls={cls} moved={moved} />}
            <button type="button" className="adm-btn is-ghost adm-again" onClick={() => open({ kind: 'again', id: cls.id })}>Run it again on new dates</button>
          </section>
        )}

        {tab === 'staff' && <ClassStaff cls={cls} staffKey={staffKey} onPick={setStaffKey} />}
      </div>
    </SheetFrame>
  )
}

/** Staff on one day of the class (a day picker when it runs on several), with "every day". */
function ClassStaff({ cls, staffKey, onPick }: { cls: ScheduledClass; staffKey: string | null; onPick: (key: string) => void }) {
  if (cls.status === 'draft') return <p className="adm-note">It’s a draft, so nobody can go on it yet. Open it on Dates first.</p>
  const sessions = [...cls.sessions].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
  if (sessions.length === 0) return <p className="adm-note">This class has no dates.</p>
  const keyOf = (id: string) => `ses:${id}`
  const now = Date.now()
  const chosen = sessions.find((x) => keyOf(x.id) === staffKey) ?? sessions.find((x) => Date.parse(x.endIso) > now) ?? sessions[sessions.length - 1]
  const days = sessions.map((x) => ({ key: keyOf(x.id), startIso: x.startIso }))
  return (
    <section aria-label="Staff on this class">
      {sessions.length > 1 && (
        <Seg
          label="Which day"
          className="is-scroll"
          value={keyOf(chosen.id)}
          onChange={onPick}
          options={sessions.map((x) => [keyOf(x.id), dayLabel(localDate(x.startIso))] as [string, string])}
        />
      )}
      <p className="adm-small adm-muted adm-gap-top">{dayAndSpan(chosen.startIso, chosen.endIso)}</p>
      <StaffRow key={chosen.id} eventKey={keyOf(chosen.id)} startIso={chosen.startIso} days={days} />
    </section>
  )
}

/** What "All dates in this series" did: which dates changed, which didn't and why, and after a cancel who to tell on each date. */
function SeriesNote({ note, onClose }: { note: { text: string; skipped: SeriesSkip[]; cancelled?: { id: string; date: string; booked: BookedPerson[] }[] }; onClose: () => void }) {
  return (
    <div className={`adm-panel${note.skipped.length ? ' is-warn' : ''} adm-gap-top`} role="group" aria-label="All dates in this series">
      <b>{note.text}</b>
      {note.skipped.length > 0 && (
        <ul className="adm-plain" aria-label="Dates not changed">
          {note.skipped.map((x) => <li key={x.id}>{`${x.date}: ${x.reason}`}</li>)}
        </ul>
      )}
      {(note.cancelled ?? []).filter((c) => c.booked.length).map((c) => (
        <div key={c.id}>
          <span className="adm-small">{c.date}</span>
          <PeopleList people={c.booked.map((p) => ({ name: p.name, phone: p.phone, email: p.email, sessions: [] }))} label={`Booked on ${c.date}`} />
        </div>
      ))}
      <button type="button" className="adm-quiet" onClick={onClose}>OK</button>
    </div>
  )
}

function PeopleList({ people, label }: { people: PersonToTell[]; label: string }) {
  return (
    <ul className="adm-plain adm-contacts" aria-label={label}>
      {people.map((p, i) => (
        <li key={i}>
          <span>{`${p.name || 'No name'}${p.sessions.length ? ` (booked ${p.sessions.join(', ')})` : ''}`}</span>
          {(p.phone || p.email) && (
            <span className="adm-links">
              {p.phone && <a href={telHref(p.phone)}>{p.phone}</a>}
              {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * After a move (final review I1): who to tell, with tappable numbers,
 * Text everyone and Copy the numbers, and an owner-tapped "Email everyone the
 * new details" (their confirmation again with the new time and a calendar
 * file that replaces the old one). Nothing is sent until she taps it.
 */
function MovedPanel({ cls, moved }: { cls: ScheduledClass; moved: { people: PersonToTell[]; movedFrom: Record<string, string> } }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ sent: string[]; failed: string[]; noEmail: string[] } | null>(null)
  const [error, setError] = useState('')
  const phones = [...new Set(moved.people.map((p) => p.phone).filter(Boolean))]
  const withEmail = moved.people.filter((p) => p.email).length
  async function emailAll() {
    setBusy(true)
    setError('')
    const r = await api<{ sent: string[]; failed: string[]; noEmail: string[] }>(CLASSES, { action: 'email-moved', id: cls.id, movedFrom: moved.movedFrom })
    setBusy(false)
    if (!r.ok || !r.data) { setError(r.error ?? DIDNT_SAVE); return }
    setResult(r.data)
    toast(r.data.failed.length ? `Emailed ${r.data.sent.length}. ${r.data.failed.length} didn’t go.` : `Emailed ${r.data.sent.length === 1 ? '1 person' : `all ${r.data.sent.length}`} the new details.`)
  }
  return (
    <div className="adm-panel" role="group" aria-label="Moved">
      <b>Moved. Let these people know.</b>
      <PeopleList people={moved.people} label="People to tell" />
      {phones.length > 0 && (
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => navigator.clipboard?.writeText(phones.join(', ')).then(() => toast('Copied the numbers.'), () => toast('Couldn’t copy. Press and hold the numbers to copy them.'))}>Copy the numbers</button>
          <a className="adm-btn is-ghost" href={smsAll(phones)}>Text everyone</a>
        </div>
      )}
      {withEmail > 0 && !result && (
        <>
          <button type="button" className="adm-btn is-pri" disabled={busy} onClick={emailAll}>{busy ? 'Sending…' : 'Email everyone the new details'}</button>
          <span className="adm-small">Sends each of them their confirmation again with the new time and a new calendar file. Nothing is sent until you tap it.</span>
        </>
      )}
      {error && <p className="adm-error" role="alert">{error}</p>}
      {result && (
        <p className="adm-small" role="status">
          {[
            result.sent.length ? `Emailed: ${result.sent.join(', ')}.` : '',
            result.failed.length ? `Didn’t go: ${result.failed.join(', ')}. Call or text them.` : '',
            result.noEmail.length ? `No email on file: ${result.noEmail.join(', ')}. Call or text them.` : '',
          ].filter(Boolean).join(' ')}
        </p>
      )}
    </div>
  )
}

/** One booking: who, what they bought, how they paid, then the refund panel. */
function BookingRow({ b, cls, ticket, canEmail, onChanged }: { b: ClassBooking; cls: ScheduledClass; ticket: (id: string) => string; canEmail: boolean; onChanged: () => void }) {
  const c = cls.content
  const name = nameOf(b)
  const seatCount = Object.values(b.seats).reduce((a, n) => a + n, 0)
  const seats = c.ticketTypes.length > 1
    ? Object.entries(b.seats).map(([t, n]) => `${n} ${ticket(t)}`).join(', ')
    : `${seatCount} ${seatCount === 1 ? 'seat' : 'seats'}`
  const pass = c.passes.length > 1 ? c.passes.find((p) => p.id === b.passId)?.label : ''
  // A seat freed with no money back reads as that, never "Refunded" for $0.
  const freedOnly = (b.state === 'refunded' || b.state === 'part refunded') && b.refundedCents === 0
  const tag = freedOnly ? (b.seatsComing === 0 ? (seatCount === 1 ? 'Seat freed' : 'Seats freed') : 'Seat freed')
    : b.state === 'refunded' ? 'Refunded' : b.state === 'part refunded' ? 'Part refunded' : b.state === 'held' ? 'Paying now' : ''
  const answers = c.questions.length > 0 && b.picks.some((p) => Object.keys(p.answers).length)
    ? b.picks.map((p) => `Seat ${p.seat} (${ticket(p.ticketTypeId)}) · ${c.questions.map((q) => (p.answers[q.id] ? `${q.label} ${p.answers[q.id]}` : '')).filter(Boolean).join(', ')}`)
    : []
  const extras = Object.entries(b.addOns).map(([a, n]) => `${n} ${c.addOns.find((x) => x.id === a)?.label ?? a}`)
  return (
    <article className={`adm-bkc${b.state !== 'held' && b.seatsComing === 0 ? ' is-gone' : ''}`} aria-label={name}>
      <div className="adm-bk">
        <div className="adm-rm">
          <b>{name}</b>
          <small>{[seats, pass, moneyWords(b), b.refundedCents ? `refunded ${formatMoney(b.refundedCents)}` : ''].filter(Boolean).join(' · ')}</small>
        </div>
        {tag && <span className={`adm-tag ${b.state === 'held' ? '' : 'is-grey'}`}>{tag}</span>}
        {(b.discounts ?? []).map((d) => <span key={d} className="adm-tag is-grey">{d}</span>)}
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
      {b.cancelLine && <p className="adm-small" data-testid="cancel-line">{b.cancelLine}</p>}
      {canEmail && b.state !== 'held' && b.seatsComing > 0 && <ResendPanel b={b} cls={cls} onChanged={onChanged} />}
      <div data-refund-slot={b.bookingId}>
        {b.state !== 'held' && <RefundPanel classId={cls.id} booking={b} ticketLabel={ticket} waiting={b.waiting} counterSalesAtRegister send={(url, body) => api(url, body)} onDone={onChanged} />}
      </div>
    </article>
  )
}

/**
 * "Email them their booking again" (final review I6): the same confirmation,
 * with their own "Can't make it?" link and the calendar file. The email box
 * starts with the one on the booking; a different one is saved on the
 * booking first (recorded with who changed it).
 */
function ResendPanel({ b, cls, onChanged }: { b: ClassBooking; cls: ScheduledClass; onChanged: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(b.customer?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!open) return <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setOpen(true)}>Email them their booking again</button>
  const changed = email.trim().toLowerCase() !== (b.customer?.email ?? '').trim().toLowerCase()
  async function send() {
    setBusy(true)
    setError('')
    const r = await api<{ sent: true; to: string; emailChanged: boolean }>(CLASSES, { action: 'resend-confirmation', id: cls.id, bookingId: b.bookingId, email: email.trim() })
    setBusy(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? DIDNT_SAVE)
      if (r.extra.emailChanged) onChanged()
      return
    }
    setOpen(false)
    toast(r.data.emailChanged ? `Email fixed on the booking and sent to ${r.data.to}.` : `Sent to ${r.data.to}.`)
    if (r.data.emailChanged) onChanged()
  }
  return (
    <div className="adm-panel" role="group" aria-label={`Email ${nameOf(b)} their booking again`}>
      <label className="adm-fld">
        <span>Send it to</span>
        <input type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} />
      </label>
      <span className="adm-small">{changed && email.trim()
        ? 'This email is saved on their booking first, so later emails go there too.'
        : 'Their confirmation again: the class, the time, the calendar file and their “Can’t make it?” link.'}</span>
      {error && <p className="adm-error" role="alert">{error}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={() => { setOpen(false); setEmail(b.customer?.email ?? ''); setError('') }}>Never mind</button>
        <button type="button" className="adm-btn is-pri" disabled={busy || !email.trim()} onClick={send}>{busy ? 'Sending…' : 'Send it'}</button>
      </div>
    </div>
  )
}

/**
 * The class and the register, one panel:
 *  - fix round 3: it should be on the register and isn't (or is missing a
 *    seat it now sells) → "Put it on the register";
 *  - fix round 4: it's on the register with an older tax or category than
 *    More › Register setup has now → "Update the register";
 *  - D4: the register doesn't ring its current price (the early-bird ended or
 *    started and the hourly update didn't land) → "Fix the register price now";
 *  - otherwise, for a class on the register that isn't over, a small
 *    "Update the register" link (sends it again; what the owner alerts point at).
 * The server re-checks and writes through the guarded path. A setup step not
 * done (class tax, Classes category) comes back with the button that opens
 * More › Register setup.
 */
function RegisterPanel({ cls, register, onFixed }: { cls: ScheduledClass; register?: RegisterInForce | null; onFixed: (c: ScheduledClass) => void }) {
  const toast = useToast()
  const { open } = useSheet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; setup: boolean } | null>(null)
  const now = new Date()
  const missing = notOnRegister(cls, now)
  const oldSetup = !missing && registerSetupStale(cls, register, now)
  const priceStale = !missing && !oldSetup && posPricesStale(cls, now)
  const onRegister = !!cls.square.itemId && (cls.status === 'open' || cls.status === 'closed') && cls.sessions.some((s) => Date.parse(s.endIso) > now.getTime())
  if (!missing && !oldSetup && !priceStale && !onRegister) return null
  const running = !!cls.content.earlyBird && earlyBirdRunning(cls.content, now)
  const action = missing ? 'sync-pos' : priceStale ? 'fix-register-price' : 'update-register'
  async function run() {
    setBusy(true)
    setError(null)
    const r = await api<{ class: ScheduledClass; result: string }>(CLASSES, { action, id: cls.id })
    setBusy(false)
    if (!r.ok || !r.data) { setError({ text: r.error ?? DIDNT_SAVE, setup: !!r.extra.setup }); return }
    onFixed(r.data.class)
    if (missing) toast(r.data.result === 'put' ? 'It’s on the register now. People can book it online.' : 'It was already on the register.')
    else if (priceStale) toast(r.data.result === 'fixed' ? 'The register has the right price now.' : 'The register already had the right price.')
    else toast('The register is up to date for this class.')
  }
  const setupButton = error?.setup && (
    <button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'more', page: 'register' }, { back: { kind: 'class', id: cls.id }, label: cls.content.name })}>Open Register setup</button>
  )
  if (!missing && !oldSetup && !priceStale) {
    // Nothing known to be wrong: a quiet way to send it again (what the owner texts point at).
    return (
      <div className="adm-gap-top" data-testid="register-refresh">
        <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={run}>{busy ? 'Updating…' : 'Update the register'}</button>
        <span className="adm-small adm-muted">{' Sends this class’s prices, tax and category to the register again. Bookings don’t change.'}</span>
        {error && <p className="adm-error" role="alert">{error.text}</p>}
        {setupButton}
      </div>
    )
  }
  return (
    <div className="adm-panel is-warn" role="group" aria-label="The register" data-testid={missing ? 'not-on-register' : oldSetup ? 'register-old-setup' : 'register-price'}>
      <b>{missing
        ? 'People can see this class on What’s On, but they can’t book it online yet: it isn’t on the register.'
        : oldSetup ? 'The register still has the old tax or category for this class.'
          : running ? 'The register doesn’t have the early-bird price yet.' : 'The register still rings the early-bird price, which has ended.'}</b>
      <span className="adm-small">{missing
        ? 'Nothing about anyone’s booking changes. This puts the class and its prices on the register.'
        : oldSetup ? 'Nothing about anyone’s booking changes. This gives it the tax and category from Register setup.'
          : 'Nothing about anyone’s booking changes. This puts this class’s current prices on the register.'}</span>
      <button type="button" className="adm-btn is-pri" disabled={busy} onClick={run}>
        {busy ? (missing ? 'Putting it on…' : oldSetup ? 'Updating…' : 'Fixing…') : missing ? 'Put it on the register' : oldSetup ? 'Update the register' : 'Fix the register price now'}
      </button>
      {error && <p className="adm-error" role="alert">{error.text}</p>}
      {setupButton}
    </div>
  )
}

/** `edit-<id>`: the same sheet, opened on Details. */
export function EditClassSheet({ id }: { id: string }) {
  return <ClassSheet id={id} tab="details" />
}

