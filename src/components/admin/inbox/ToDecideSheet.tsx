/**
 * One To decide item (Inbox › To decide): what happened, and the choices for
 * its kind. Nothing changes until an owner taps one; each choice is one
 * request to /api/admin/to-decide.json, recorded with who made it. Afterwards
 * the sheet shows "Done · what was done".
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ToDecideItem } from '@pages/api/admin/to-decide.json'
import type { ClassBooking } from '@lib/classes/admin-actions'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { api, BOOKINGS, CLASSES, TO_DECIDE, WAITLIST } from '../classes/api'
import { isComingBooking } from '../classes/labels'
import { localDate } from '@lib/party-slots'
import { dayLabel } from '../classes/dates'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { dayAndClock, dayAndSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { smsAll } from '../sheets/ClassSheet'
import { useInbox } from './InboxData'

type Detail = Record<string, any>
/** What Square shows for an unclear waitlist charge (GET waitlist.json?ask=…, waitlist-runner UnclearAnswer). */
interface UnclearAnswerView { state: string; words: string; cents: number | null; choices: ('add' | 'keep' | 'off')[]; decideFrom: string | null }
interface Choice { action: string; body?: Record<string, unknown>; toast?: string; undo?: boolean }

/**
 * Sends one decision; on success the list reloads (the item comes back as
 * Done) and a toast says what was done. `reload: false` keeps the item on
 * screen for a next step (naming a counter sale's seats); `finish()` reloads
 * after it. A freed seat's toast offers Undo.
 */
function useDecide(item: ToDecideItem) {
  const { todo } = useInbox()
  const { bump } = useRefresh()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const finish = () => { todo.retry(); bump() }
  async function send(c: Choice, opts: { reload?: boolean } = {}): Promise<{ ok: boolean; data?: any; extra?: Record<string, any> }> {
    setBusy(c.action)
    setError('')
    const r = await api<any>(TO_DECIDE, { id: item.id, action: c.action, ...(c.body ?? {}) })
    setBusy(null)
    if (r.ok && r.data) {
      // Undo only when the server says this decision wrote something to take back (a seat already free has none).
      const undo = c.undo && r.data.decided?.undo
        ? () => { api(TO_DECIDE, { id: item.id, action: 'undo' }).then((u) => { if (u.ok) { toast('Undone. The seat is theirs again.'); finish() } else toast(u.error ?? DIDNT_SAVE) }) }
        : undefined
      toast(c.toast ?? `Done. ${r.data.decided.what}.`, undo ? { undo } : undefined)
      if (opts.reload !== false) finish()
      return { ok: true, data: r.data }
    }
    setError(r.error ?? DIDNT_SAVE)
    if (r.status >= 500 || r.status === 0) toast(DIDNT_SAVE)
    return { ok: false, extra: r.extra }
  }
  return { send, busy, error, setError, finish }
}

const label = (busy: string | null, action: string, idle: string, working: string) => (busy === action ? working : idle)
const kv = (k: string, v: string) => <div className="adm-kv" key={k}><span>{k}</span><span>{v}</span></div>

/** "Free the seat?" in the sheet, naming who loses it, before anything is sent. */
function FreeConfirm({ who, seats, busy, onKeep, onFree }: { who: string; seats: number; busy: boolean; onKeep: () => void; onFree: () => void }) {
  return (
    <div className="adm-panel is-warn" role="group" aria-label={`Free ${who}’s seat?`}>
      <b>{`Free ${who}’s ${seats === 1 ? 'seat' : `${seats} seats`}?`}</b>
      <span className="adm-small">{`${who} comes off the class list and the seat goes back on sale. No money moves.`}</span>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onKeep}>Keep it</button>
        <button type="button" className="adm-btn is-danger" disabled={busy} onClick={onFree}>{busy ? 'Freeing…' : 'Free it'}</button>
      </div>
    </div>
  )
}

export function ToDecideSheet({ id }: { id: string }) {
  const { todo } = useInbox()
  if (todo.error && !todo.items) return <SheetFrame title="To decide"><Failed message={todo.error} onRetry={todo.retry} /></SheetFrame>
  if (!todo.items) return <SheetFrame title="To decide"><Skeleton rows={2} /></SheetFrame>
  const t = todo.items.find((x) => x.id === id)
  if (!t) return <SheetFrame title="To decide"><p className="adm-muted">This isn’t in the list any more.</p></SheetFrame>
  if (t.done) {
    return (
      <SheetFrame title={t.title} subtitle="Done">
        <div className="adm-card"><p><b className="adm-dark">{t.head}</b></p></div>
        <div className="adm-panel adm-gap-top" role="status">
          <b>{`Done · ${t.done}`}</b>
          {t.doneBy && t.doneAt && <span className="adm-small">{`${t.doneBy}, ${dayAndClock(t.doneAt)}`}</span>}
        </div>
        {t.classId && <OpenClass id={t.classId} />}
      </SheetFrame>
    )
  }
  switch (t.kind) {
    case 'pos-unmatched': return <CounterSale item={t} />
    case 'refund-plain': return <PlainRefund item={t} />
    case 'refund-failed': return <OneChoice item={t} note="Square couldn’t finish this refund. Check it in Square, then mark it handled." action="handled" button="Mark as handled" working="Saving…" />
    case 'refund-unfinished': return <OneChoice item={t} note="Someone said this refund went through in Square and the money was saved here, but it was never finished. Finishing it marks it done and emails the customer once." action="finish" button="Finish it" working="Finishing…" />
    case 'refund-unconfirmed': return <Unconfirmed item={t} />
    case 'pos-needs-days': return <NeedsDays item={t} />
    case 'below-minimum': return <BelowMinimum item={t} />
    case 'door-unpaid': return <DoorUnpaid item={t} />
    case 'counter-match-check': return <CounterCheck item={t} />
    case 'party-paid-unclear': return <PartyPaidUnclear item={t} />
    case 'paid-not-seated': return <PaidNoSeat item={t} />
    case 'waitlist-unknown': return <WaitlistUnclear item={t} />
    case 'waitlist-declined': return <WaitlistDeclined item={t} />
    case 'waitlist-refund': return <WaitlistRefund item={t} />
    case 'reader-waiting': return <ReaderWaiting item={t} />
    case 'reader-extra': return <ReaderExtra item={t} />
    case 'reader-late': return <ReaderLate item={t} />
    case 'cancel-request': return <CancelRequest item={t} />
    case 'cancel-unclear': return <CancelUnclear item={t} />
  }
}

function OpenClass({ id }: { id: string }) {
  const { open } = useSheet()
  return <button type="button" className="adm-btn is-ghost is-sm adm-gap-top" onClick={() => open({ kind: 'class', id })}>Open the class</button>
}

function Head({ item }: { item: ToDecideItem }) {
  return <div className="adm-card adm-gap-bottom"><p><b className="adm-dark">{item.head}</b></p></div>
}

function ErrorLine({ text }: { text: string }) {
  return text ? <p className="adm-error" role="alert">{text}</p> : null
}

// ---------------------------------------------------------------- refunds

/** A refund on a party (scope 'party'): a way to open that party's sheet (#party-<day>-<id>). */
function OpenParty({ item }: { item: ToDecideItem }) {
  const { open } = useSheet()
  const d = item.detail as Detail
  if (typeof d.partyId !== 'string' || typeof d.partyDay !== 'string') return null
  return (
    <button type="button" className="adm-btn is-ghost is-sm" style={{ marginTop: '0.5rem' }} onClick={() => open({ kind: 'party', day: d.partyDay, id: d.partyId })}>
      Open the party
    </button>
  )
}

function OneChoice({ item, note, action, button, working }: { item: ToDecideItem; note: string; action: string; button: string; working: string }) {
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action })}>{label(busy, action, button, working)}</button>}>
      <Head item={item} />
      {kv('Refund', formatMoney((item.detail as Detail).refundCents ?? 0))}
      <p className="adm-note adm-gap-top">{note}</p>
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function Unconfirmed({ item }: { item: ToDecideItem }) {
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={(
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'did-not-go-through' })}>{label(busy, 'did-not-go-through', 'It didn’t go through', 'Saving…')}</button>
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'went-through' })}>{label(busy, 'went-through', 'It went through', 'Saving…')}</button>
        </div>
      )}
    >
      <Head item={item} />
      {kv('Refund', formatMoney((item.detail as Detail).refundCents ?? 0))}
      <p className="adm-note adm-gap-top">We asked Square for this refund and never heard back. Look it up in Square, then say what you saw. Nothing is sent to Square from here.</p>
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function PartyPaidUnclear({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & { elsewhere?: boolean; cents?: number }
  const { send, busy, error } = useDecide(item)
  if (d.elsewhere) {
    return (
      <OneChoiceParty item={item} note="Square shows this party order paid, and there is nothing here to book it from. Look it up in Square and sort it out there. Nothing is sent to Square from here." send={send} busy={busy} error={error} />
    )
  }
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={(
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'not-paid' })}>{label(busy, 'not-paid', 'It wasn’t paid', 'Saving…')}</button>
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'confirm' })}>{label(busy, 'confirm', 'Confirm the party', 'Confirming…')}</button>
        </div>
      )}
    >
      <Head item={item} />
      {kv('Payment', formatMoney(d.cents ?? 0))}
      <p className="adm-note adm-gap-top">Look for the payment in Square. Confirm the party once Square shows it paid: the time is booked and the host gets their confirmation. If it wasn’t paid, the held time is let go. Nothing is charged or refunded from here.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function OneChoiceParty({ item, note, send, busy, error }: { item: ToDecideItem; note: string } & Pick<ReturnType<typeof useDecide>, 'send' | 'busy' | 'error'>) {
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'sorted' })}>{label(busy, 'sorted', 'Sorted it in Square', 'Saving…')}</button>}>
      <Head item={item} />
      {kv('Payment', formatMoney(((item.detail as { cents?: number }).cents) ?? 0))}
      <p className="adm-note adm-gap-top">{note}</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function PlainRefund({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const seats = (d.seats ?? []) as { lineId: string; seat: number; label: string }[]
  const { send, busy, error } = useDecide(item)
  const [picking, setPicking] = useState(false)
  const [pick, setPick] = useState<string>('')
  const [confirming, setConfirming] = useState(false)
  function free() {
    if (seats.length > 1 && !pick) { setPicking(true); return }
    setConfirming(true)
  }
  async function reallyFree() {
    const r = await send({ action: 'free', body: pick ? { lineIds: [pick] } : {}, toast: `Freed ${d.name}’s seat. It’s back on sale.`, undo: true })
    setConfirming(false)
    if (!r.ok && r.extra?.needsPick) setPicking(true)
  }
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={confirming
        ? <FreeConfirm who={d.name} seats={1} busy={busy === 'free'} onKeep={() => setConfirming(false)} onFree={reallyFree} />
        : (
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'keep' })}>{label(busy, 'keep', 'Keep their seat', 'Saving…')}</button>
            <button type="button" className="adm-btn is-pri" disabled={!!busy || (picking && !pick)} onClick={free}>{label(busy, 'free', picking ? 'Free this seat' : 'Free a seat', 'Freeing…')}</button>
          </div>
        )}
    >
      <Head item={item} />
      {kv('Booking', `${d.name} · ${seats.length === 1 ? '1 seat' : `${seats.length} seats`} · ${item.className}`)}
      {kv('Refunded in Square', formatMoney(d.refundCents ?? 0))}
      {picking && (
        <fieldset className="adm-date adm-gap-top">
          <legend>Which seat?</legend>
          {seats.map((s) => (
            <label key={s.lineId} className="adm-check">
              <input type="radio" name={`free-${item.id}`} checked={pick === s.lineId} onChange={() => setPick(s.lineId)} />
              <span>{`Seat ${s.seat} · ${s.label}`}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="adm-note adm-gap-top">Freeing a seat puts it back on sale. It moves no money: the refund already happened in Square.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- counter sales

const STORE_PICK = (c: ScheduledClass) => c.status !== 'cancelled'

function CounterSale({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError, finish } = useDecide(item)
  const toast = useToast()
  const [amount, setAmount] = useState<number | null | undefined>(undefined)
  const [classes, setClasses] = useState<ScheduledClass[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tries, setTries] = useState(0)
  const [classId, setClassId] = useState<string>(d.guessClassId ?? '')
  // The seat the sold item maps to (its variation, or "One day" in its name); no guess, no default.
  const [seatKey, setSeatKey] = useState<string>(d.guessClassId && d.guessKey ? d.guessKey : '')
  const [dates, setDates] = useState<string[]>([])
  const [made, setMade] = useState<{ classId: string; seats: { lineId: string; seat: number; named: boolean }[] } | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [naming, setNaming] = useState(false)
  // N3: left during the naming step (× or back): the list still reloads, so the item reads Done.
  const pendingFinish = useRef(false)
  const finished = useRef(false)
  pendingFinish.current = !!made && !finished.current
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => () => { if (pendingFinish.current) finishRef.current() }, [])

  useEffect(() => {
    let live = true
    api<{ item: ToDecideItem; amountCents: number | null }>(`${TO_DECIDE}?id=${encodeURIComponent(item.id)}`).then((r) => { if (live) setAmount(r.ok ? r.data?.amountCents ?? null : null) })
    return () => { live = false }
  }, [item.id])
  useEffect(() => {
    let live = true
    setLoadError('')
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString(), to = new Date(Date.now() + 120 * 86_400_000).toISOString()
    api<{ classes: ScheduledClass[] }>(`${CLASSES}?${new URLSearchParams({ from, to })}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setClasses(r.data.classes.filter(STORE_PICK).sort((a, b) => (a.sessions[0]?.startIso ?? '').localeCompare(b.sessions[0]?.startIso ?? '')))
      else setLoadError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries])

  const cls = classes?.find((c) => c.id === classId) ?? null
  const combos = useMemo(() => (cls ? cls.content.passes.flatMap((p) => cls.content.ticketTypes.map((t) => ({ key: `${p.id}:${t.id}`, pass: p, ticket: t }))) : []), [cls])
  const combo = combos.find((c) => c.key === seatKey) ?? (combos.length === 1 ? combos[0] : undefined)
  const needsDates = !!combo && (combo.pass.covers.kind === 'choose' || combo.pass.covers.kind === 'remaining')
  const count = combo?.pass.covers.kind === 'choose' ? combo.pass.covers.count : null
  const sessions = cls ? [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso)) : []

  async function match() {
    if (!cls) return setError('Pick a class.')
    if (!combo) return setError('Pick which seat it was.')
    if (needsDates && !dates.length) return setError('Pick the date.')
    if (count && dates.length !== count) return setError(count === 1 ? 'Pick 1 date.' : `Pick ${count} dates.`)
    // The item stays on screen for "Who are the seats for?"; the list reloads (Done) after that step.
    const r = await send({ action: 'match', body: { classId: cls.id, passId: combo.pass.id, ticketTypeId: combo.ticket.id, ...(needsDates ? { sessionIds: dates } : {}) } }, { reload: false })
    if (!r.ok) return
    if (r.data?.seats?.some((s: { named: boolean }) => !s.named)) setMade({ classId: r.data.classId, seats: r.data.seats })
    else finish()
  }
  async function saveNames() {
    if (!made) return
    setNaming(true)
    const r = await api<{ named: number }>(TO_DECIDE, { action: 'names', classId: made.classId, names: made.seats.filter((s) => !s.named).map((s) => ({ lineId: s.lineId, name: names[s.lineId] ?? '' })) })
    setNaming(false)
    if (!r.ok) return setError(r.error ?? DIDNT_SAVE)
    toast(r.data?.named ? `Added ${r.data.named === 1 ? 'a name' : `${r.data.named} names`}.` : 'No names added.')
    finished.current = true
    pendingFinish.current = false
    finish()
  }

  if (made) {
    return (
      <SheetFrame
        title="Who are the seats for?"
        subtitle={cls?.content.name}
        footer={(
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => { finished.current = true; pendingFinish.current = false; finish() }}>Skip</button>
            <button type="button" className="adm-btn is-pri" disabled={naming} onClick={saveNames}>{naming ? 'Saving…' : 'Add names'}</button>
          </div>
        )}
      >
        <p className="adm-note">The seats are on the class now. Names help at the door; leave any blank.</p>
        {made.seats.filter((s) => !s.named).map((s) => (
          <label key={s.lineId} className="adm-fld"><span>{`Seat ${s.seat}`}</span><input value={names[s.lineId] ?? ''} maxLength={80} placeholder="Name" autoComplete="off" onChange={(e) => setNames({ ...names, [s.lineId]: e.target.value })} /></label>
        ))}
        <ErrorLine text={error} />
      </SheetFrame>
    )
  }

  return (
    <SheetFrame
      tall
      title={item.title}
      subtitle="To decide"
      footer={(
        <div className="adm-stack">
          <button type="button" className="adm-btn is-pri" disabled={!!busy || !cls} onClick={match}>{label(busy, 'match', 'Match to this class', 'Matching…')}</button>
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'dismiss' })}>{label(busy, 'dismiss', 'Not for a class', 'Saving…')}</button>
        </div>
      )}
    >
      <Head item={item} />
      {kv('Rung up', dayAndClock(d.at))}
      {kv('Amount', amount === undefined ? '…' : amount === null ? 'See Square' : formatMoney(amount))}
      {kv('Item', `${d.qty} × ${d.name}`)}
      <p className="adm-lbl">Match to a class</p>
      {loadError && <Failed message={loadError} onRetry={() => setTries((n) => n + 1)} />}
      {!loadError && !classes && <Skeleton rows={1} label="Loading the classes" />}
      {classes && classes.length === 0 && <p className="adm-empty">No classes from the last month or coming up.</p>}
      {classes && classes.length > 0 && (
        <label className="adm-fld">
          <span>Which class?</span>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSeatKey(e.target.value === d.guessClassId && d.guessKey ? d.guessKey : ''); setDates([]); setError('') }}>
            <option value="">Pick a class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.sessions[0] ? `${c.content.name} · ${dayLabel(localDate(c.sessions[0].startIso))}` : c.content.name}</option>)}
          </select>
        </label>
      )}
      {cls && combos.length > 1 && (
        <label className="adm-fld">
          <span>Which seat?</span>
          <select value={combo?.key ?? ''} onChange={(e) => { setSeatKey(e.target.value); setDates([]); setError('') }}>
            {!combo && <option value="">Pick which seat</option>}
            {combos.map((c) => <option key={c.key} value={c.key}>{`${c.pass.label} · ${c.ticket.label}`}</option>)}
          </select>
        </label>
      )}
      {cls && needsDates && (
        <fieldset className="adm-date">
          <legend>{count && count > 1 ? `Which ${count} dates?` : 'Which date?'}</legend>
          {sessions.map((s) => (
            <label key={s.id} className="adm-check">
              <input
                type={count === 1 ? 'radio' : 'checkbox'}
                name={`dates-${item.id}`}
                checked={dates.includes(s.id)}
                onChange={(e) => setDates(count === 1 ? [s.id] : e.target.checked ? [...dates, s.id] : dates.filter((x) => x !== s.id))}
              />
              <span>{dayAndSpan(s.startIso, s.endIso)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {cls && !needsDates && sessions.length > 0 && (
        <p className="adm-small adm-muted">{sessions.length === 1 ? dayAndSpan(sessions[0].startIso, sessions[0].endIso) : `Every date of the class (${sessions.length})`}</p>
      )}
      <p className="adm-note adm-gap-top">Matching adds the seats to the class as a counter sale, even if it’s full. Nothing is charged or refunded.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function NeedsDays({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const sessions = (d.sessions ?? []) as { id: string; startIso: string; endIso: string }[]
  const count: number | null = d.count ?? null
  const { send, busy, error, setError } = useDecide(item)
  const [picked, setPicked] = useState<string[]>(d.current ?? [])
  function save() {
    if (!picked.length) return setError('Pick the day.')
    if (count && picked.length !== count) return setError(count === 1 ? 'Pick 1 day.' : `Pick ${count} days.`)
    send({ action: 'set-days', body: { sessionIds: picked } })
  }
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={save}>{label(busy, 'set-days', 'Save the day', 'Saving…')}</button>}>
      <Head item={item} />
      <fieldset className="adm-date">
        <legend>{count && count > 1 ? `Pick ${count} days` : 'Pick the day'}</legend>
        {sessions.map((s) => (
          <label key={s.id} className="adm-check">
            <input
              type={count === 1 ? 'radio' : 'checkbox'}
              name={`days-${item.id}`}
              checked={picked.includes(s.id)}
              onChange={(e) => { setError(''); setPicked(count === 1 ? [s.id] : e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id)) }}
            />
            <span>{dayAndSpan(s.startIso, s.endIso)}</span>
          </label>
        ))}
      </fieldset>
      <p className="adm-note adm-gap-top">The seat was put on the next date for now. It moves to the day you pick, even if that day is full.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- below minimum

function BelowMinimum({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { open } = useSheet()
  const toast = useToast()
  const { send, busy, error } = useDecide(item)
  const [bookings, setBookings] = useState<ClassBooking[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tries, setTries] = useState(0)
  const [texting, setTexting] = useState(false)
  useEffect(() => {
    let live = true
    setLoadError('')
    api<{ bookings: ClassBooking[] }>(`${BOOKINGS}?id=${encodeURIComponent(item.classId ?? '')}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setBookings(r.data.bookings.filter(isComingBooking)) // R43: a refund that kept the seat is still coming
      else setLoadError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries, item.classId])
  const phones = [...new Set((bookings ?? []).map((b) => b.customer?.phone ?? '').filter(Boolean))]
  return (
    <SheetFrame
      tall
      title={item.title}
      subtitle={item.className}
      footer={(
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'keep-running' })}>{label(busy, 'keep-running', 'Keep it running', 'Saving…')}</button>
          <button type="button" className="adm-btn is-pri" aria-expanded={texting} onClick={() => setTexting(!texting)}>{bookings ? (phones.length === 1 ? 'Text the 1 person booked' : `Text the ${phones.length} people booked`) : 'Text the people booked'}</button>
        </div>
      )}
    >
      <div className="adm-sum">
        <div><b>{`${d.booked} of ${d.count}`}</b><small>needed to run</small></div>
        <div><b>{dayAndClock(d.decideByIso)}</b><small>decide by</small></div>
      </div>
      <progress className="adm-meter" aria-hidden="true" max={Math.max(1, d.count)} value={Math.min(d.booked, d.count)} />
      {loadError && <Failed message={loadError} onRetry={() => setTries((n) => n + 1)} />}
      {!loadError && !bookings && <Skeleton rows={2} label="Loading who’s booked" />}
      {bookings && bookings.length === 0 && <p className="adm-empty">Nobody is booked yet.</p>}
      {bookings?.map((b) => {
        const seats = Object.values(b.seats).reduce((s, x) => s + x, 0)
        const name = b.customer ? `${b.customer.givenName} ${b.customer.familyName}`.trim() : 'Counter sale, no name yet'
        return kv(name, seats === 1 ? '1 seat' : `${seats} seats`)
      })}
      {texting && (
        <div className="adm-panel adm-gap-top" role="group" aria-label="Text the people booked">
          {phones.length
            ? (
              <>
                <b>{`Text the ${phones.length} ${phones.length === 1 ? 'person' : 'people'} booked`}</b>
                <p className="adm-selectable" aria-label="Phone numbers">{phones.join(', ')}</p>
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => navigator.clipboard?.writeText(phones.join(', ')).then(() => toast('Copied the numbers.'), () => toast('Couldn’t copy. Press and hold the numbers to copy them.'))}>Copy the numbers</button>
                  <a className="adm-btn is-pri" href={smsAll(phones)} onClick={() => { send({ action: 'texted', toast: 'Noted: you texted the people booked. It stays here until you decide.' }) }}>Open Messages</a>
                </div>
              </>
            )
            : <span>Nobody booked has a phone number on file.</span>}
        </div>
      )}
      {d.note && <p className="adm-small adm-muted adm-gap-top">{`${d.note.what} · ${d.note.by}, ${dayAndClock(d.note.at)}`}</p>}
      <p className="adm-note adm-gap-top">Nothing cancels on its own. If you do cancel, do it from the class.</p>
      <button type="button" className="adm-btn is-ghost is-sm adm-gap-top" onClick={() => open({ kind: 'class', id: item.classId ?? '' })}>Open the class</button>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- door seats

function DoorUnpaid({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  const [confirming, setConfirming] = useState(false)
  const who = d.name || 'this person'
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={confirming
        ? <FreeConfirm who={who} seats={d.seats} busy={busy === 'free'} onKeep={() => setConfirming(false)} onFree={() => { send({ action: 'free', toast: `Freed ${who}’s ${d.seats === 1 ? 'seat' : 'seats'}.`, undo: true }).then(() => setConfirming(false)) }} />
        : (
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => setConfirming(true)}>{d.seats === 1 ? 'Free the seat' : 'Free the seats'}</button>
            <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'paid' })}>{label(busy, 'paid', 'Mark paid at the counter', 'Saving…')}</button>
          </div>
        )}
    >
      <Head item={item} />
      {kv('Who', d.name || 'No name')}
      {kv('Class', `${item.className} · ${dayLabel(d.day)}`)}
      {kv('Seats', String(d.seats))}
      {d.related && <p className="adm-note adm-gap-top">{d.related}</p>}
      <p className="adm-note adm-gap-top">They were added at the door to pay at the counter, and no counter sale matched them. If they paid some other way, mark it paid. Freeing the seat takes them off the class list. Nothing is charged or refunded either way.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function CounterCheck({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const others = (d.others ?? []) as { lineId: string; name: string }[]
  const { send, busy, error } = useDecide(item)
  const [pick, setPick] = useState('')
  return (
    <SheetFrame
      title={item.title}
      subtitle={item.className}
      footer={(
        <div className="adm-stack">
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'confirm' })}>{label(busy, 'confirm', `Yes, it was ${d.name}`, 'Saving…')}</button>
          {others.length > 0 && (
            <button type="button" className="adm-btn is-ghost" disabled={!!busy || !pick} onClick={() => send({ action: 'move', body: { toLineId: pick } })}>{label(busy, 'move', pick ? `It was ${others.find((o) => o.lineId === pick)?.name}` : 'Pick who it was', 'Moving…')}</button>
          )}
        </div>
      )}
    >
      <Head item={item} />
      {others.length > 0 && (
        <fieldset className="adm-date">
          <legend>Or it was</legend>
          {others.map((o) => (
            <label key={o.lineId} className="adm-check">
              <input type="radio" name={`who-${item.id}`} checked={pick === o.lineId} onChange={() => setPick(o.lineId)} />
              <span>{o.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="adm-note adm-gap-top">{others.length ? `Picking someone else moves the payment to them; ${d.name} then shows as not paid yet. Anyone here also shows under “Not paid at the counter” until it’s sorted.` : 'Nobody else had an unpaid seat that day any more.'}</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}


// ---------------------------------------------------------------- paid online, no seat (R42)

function PaidNoSeat({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame
      title={item.title}
      subtitle={item.className}
      footer={(
        <div className="adm-stack">
          {d.canSeat && (
            <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'seat' })}>
              {label(busy, 'seat', d.seats === 1 ? 'Give them their seat' : 'Give them their seats', 'Adding…')}
            </button>
          )}
          <button type="button" className={`adm-btn ${d.canSeat ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={() => send({ action: 'sorted' })}>
            {label(busy, 'sorted', 'It’s already sorted', 'Saving…')}
          </button>
        </div>
      )}
    >
      <Head item={item} />
      {kv('Paid', formatMoney(d.cents ?? 0))}
      {kv('Seats', String(d.seats ?? 0))}
      {kv('Square order', String(d.orderId ?? ''))}
      <p className="adm-note adm-gap-top">
        {d.canSeat
          ? 'Giving them their seat puts them on the class, paid by this payment, even if the date is full. Already settled it with them another way? Tap It’s already sorted. Nothing is refunded from here.'
          : 'Already settled it with them another way? Tap It’s already sorted. Nothing is refunded from here.'}
      </p>
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- waitlist (stage 4)

function Contact({ d }: { d: Detail }) {
  return (
    <p className="adm-small adm-links adm-gap-top">
      {d.phone && <a href={`tel:${String(d.phone).replace(/[^\d+]/g, '')}`}>{d.phone}</a>}
      {d.email && <a href={`mailto:${d.email}`}>{d.email}</a>}
    </p>
  )
}

/**
 * I5: an unclear waitlist charge, answered here (never the Square dashboard).
 * The sheet asks Square itself (read only) and says what it shows, then
 * offers only what fits: Add them (paid), Keep them waiting / Take them off
 * (no payment, once the charge is 30 minutes old, never resent), or Check
 * again (still going through, or Square isn't answering).
 */
function WaitlistUnclear({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  const [answer, setAnswer] = useState<UnclearAnswerView | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const [sure, setSure] = useState<'keep' | 'off' | null>(null)
  async function ask() {
    if (!item.classId) return
    setAsking(true)
    setAskError('')
    setSure(null)
    const r = await api<{ answer: UnclearAnswerView }>(`${WAITLIST}?id=${encodeURIComponent(item.classId)}&ask=${encodeURIComponent(String(d.entryId))}`)
    setAsking(false)
    if (r.ok && r.data) setAnswer(r.data.answer)
    else setAskError(r.error ?? DIDNT_SAVE)
  }
  useEffect(() => { void ask() }, [item.id])
  const choices = answer?.choices ?? []
  const footer = sure
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={sure === 'keep' ? `Keep ${d.name} waiting?` : `Take ${d.name} off the waitlist?`}>
        <b>{sure === 'keep' ? `Keep ${d.name} waiting?` : `Take ${d.name} off the waitlist?`}</b>
        <span className="adm-small">{sure === 'keep'
          ? 'Their held seat is let go and they stay on the waitlist. That charge is never sent again; if a seat opens later, it’s a new charge.'
          : 'Their held seat is let go, their saved card comes off and they get an email saying so. Nothing is charged.'}</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setSure(null)}>Not yet</button>
          <button type="button" className={`adm-btn ${sure === 'off' ? 'is-danger' : 'is-pri'}`} disabled={!!busy} onClick={() => send({ action: sure }).then((r) => { if (!r.ok) void ask() })}>
            {sure === 'keep' ? label(busy, 'keep', 'Keep them waiting', 'Saving…') : label(busy, 'off', 'Take them off', 'Taking off…')}
          </button>
        </div>
      </div>
    )
    : (
      <div className="adm-stack">
        {choices.includes('add') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'add' }).then((r) => { if (!r.ok) void ask() })}>{label(busy, 'add', 'Add them', 'Adding…')}</button>}
        {choices.includes('keep') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => setSure('keep')}>Keep them waiting</button>}
        {choices.includes('off') && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => setSure('off')}>Take them off</button>}
        <button type="button" className={`adm-btn ${choices.length ? 'is-ghost' : 'is-pri'}`} disabled={asking || !!busy} onClick={ask}>{asking ? 'Asking Square…' : 'Check Square again'}</button>
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {d.cents ? kv('Charge', formatMoney(d.cents)) : null}
      {kv('Card', `ending ${d.last4}`)}
      <div className="adm-panel adm-gap-top" role="status" aria-live="polite" data-testid="waitlist-square-answer">
        <b>{asking && !answer ? 'Asking Square…' : answer?.words ?? (askError ? 'We couldn’t ask Square just now.' : 'Asking Square…')}</b>
        {answer?.state === 'paid' && <span className="adm-small">Add them puts them in the class with the seat they’re holding and sends them the “You’re in” email and text. If you’d rather not keep them, refund them from the class sheet afterwards.</span>}
      </div>
      <p className="adm-note adm-gap-top">Check Square again only asks; it never charges anyone. While the waitlist is open, the 10-minute check may send this same charge once more if Square never got it. Square never takes the same charge twice.</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error || askError} />
    </SheetFrame>
  )
}

function WaitlistDeclined({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'seen' })}>{label(busy, 'seen', 'Got it', 'Saving…')}</button>}>
      <Head item={item} />
      <p className="adm-note adm-gap-top">Nothing was charged and their card is off file. You can call or text them if you’d like to help them book.</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** R4: the waitlist charged someone just as their class was cancelled: Refund them (frees the seat), or It's already sorted. Each asks first. */
function WaitlistRefund({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError } = useDecide(item)
  const [sure, setSure] = useState<null | 'refund' | 'sorted'>(null)
  const amount = d.cents ? formatMoney(d.cents) : 'their payment'
  const footer = sure
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={sure === 'refund' ? `Refund ${d.name}?` : 'Already sorted?'}>
        <b>{sure === 'refund' ? `Refund ${d.name} ${amount}?` : 'Already sorted?'}</b>
        <span className="adm-small">{sure === 'refund'
          ? `It goes back to their card ending ${d.last4}${d.email ? ' and they get a refund email' : ''}. Square never refunds it twice.`
          : 'Only if you already refunded them from the class sheet or settled it another way. Nothing is refunded here.'}</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setSure(null)}>Not yet</button>
          {sure === 'refund'
            ? <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'refund' })}>{label(busy, 'refund', 'Refund them', 'Refunding…')}</button>
            : <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'sorted' })}>{label(busy, 'sorted', 'It’s already sorted', 'Saving…')}</button>}
        </div>
      </div>
    )
    : (
      <div className="adm-stack">
        <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => { setSure('refund'); setError('') }}>Refund them</button>
        <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => { setSure('sorted'); setError('') }}>It’s already sorted</button>
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {d.cents ? kv('Charge', formatMoney(d.cents)) : null}
      <p className="adm-note adm-gap-top">They weren’t told they’re in. Refund them, then call or text them if you like.</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/**
 * Stage 4: a "Charge on the reader" sale that never came back from the Square
 * app: Ask Square seats them when Square shows the payment; Let the seat go
 * asks Square first and is refused when it shows paid. R1: Square showed a
 * payment that didn't match: Keep it (they paid $X; a shortfall is confirmed
 * by its amount) or Refund it and let the seat go. Square is read again first
 * either way. Only the choices that fit show.
 */
function ReaderWaiting({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError } = useDecide(item)
  const [sure, setSure] = useState<null | 'let-go' | 'refund' | 'keep'>(null)
  const [short, setShort] = useState<{ paidCents: number; askedCents: number; shortCents: number } | null>(null)
  const choices: string[] = Array.isArray(d.choices) ? d.choices : ['check', 'let-go']
  const paid = typeof d.paidCents === 'number' ? d.paidCents : null
  const keepLabel = paid !== null ? `Keep it, they paid ${formatMoney(paid)}` : 'Keep it'
  async function keep(confirmPaidCents?: number) {
    const r = await send({ action: 'keep', ...(confirmPaidCents !== undefined ? { body: { confirmPaidCents } } : {}) })
    if (!r.ok && r.extra?.short) { setShort(r.extra.short); setSure('keep'); setError('') }
  }
  const panel = (label: string, text: string, keepIt: string, go: ReactNode) => (
    <div className="adm-panel is-warn" role="group" aria-label={label}>
      <b>{label}</b>
      <span className="adm-small">{text}</span>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={() => { setSure(null); setShort(null) }}>{keepIt}</button>
        {go}
      </div>
    </div>
  )
  const footer = sure === 'let-go'
    ? panel('Let the seat go?', `Square is asked first. If it shows the payment, ${d.name} keeps the seat. If not, the seat goes back on sale. Nothing is refunded or charged.`, 'Keep it held',
      <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'let-go' })}>{label(busy, 'let-go', 'Let the seat go', 'Asking Square…')}</button>)
    : sure === 'refund'
      ? panel(`Refund ${d.name}${paid !== null ? ` ${formatMoney(paid)}` : ''}?`, `Square is checked first. The whole payment goes back to their card${d.email ? ' and they get a refund email' : ''}, and the seat goes back on sale. Square never refunds it twice.`, 'Not yet',
        <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'refund' })}>{label(busy, 'refund', 'Refund it', 'Refunding…')}</button>)
      : sure === 'keep' && short
        ? panel(`Keep ${formatMoney(short.paidCents)}?`, `Square shows ${formatMoney(short.paidCents)} paid, ${formatMoney(short.shortCents)} less than the ${formatMoney(short.askedCents)} seat. Keeping it marks the seat paid with ${formatMoney(short.paidCents)}. A refund later can give back at most that.`, 'Not yet',
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => keep(short.paidCents)}>{label(busy, 'keep', `Keep ${formatMoney(short.paidCents)}`, 'Saving…')}</button>)
        : (
          <div className="adm-stack">
            {choices.includes('keep') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => keep()}>{label(busy, 'keep', keepLabel, 'Checking Square…')}</button>}
            {choices.includes('refund') && <button type="button" className={`adm-btn ${choices.includes('keep') ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={() => { setSure('refund'); setError('') }}>Refund it and let the seat go</button>}
            {choices.includes('check') && <button type="button" className={`adm-btn ${choices.includes('refund') ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={() => send({ action: 'check' })}>{label(busy, 'check', 'Ask Square', 'Asking Square…')}</button>}
            {choices.includes('let-go') && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => { setSure('let-go'); setError('') }}>Let the seat go</button>}
          </div>
        )
  const money = choices.includes('refund')
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {kv('Asked', formatMoney(d.cents))}
      {paid !== null && kv('Square shows', formatMoney(paid))}
      {d.by && kv('Sold by', String(d.by))}
      <p className="adm-note adm-gap-top">{money
        ? choices.includes('keep')
          ? 'Keep it marks the seat paid with what Square shows. Refund it sends the whole payment back to their card and lets the seat go. Square is checked first either way.'
          : 'This payment was split between a gift card and a card, which the website can’t keep: a refund later couldn’t go back on one payment. Refund it, then charge them again with Pay on the iPad.'
        : d.offline
          ? 'Square took this payment while the iPad was offline. It shows up once the iPad is back online. Ask Square then.'
          : 'Ask Square looks for this payment in Square. If it went through, the seat is marked paid. Nobody is charged twice.'}</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** R2: a second reader payment (or one with no seat): Refund it, or It's already sorted. Each asks in the sheet first. */
function ReaderExtra({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError } = useDecide(item)
  const [sure, setSure] = useState<null | 'refund' | 'sorted'>(null)
  const amount = d.cents ? formatMoney(d.cents) : 'this payment'
  const footer = sure
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={sure === 'refund' ? `Refund ${amount}?` : `Clear this ${amount} payment?`}>
        <b>{sure === 'refund' ? `Refund ${amount} to ${d.name}?` : `Clear this ${amount} payment?`}</b>
        <span className="adm-small">{sure === 'refund'
          ? `Square is checked first. The whole payment goes back to their card${d.email ? ' and they get a refund email' : ''}. Their seat stays as it is. Square never refunds it twice.`
          : 'Only if you’ve already settled it with them another way. Nothing is refunded.'}</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setSure(null)}>Not yet</button>
          {sure === 'refund'
            ? <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'refund' })}>{label(busy, 'refund', 'Refund it', 'Refunding…')}</button>
            : <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'sorted' })}>{label(busy, 'sorted', 'It’s already sorted', 'Saving…')}</button>}
        </div>
      </div>
    )
    : (
      <div className="adm-stack">
        <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => { setSure('refund'); setError('') }}>Refund it</button>
        {!d.refundStarted && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => { setSure('sorted'); setError('') }}>It’s already sorted</button>}
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {d.cents ? kv('Payment', formatMoney(d.cents)) : null}
      <p className="adm-note adm-gap-top">{d.refundStarted
        ? 'A refund of this payment was already sent. Refund it finishes that same refund; Square never refunds it twice.'
        : 'Refund it sends the payment back to their card. Already settled another way? Tap It’s already sorted.'}</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** R3: a reader payment came in late (after Let go, or after its hold ran out): Keep them, or Refund and free the seat. */
function ReaderLate({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError } = useDecide(item)
  const [sure, setSure] = useState(false)
  const footer = sure
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={`Refund ${d.name}?`}>
        <b>{`Refund ${d.name} ${formatMoney(d.cents ?? 0)} and free the seat?`}</b>
        <span className="adm-small">{`The payment goes back to their card${d.email ? ' and they get a refund email' : ''}, and their seat goes back on sale. Square never refunds it twice.`}</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setSure(false)}>Not yet</button>
          <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'refund' })}>{label(busy, 'refund', 'Refund and free the seat', 'Refunding…')}</button>
        </div>
      </div>
    )
    : (
      <div className="adm-stack">
        <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'keep' })}>{label(busy, 'keep', 'Keep them', 'Saving…')}</button>
        <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => { setSure(true); setError('') }}>Refund and free the seat</button>
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {kv('Paid', formatMoney(d.cents ?? 0))}
      <p className="adm-note adm-gap-top">{d.overCapacity ? 'The class has one more person than its capacity. Keep them if there’s room at the table.' : 'Keep them if they should have the seat.'}</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- customers' own cancels (D2)

/**
 * D2: a customer asked to cancel from their "Can't make it?" page (inside 48
 * hours, a gift seat, paid at the studio…). Catherine picks: refund and free
 * the seat (Square's refund, their refund email), free the seat with no
 * refund, or keep their booking. Each asks in the sheet first.
 */
function CancelRequest({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  const [sure, setSure] = useState<null | 'refund' | 'free'>(null)
  const seats = d.seats === 1 ? 'seat' : `${d.seats} seats`
  const footer = sure
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={sure === 'refund' ? `Refund ${d.name}?` : `Free ${d.name}’s ${seats}?`}>
        <b>{sure === 'refund' ? `Refund ${formatMoney(d.refundCents ?? 0)} and free ${d.name}’s ${seats}?` : `Free ${d.name}’s ${seats} with no refund?`}</b>
        <span className="adm-small">{sure === 'refund'
          ? 'The money goes back to their card and they get the refund email. The seat goes back on sale (and the waitlist runs).'
          : 'They come off the class list and the seat goes back on sale. No money moves and nothing is sent to them, so tell them what you decided.'}</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setSure(null)}>Not yet</button>
          <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: sure, undo: sure === 'free' })}>
            {sure === 'refund' ? label(busy, 'refund', 'Refund and free the seat', 'Refunding…') : label(busy, 'free', 'Free the seat, no refund', 'Freeing…')}
          </button>
        </div>
      </div>
    )
    : (
      <div className="adm-stack">
        {d.canRefund && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => setSure('refund')}>Refund and free the seat</button>}
        <button type="button" className={`adm-btn ${d.canRefund ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={() => setSure('free')}>Free the seat, no refund</button>
        <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'keep' })}>{label(busy, 'keep', 'Keep their booking', 'Saving…')}</button>
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {d.canRefund ? kv('Refund would be', formatMoney(d.refundCents ?? 0)) : null}
      {d.why && <p className="adm-small adm-gap-top">{`What their page told them: ${d.why}`}</p>}
      <p className="adm-note adm-gap-top">
        {d.canRefund
          ? 'Our policy inside 48 hours is studio credit or a free seat transfer, but you can refund if you’d like. Keep their booking if you’re giving credit or moving them, then call or text them.'
          : d.source === 'comp'
            ? 'This seat was a gift, so there’s no money to refund. Free the seat to give it to someone else, or keep it.'
            : 'This was paid at the studio, so any refund goes back at the register. Free the seat here once that’s done, or keep their booking.'}
      </p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/**
 * D2: a customer cancelled online and Square didn't answer the refund (their
 * seats are held), or turned it down. Ask Square sends the very same refund
 * request again (Square never makes it twice): it finishes the cancel when
 * Square shows the refund. A turned-down one can be tried again, or seen.
 */
function CancelUnclear({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  const turned = d.state === 'turned-down'
  return (
    <SheetFrame
      title={item.title}
      subtitle={item.className}
      footer={(
        <div className="adm-stack">
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'ask' })}>{label(busy, 'ask', turned ? 'Try the refund again' : 'Ask Square', 'Asking Square…')}</button>
          {turned && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'seen' })}>{label(busy, 'seen', 'Got it', 'Saving…')}</button>}
        </div>
      )}
    >
      <Head item={item} />
      {kv('Refund', formatMoney(d.cents ?? 0))}
      <p className="adm-note adm-gap-top">{turned
        ? 'Try the refund again sends it to Square once more. Or call them, and tap Got it to leave them booked.'
        : 'Ask Square sends the same refund request again. If Square already made it, it hands that one back, so nobody is refunded twice. Once it’s through, their seats go back on sale and they get the refund email.'}</p>
      <Contact d={d} />
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}
