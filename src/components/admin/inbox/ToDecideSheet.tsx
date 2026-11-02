/**
 * One To decide item (Inbox › To decide): what happened, and the choices for
 * its kind. Nothing changes until an owner taps one; each choice is one
 * request to /api/admin/to-decide.json, recorded with who made it. Afterwards
 * the sheet shows "Done · what was done".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AskAnswer, ToDecideItem } from '@pages/api/admin/to-decide.json'
import type { ClassBooking } from '@lib/classes/admin-actions'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { api, BOOKINGS, CLASSES, TO_DECIDE } from '../classes/api'
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
    // The item changed under her (Square showed a refund): the list reloads so it shows what Square did.
    if (r.extra?.reload) finish()
    return { ok: false, extra: r.extra }
  }
  /** "Ask Square": read only, nothing decided; the answer stays on the sheet. */
  async function ask(): Promise<AskAnswer | null> {
    setBusy('ask')
    setError('')
    const r = await api<any>(TO_DECIDE, { id: item.id, action: 'ask' })
    setBusy(null)
    if (r.ok && r.data?.asked) return r.data.asked as AskAnswer
    setError(r.error ?? 'Square couldn’t be asked just now. Try again in a minute.')
    return null
  }
  return { send, busy, error, setError, finish, ask }
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
    case 'refund-failed': return <FailedRefund item={t} />
    case 'refund-unfinished': return <OneChoice item={t} note="Someone said this refund went through in Square and the money was saved here, but it was never finished. Finishing it marks it done and emails the customer once." action="finish" button="Finish it" working="Finishing…" />
    case 'refund-unconfirmed': return <Unconfirmed item={t} />
    case 'pos-needs-days': return <NeedsDays item={t} />
    case 'below-minimum': return <BelowMinimum item={t} />
    case 'door-unpaid': return <DoorUnpaid item={t} />
    case 'counter-match-check': return <CounterCheck item={t} />
    case 'party-paid-unclear': return <PartyPaidUnclear item={t} />
    case 'paid-not-seated': return <PaidNoSeat item={t} />
    case 'party-not-told': return <PartyNotTold item={t} />
    case 'party-payment-unclear': return <PartyPaymentUnclear item={t} />
    case 'party-no-confirmation': return <PartyNoConfirmation item={t} />
    case 'party-hold-orphan': return <PartyHoldOrphan item={t} />
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

/** What Square said, shown on the sheet after Ask Square. */
function Asked({ answer }: { answer: AskAnswer }) {
  return (
    <div className={`adm-panel adm-gap-top${answer.state === 'failed' || answer.state === 'none' ? ' is-warn' : ''}`} role="status">
      <b>{answer.title ? answer.title : answer.state === 'done' ? 'Square shows it went through' : answer.state === 'pending' ? 'Square shows it still going through' : answer.state === 'failed' ? 'Square shows it failed' : 'Square shows no refund'}</b>
      <span className="adm-small">{answer.message}</span>
    </div>
  )
}

/** "Try the refund again?" naming the amount, before anything is sent. */
function RetryConfirm({ amount, same, busy, onKeep, onGo }: { amount: string; same: boolean; busy: boolean; onKeep: () => void; onGo: () => void }) {
  return (
    <div className="adm-panel is-warn" role="group" aria-label={`Try the ${amount} refund again?`}>
      <b>{`Try the ${amount} refund again?`}</b>
      <span className="adm-small">{same
        ? 'The same request goes to Square again, so it can never refund twice.'
        : `Square is asked for a new ${amount} refund on the same payment. Tapping twice never refunds twice.`}</span>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onKeep}>Keep it</button>
        <button type="button" className="adm-btn is-danger" disabled={busy} onClick={onGo}>{busy ? 'Refunding…' : 'Try the refund again'}</button>
      </div>
    </div>
  )
}

/** A refund with no answer from Square: Ask Square first, then only the buttons that fit what Square shows. */
function Unconfirmed({ item }: { item: ToDecideItem }) {
  const { send, busy, error, setError, ask } = useDecide(item)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [retrying, setRetrying] = useState(false)
  const amount = formatMoney((item.detail as Detail).refundCents ?? 0)
  const next = answer?.next ?? []
  const footer = retrying
    ? <RetryConfirm amount={amount} same={answer?.state === 'none'} busy={busy === 'retry'} onKeep={() => { setRetrying(false); setError('') }} onGo={() => send({ action: 'retry' })} />
    : (
      <div className="adm-stack">
        {next.includes('went-through') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'went-through' })}>{label(busy, 'went-through', 'It went through', 'Recording…')}</button>}
        {next.includes('retry') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => { setRetrying(true); setError('') }}>Try the refund again</button>}
        {next.includes('did-not-go-through') && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'did-not-go-through' })}>{label(busy, 'did-not-go-through', 'It didn’t go through', 'Saving…')}</button>}
        <button type="button" className={`adm-btn ${answer ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={async () => setAnswer(await ask())}>{label(busy, 'ask', answer ? 'Ask Square again' : 'Ask Square', 'Asking Square…')}</button>
      </div>
    )
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={footer}>
      <Head item={item} />
      {kv('Refund', amount)}
      <p className="adm-note adm-gap-top">We asked Square for this refund and never heard back. Tap Ask Square: it reads the payment and shows what Square did, then the right next step. Nothing is sent until you choose.</p>
      {answer && <Asked answer={answer} />}
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** A refund Square failed after we recorded it: Ask Square, then Try the refund again or Mark as handled (with a reason). */
function FailedRefund({ item }: { item: ToDecideItem }) {
  const { send, busy, error, setError, ask } = useDecide(item)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [mode, setMode] = useState<null | 'retry' | 'handled'>(null)
  const [why, setWhy] = useState('')
  const amount = formatMoney((item.detail as Detail).refundCents ?? 0)
  const next = answer?.next ?? []
  const keep = () => { setMode(null); setError('') }
  const footer = mode === 'retry'
    ? <RetryConfirm amount={amount} same={false} busy={busy === 'retry'} onKeep={keep} onGo={() => send({ action: 'retry' })} />
    : mode === 'handled'
      ? (
        <div className="adm-panel" role="group" aria-label="Mark as handled">
          <label className="adm-fld"><span>What happened? (for the record)</span><input value={why} maxLength={200} placeholder="Gave cash back at the counter" autoComplete="off" onChange={(e) => setWhy(e.target.value)} /></label>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={keep}>Back</button>
            <button type="button" className="adm-btn is-pri" disabled={!!busy || !why.trim()} onClick={() => send({ action: 'handled', body: { reason: why.trim() } })}>{label(busy, 'handled', 'Mark as handled', 'Saving…')}</button>
          </div>
        </div>
      )
      : (
        <div className="adm-stack">
          {next.includes('retry') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => { setMode('retry'); setError('') }}>Try the refund again</button>}
          <button type="button" className={`adm-btn ${answer ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={async () => setAnswer(await ask())}>{label(busy, 'ask', answer ? 'Ask Square again' : 'Ask Square', 'Asking Square…')}</button>
          <button type="button" className="adm-quiet" disabled={!!busy} onClick={() => { setMode('handled'); setError('') }}>Mark as handled</button>
        </div>
      )
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={footer}>
      <Head item={item} />
      {kv('Refund', amount)}
      <p className="adm-note adm-gap-top">Square couldn’t finish this refund. Tap Ask Square to see what it shows now. If it failed, Try the refund again sends it once more. If you settled it another way, Mark as handled and say how.</p>
      {answer && <Asked answer={answer} />}
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

function PartyPaidUnclear({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & { elsewhere?: boolean; cents?: number; why?: string | null }
  const { send, busy, error } = useDecide(item)
  if (d.elsewhere) return <PartyPaidElsewhere item={item} />
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
      <p className="adm-note adm-gap-top">Both choices ask Square first and act only on what it shows. Confirm the party works once Square shows the payment: the time is booked and the host gets their confirmation. It wasn’t paid works only when Square shows no payment, and lets the held time go. Nothing is charged or refunded from here.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** "Refund $X to <name>?": names who and how much before anything is sent. `email`: only then does it promise a refund email. */
function RefundConfirm({ amount, who, first, email, busy, onKeep, onGo }: { amount: string; who: string; first: string; email: boolean; busy: boolean; onKeep: () => void; onGo: () => void }) {
  return (
    <div className="adm-panel is-warn" role="group" aria-label={`Refund ${amount} to ${who}?`}>
      <b>{`Refund ${amount} to ${who}?`}</b>
      <span className="adm-small">{`It goes back to their card${email ? `, and ${first || 'they'} ${first ? 'gets' : 'get'} a refund email` : ' (no email on file, so nobody is emailed)'}. Tapping twice never refunds twice.`}</span>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onKeep}>Keep it</button>
        <button type="button" className="adm-btn is-danger" disabled={busy} onClick={onGo}>{busy ? 'Refunding…' : `Refund ${amount}`}</button>
      </div>
    </div>
  )
}

/** "Clear this $X payment?": It's already sorted clears a money item, so it is confirmed first. */
function SortConfirm({ amount, back, busy, onKeep, onGo }: { amount: string; back: boolean; busy: boolean; onKeep: () => void; onGo: () => void }) {
  return (
    <div className="adm-panel is-warn" role="group" aria-label={`Clear this ${amount} payment?`}>
      <b>{`Clear this ${amount} payment?`}</b>
      <span className="adm-small">{back ? 'Square already refunded it. Clearing it notes who cleared it and when.' : 'Nothing is refunded. Use it only when it was settled another way. It notes who cleared it and when.'}</span>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onKeep}>Keep it</button>
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={onGo}>{busy ? 'Saving…' : 'Clear it'}</button>
      </div>
    </div>
  )
}

/**
 * "Party payment to check" (paid elsewhere, DV12): money Square took on a party order that is on no party.
 * Refund it (exactly what Square shows left on that payment, through the refund runner, after a confirm
 * naming who and how much), or, when the party still owes at least that much and nothing went back, put it
 * toward the party (recorded here, no Square call). Both read Square first. A refund started with no answer
 * from Square is finished with Refund it (the same request); Square having refunded it leaves It's already sorted.
 */
function PartyPaidElsewhere({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & {
    cents?: number; why?: string | null; name?: string; email?: string; canApply?: boolean; dueCents?: number
    refundStarted?: boolean; startedCents?: number | null; backCents?: number; leftCents?: number; canRefund?: boolean; canSort?: boolean
  }
  const { send, busy, error, setError } = useDecide(item)
  const [asking, setAsking] = useState<null | 'refund' | 'apply' | 'sorted'>(null)
  const cents = d.cents ?? 0
  const back = d.backCents ?? 0
  const refundCents = d.refundStarted ? (d.startedCents ?? cents) : (d.leftCents ?? cents)
  const amount = formatMoney(cents)
  const refundAmount = formatMoney(refundCents)
  const named = (d.name ?? '').trim()
  const who = named || 'the customer'
  const first = named ? named.split(/\s+/)[0] : ''
  const theirs = first ? `${first}’s` : 'the'
  const canRefund = d.canRefund !== false
  const canSort = d.canSort !== false
  const note = d.refundStarted
    ? `A refund of ${refundAmount} was sent to Square and it never answered. Tap Refund it: the same request goes again, so it can never refund twice.`
    : back >= cents && cents > 0
      ? `Square already refunded this ${amount}, so nothing more is owed back. Tap It’s already sorted to clear it.`
      : back > 0
        ? `Square shows ${formatMoney(back)} of this ${amount} already refunded, so ${refundAmount} is left. Refund the rest, or tap It’s already sorted if that settles it.`
        : d.why === 'other-payment'
          ? d.canApply
            ? `Square shows ${amount} paid on ${theirs} party from another order (an older link or a second try), so it isn’t on the party yet. The party still owes ${formatMoney(d.dueCents ?? 0)}: put it toward that, or refund it.`
            : `Square shows ${amount} paid on ${theirs} party, but the party was already paid by another order, so this payment isn’t on the party. Refund it to give it back.`
          : d.why === 'retired'
            ? `Square shows ${amount} paid on an earlier try that ${first || 'the customer'} changed and started again, so it isn’t booked. If they paid twice, refund it.`
            : `Square shows ${amount} paid for a party, but there is nothing here to book it from. Refund it to give it back.`
  const keep = () => { setAsking(null); setError('') }
  const footer = asking === 'refund'
    ? <RefundConfirm amount={refundAmount} who={who} first={first} email={!!d.email} busy={busy === 'refund'} onKeep={keep} onGo={() => send({ action: 'refund', body: { cents: refundCents } })} />
    : asking === 'sorted'
      ? <SortConfirm amount={amount} back={back > 0} busy={busy === 'sorted'} onKeep={keep} onGo={() => send({ action: 'sorted' })} />
      : asking === 'apply'
        ? (
          <div className="adm-panel is-warn" role="group" aria-label={`Put ${amount} toward ${theirs} party?`}>
            <b>{`Put ${amount} toward ${theirs} party?`}</b>
            <span className="adm-small">{`It’s recorded as paid on the party${typeof d.dueCents === 'number' ? `, which owes ${formatMoney(d.dueCents)} now` : ''}. No money moves and nothing is sent to ${first || 'the host'}.`}</span>
            <div className="adm-two">
              <button type="button" className="adm-btn is-ghost" onClick={keep}>Keep it</button>
              <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'apply' })}>{label(busy, 'apply', 'Put it toward the party', 'Saving…')}</button>
            </div>
          </div>
        )
        : (
          <div className="adm-stack">
            {(d.canApply || canRefund) && (
              <div className="adm-two">
                {d.canApply && <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking('apply'); setError('') }}>Put it toward the party</button>}
                {canRefund && <button type="button" className="adm-btn is-pri" onClick={() => { setAsking('refund'); setError('') }}>{back > 0 && !d.refundStarted ? 'Refund the rest' : 'Refund it'}</button>}
              </div>
            )}
            {canSort && <button type="button" className={canRefund ? 'adm-quiet' : 'adm-btn is-pri'} disabled={!!busy} onClick={() => { setAsking('sorted'); setError('') }}>It’s already sorted</button>}
          </div>
        )
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={footer}>
      <Head item={item} />
      {kv('Payment', amount)}
      {back > 0 && kv('Refunded in Square', formatMoney(back))}
      {typeof d.dueCents === 'number' && kv('The party owes', formatMoney(d.dueCents))}
      <p className="adm-note adm-gap-top">{note}</p>
      {canSort && canRefund && <p className="adm-note">Already settled another way? Tap It’s already sorted to clear this.</p>}
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** A host who hasn't been told about a change (DV8): open the party to email them, or say they were told. */
function PartyNotTold({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & { cancelled?: boolean; phone?: string }
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'told', toast: 'Noted that they’ve been told.' })}>{label(busy, 'told', 'I told them', 'Saving…')}</button>}>
      <Head item={item} />
      <p className="adm-note">{d.cancelled
        ? 'Call or text them. Once they know, tap I told them. It notes who told them and when.'
        : 'Open the party to email them the new details and a calendar invite. If you called or texted instead, tap I told them.'}</p>
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** A payment on a booked party (link, or a card taken here) that Square never answered: Ask Square, then only the buttons that fit. */
function PartyPaymentUnclear({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & { cents?: number; until?: string }
  const { send, busy, error, ask } = useDecide(item)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const next = answer?.next ?? []
  const footer = (
    <div className="adm-stack">
      {next.includes('went-through') && <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'went-through' })}>{label(busy, 'went-through', 'It went through', 'Recording…')}</button>}
      {next.includes('did-not-go-through') && <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => send({ action: 'did-not-go-through' })}>{label(busy, 'did-not-go-through', 'It didn’t go through', 'Saving…')}</button>}
      <button type="button" className={`adm-btn ${answer ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={async () => setAnswer(await ask())}>{label(busy, 'ask', answer ? 'Ask Square again' : 'Ask Square', 'Asking Square…')}</button>
    </div>
  )
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={footer}>
      <Head item={item} />
      {kv('Payment', formatMoney(d.cents ?? 0))}
      {typeof d.orderId === 'string' && d.orderId && <SquareOrder id={d.orderId} />}
      <p className="adm-note adm-gap-top">
        Tap Ask Square: it looks up this payment and shows what Square did, then the right next step. It went through records the payment on the party (the host gets their email once). It didn’t go through lets a new payment start. Nothing is charged or refunded from here.
      </p>
      {answer && <Asked answer={answer} />}
      {d.until && <p className="adm-small">{`Until then, Move, Cancel and new payments on this party wait. If nobody decides, it clears on ${dayAndClock(d.until)} and the next payment asks Square first.`}</p>}
      <OpenParty item={item} />
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** The Square order id in its own row, with Copy: only an aid (say, on a call with Square), never a step. */
function SquareOrder({ id }: { id: string }) {
  const toast = useToast()
  return (
    <div className="adm-kv">
      <span>Square order</span>
      <span>
        <span className="adm-small" style={{ wordBreak: 'break-all' }}>{id}</span>{' '}
        <button type="button" className="adm-quiet" onClick={() => navigator.clipboard?.writeText(id).then(() => toast('Copied the order number.'), () => toast('Couldn’t copy. Press and hold the number to copy it.'))}>Copy</button>
      </span>
    </div>
  )
}

/**
 * A party time held with no party on it: "Free this time", confirmed in the sheet first. The server
 * refuses while it could still be a booking being paid (a hold younger than the checkout window, or a
 * payment attached to it).
 */
function PartyHoldOrphan({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & { startIso?: string; endIso?: string }
  const { send, busy, error, setError } = useDecide(item)
  const [asking, setAsking] = useState(false)
  const when = d.startIso ? (d.endIso ? dayAndSpan(d.startIso, d.endIso) : dayAndClock(d.startIso)) : ''
  const footer = asking
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={`Free ${when}?`}>
        <b>{`Free ${when} so others can book it?`}</b>
        <span className="adm-small">No party is on this time, so nobody is told and no money moves. If it was a booking still being paid, it isn’t freed.</span>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setError('') }}>Keep it</button>
          <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => send({ action: 'free' })}>{label(busy, 'free', 'Free this time', 'Freeing…')}</button>
        </div>
      </div>
    )
    : <button type="button" className="adm-btn is-pri" onClick={() => setAsking(true)}>Free this time</button>
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={footer}>
      <Head item={item} />
      {when && kv('Held', when)}
      <p className="adm-note adm-gap-top">This time is held in the party calendar, but there is no party on it to open. It can happen when a booking stopped halfway. Freeing it lets others book the time. It only works once the hold is more than a few minutes old and no payment is waiting on it, so a booking still being paid is never freed.</p>
      <ErrorLine text={error} />
    </SheetFrame>
  )
}

/** A party recorded paid whose booking stopped before the host's confirmation went out. */
function PartyNoConfirmation({ item }: { item: ToDecideItem }) {
  const { send, busy, error } = useDecide(item)
  return (
    <SheetFrame title={item.title} subtitle="To decide" footer={<button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'sorted' })}>{label(busy, 'sorted', 'Done', 'Saving…')}</button>}>
      <Head item={item} />
      <p className="adm-note adm-gap-top">The party is paid and on the calendar. Open the party and tap the button that emails the host the details, so they get their host page, invite link and calendar. Then tap Done here.</p>
      <OpenParty item={item} />
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

/** Paid, no seat: Give them their seat, Refund it (exactly that payment, confirmed by name and amount), or It's already sorted. */
function PaidNoSeat({ item }: { item: ToDecideItem }) {
  const d = item.detail as Detail & {
    name?: string; email?: string; canSeat?: boolean; canRefund?: boolean; canSort?: boolean
    refundStarted?: boolean; startedCents?: number | null; backCents?: number; leftCents?: number
  }
  const { send, busy, error, setError } = useDecide(item)
  const [asking, setAsking] = useState<null | 'refund' | 'sorted'>(null)
  const cents = d.cents ?? 0
  const back = d.backCents ?? 0
  const refundCents = d.refundStarted ? (d.startedCents ?? cents) : (d.leftCents ?? cents)
  const named = (d.name ?? '').trim()
  const first = named ? named.split(/\s+/)[0] : ''
  const keep = () => { setAsking(null); setError('') }
  const footer = asking === 'refund'
    ? <RefundConfirm amount={formatMoney(refundCents)} who={named || 'the customer'} first={first} email={!!d.email} busy={busy === 'refund'} onKeep={keep} onGo={() => send({ action: 'refund', body: { cents: refundCents } })} />
    : asking === 'sorted'
      ? <SortConfirm amount={formatMoney(cents)} back={back > 0} busy={busy === 'sorted'} onKeep={keep} onGo={() => send({ action: 'sorted' })} />
      : (
        <div className="adm-stack">
          {d.canSeat && (
            <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => send({ action: 'seat' })}>
              {label(busy, 'seat', d.seats === 1 ? 'Give them their seat' : 'Give them their seats', 'Adding…')}
            </button>
          )}
          {d.canRefund && <button type="button" className={`adm-btn ${d.canSeat ? 'is-ghost' : 'is-pri'}`} disabled={!!busy} onClick={() => { setAsking('refund'); setError('') }}>{back > 0 && !d.refundStarted ? 'Refund the rest' : 'Refund it'}</button>}
          {d.canSort !== false && <button type="button" className={d.canSeat || d.canRefund ? 'adm-quiet' : 'adm-btn is-pri'} disabled={!!busy} onClick={() => { setAsking('sorted'); setError('') }}>It’s already sorted</button>}
        </div>
      )
  return (
    <SheetFrame title={item.title} subtitle={item.className} footer={footer}>
      <Head item={item} />
      {kv('Paid', formatMoney(cents))}
      {back > 0 && kv('Refunded in Square', formatMoney(back))}
      {named && kv('Paid by', named)}
      {kv('Seats', String(d.seats ?? 0))}
      <p className="adm-note adm-gap-top">
        {d.refundStarted
          ? `A refund of ${formatMoney(refundCents)} was sent to Square and it never answered. Tap Refund it: the same request goes again, so it can never refund twice.`
          : `${d.canSeat ? 'Giving them their seat puts them on the class, paid by this payment, even if the date is full. Or refund the payment' : 'Refund the payment'}: it goes back to their card${d.email ? ' and they get a refund email' : ' (no email on file, so nobody is emailed)'}. Already settled another way? Tap It’s already sorted.`}
      </p>
      {item.classId && <OpenClass id={item.classId} />}
      <ErrorLine text={error} />
    </SheetFrame>
  )
}
