/**
 * One To decide item (Inbox › To decide): what happened, and the choices for
 * its kind. Nothing changes until an owner taps one; each choice is one
 * request to /api/admin/to-decide.json, recorded with who made it. Afterwards
 * the sheet shows "Done · what was done".
 */
import { useEffect, useMemo, useState } from 'react'
import type { ToDecideItem } from '@pages/api/admin/to-decide.json'
import type { ClassBooking } from '@lib/classes/admin-actions'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { api, BOOKINGS, CLASSES, TO_DECIDE } from '../classes/api'
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
interface Choice { action: string; body?: Record<string, unknown> }

/** Sends one decision; on success the list reloads (the item comes back as Done) and a toast says what was done. */
function useDecide(item: ToDecideItem) {
  const { todo } = useInbox()
  const { bump } = useRefresh()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function send(c: Choice): Promise<{ ok: boolean; data?: any; extra?: Record<string, any> }> {
    setBusy(c.action)
    setError('')
    const r = await api<any>(TO_DECIDE, { id: item.id, action: c.action, ...(c.body ?? {}) })
    setBusy(null)
    if (r.ok && r.data) {
      toast(`Done. ${r.data.decided.what}.`)
      todo.retry()
      bump()
      return { ok: true, data: r.data }
    }
    setError(r.error ?? DIDNT_SAVE)
    if (r.status >= 500 || r.status === 0) toast(DIDNT_SAVE)
    return { ok: false, extra: r.extra }
  }
  return { send, busy, error, setError }
}

const label = (busy: string | null, action: string, idle: string, working: string) => (busy === action ? working : idle)
const kv = (k: string, v: string) => <div className="adm-kv" key={k}><span>{k}</span><span>{v}</span></div>

export function ToDecideSheet({ id }: { id: string }) {
  const { todo } = useInbox()
  if (todo.error && !todo.items) return <SheetFrame title="To decide"><Failed message={todo.error} onRetry={todo.retry} /></SheetFrame>
  if (!todo.items) return <SheetFrame title="To decide"><Skeleton rows={2} /></SheetFrame>
  const t = todo.items.find((x) => x.id === id)
  if (!t) return <SheetFrame title="To decide"><p className="adm-muted">This isn’t in the list any more.</p></SheetFrame>
  if (t.done) {
    return (
      <SheetFrame title={t.title} subtitle="Done">
        <div className="adm-card"><p><b style={{ color: 'var(--color-dark)' }}>{t.head}</b></p></div>
        <div className="adm-panel" style={{ marginTop: '0.75rem' }} role="status">
          <b>{`Done · ${t.done}`}</b>
          {t.doneBy && t.doneAt && <span className="adm-small">{`${t.doneBy}, ${dayAndClock(t.doneAt)}`}</span>}
        </div>
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
  }
}

function Head({ item }: { item: ToDecideItem }) {
  return <div className="adm-card" style={{ marginBottom: '0.75rem' }}><p><b style={{ color: 'var(--color-dark)' }}>{item.head}</b></p></div>
}

function ErrorLine({ text }: { text: string }) {
  return text ? <p className="adm-error" role="alert">{text}</p> : null
}

// ---------------------------------------------------------------- refunds

function OneChoice({ item, note, action, button, working }: { item: ToDecideItem; note: string; action: string; button: string; working: string }) {
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action })}>{label(busy, action, button, working)}</button>}>
      <Head item={item} />
      {kv('Refund', formatMoney((item.detail as Detail).refundCents ?? 0))}
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>{note}</p>
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
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>We asked Square for this refund and never heard back. Look it up in Square, then say what you saw. Nothing is sent to Square from here.</p>
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
  async function free() {
    if (seats.length > 1 && !pick) { setPicking(true); return }
    const r = await send({ action: 'free', body: pick ? { lineIds: [pick] } : {} })
    if (!r.ok && r.extra?.needsPick) setPicking(true)
  }
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={(
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
        <fieldset className="adm-date" style={{ marginTop: '0.75rem' }}>
          <legend>Which seat?</legend>
          {seats.map((s) => (
            <label key={s.lineId} className="adm-check">
              <input type="radio" name={`free-${item.id}`} checked={pick === s.lineId} onChange={() => setPick(s.lineId)} />
              <span>{`Seat ${s.seat} · ${s.label}`}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>Freeing a seat puts it back on sale. It moves no money: the refund already happened in Square.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- counter sales

const STORE_PICK = (c: ScheduledClass) => c.status !== 'cancelled'

function CounterSale({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error, setError } = useDecide(item)
  const toast = useToast()
  const { close } = useSheet()
  const [amount, setAmount] = useState<number | null | undefined>(undefined)
  const [classes, setClasses] = useState<ScheduledClass[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tries, setTries] = useState(0)
  const [classId, setClassId] = useState<string>(d.guessClassId ?? '')
  const [seatKey, setSeatKey] = useState('')
  const [dates, setDates] = useState<string[]>([])
  const [made, setMade] = useState<{ classId: string; seats: { lineId: string; seat: number; named: boolean }[] } | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [naming, setNaming] = useState(false)

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
  const combo = combos.find((c) => c.key === seatKey) ?? combos[0]
  const needsDates = !!combo && (combo.pass.covers.kind === 'choose' || combo.pass.covers.kind === 'remaining')
  const count = combo?.pass.covers.kind === 'choose' ? combo.pass.covers.count : null
  const sessions = cls ? [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso)) : []

  async function match() {
    if (!cls || !combo) return setError('Pick a class.')
    if (needsDates && !dates.length) return setError('Pick the date.')
    if (count && dates.length !== count) return setError(count === 1 ? 'Pick 1 date.' : `Pick ${count} dates.`)
    const r = await send({ action: 'match', body: { classId: cls.id, passId: combo.pass.id, ticketTypeId: combo.ticket.id, ...(needsDates ? { sessionIds: dates } : {}) } })
    if (r.ok && r.data?.seats?.some((s: { named: boolean }) => !s.named)) setMade({ classId: r.data.classId, seats: r.data.seats })
  }
  async function saveNames() {
    if (!made) return
    setNaming(true)
    const r = await api<{ named: number }>(TO_DECIDE, { action: 'names', classId: made.classId, names: made.seats.filter((s) => !s.named).map((s) => ({ lineId: s.lineId, name: names[s.lineId] ?? '' })) })
    setNaming(false)
    if (!r.ok) return setError(r.error ?? DIDNT_SAVE)
    toast(r.data?.named ? `Added ${r.data.named === 1 ? 'a name' : `${r.data.named} names`}.` : 'No names added.')
    close()
  }

  if (made) {
    return (
      <SheetFrame
        title="Who are the seats for?"
        subtitle={cls?.content.name}
        footer={(
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={close}>Skip</button>
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
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSeatKey(''); setDates([]); setError('') }}>
            <option value="">Pick a class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.sessions[0] ? `${c.content.name} · ${dayLabel(localDate(c.sessions[0].startIso))}` : c.content.name}</option>)}
          </select>
        </label>
      )}
      {cls && combos.length > 1 && (
        <label className="adm-fld">
          <span>Which seat?</span>
          <select value={combo?.key ?? ''} onChange={(e) => { setSeatKey(e.target.value); setDates([]) }}>
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
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>Matching adds the seats to the class as a counter sale, even if it’s full. Nothing is charged or refunded.</p>
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
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>The seat was put on the next date for now. It moves to the day you pick, even if that day is full.</p>
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
      if (r.ok && r.data) setBookings(r.data.bookings.filter((b) => b.state !== 'held' && b.state !== 'refunded'))
      else setLoadError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries, item.classId])
  const phones = [...new Set((bookings ?? []).map((b) => b.customer?.phone ?? '').filter(Boolean))]
  const pct = Math.min(100, Math.round((d.booked / Math.max(1, d.count)) * 100))
  return (
    <SheetFrame
      tall
      title={item.title}
      subtitle={item.className}
      footer={(
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'keep-running' })}>{label(busy, 'keep-running', 'Keep it running', 'Saving…')}</button>
          <button type="button" className="adm-btn is-pri" aria-expanded={texting} onClick={() => setTexting(!texting)}>{bookings ? `Text the ${phones.length} booked` : 'Text the people booked'}</button>
        </div>
      )}
    >
      <div className="adm-sum">
        <div><b>{`${d.booked} of ${d.count}`}</b><small>needed to run</small></div>
        <div><b>{dayAndClock(d.decideByIso)}</b><small>decide by</small></div>
      </div>
      <div className="adm-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      {loadError && <Failed message={loadError} onRetry={() => setTries((n) => n + 1)} />}
      {!loadError && !bookings && <Skeleton rows={2} label="Loading who’s booked" />}
      {bookings && bookings.length === 0 && <p className="adm-empty">Nobody is booked yet.</p>}
      {bookings?.map((b) => {
        const seats = Object.values(b.seats).reduce((s, x) => s + x, 0)
        const name = b.customer ? `${b.customer.givenName} ${b.customer.familyName}`.trim() : 'Counter sale, no name yet'
        return kv(name, seats === 1 ? '1 seat' : `${seats} seats`)
      })}
      {texting && (
        <div className="adm-panel" role="group" aria-label="Text the people booked" style={{ marginTop: '0.75rem' }}>
          {phones.length
            ? (
              <>
                <b>{`Text the ${phones.length} ${phones.length === 1 ? 'person' : 'people'} booked`}</b>
                <p className="adm-selectable" aria-label="Phone numbers">{phones.join(', ')}</p>
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => navigator.clipboard?.writeText(phones.join(', ')).then(() => toast('Copied the numbers.'), () => toast('Couldn’t copy. Press and hold the numbers to copy them.'))}>Copy the numbers</button>
                  <a className="adm-btn is-pri" href={smsAll(phones)} onClick={() => { send({ action: 'texted' }) }}>Open Messages</a>
                </div>
              </>
            )
            : <span>Nobody booked has a phone number on file.</span>}
        </div>
      )}
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>Nothing cancels on its own. If you do cancel, do it from the class.</p>
      <button type="button" className="adm-btn is-ghost is-sm" style={{ marginTop: '0.5rem' }} onClick={() => open({ kind: 'class', id: item.classId ?? '' })}>Open the class</button>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

// ---------------------------------------------------------------- door seats

function DoorUnpaid({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame
      title={item.title}
      subtitle="To decide"
      footer={(
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'free' })}>{label(busy, 'free', 'Free the seat', 'Freeing…')}</button>
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'paid' })}>{label(busy, 'paid', 'Mark paid at the counter', 'Saving…')}</button>
        </div>
      )}
    >
      <Head item={item} />
      {kv('Who', d.name || 'No name')}
      {kv('Class', `${item.className} · ${dayLabel(d.day)}`)}
      {kv('Seats', String(d.seats))}
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>They were added at the door to pay at the counter, and no counter sale matched them. If they paid some other way, mark it paid. Freeing the seat takes them off the class list. Nothing is charged or refunded either way.</p>
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
            <button type="button" className="adm-btn is-ghost" disabled={!!busy || !pick} onClick={() => send({ action: 'move', body: { toLineId: pick } })}>{label(busy, 'move', 'It was the person picked', 'Moving…')}</button>
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
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>{others.length ? 'Picking someone else moves the payment to them; the first person shows as not paid yet.' : 'Nobody else had an unpaid seat that day any more.'}</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

