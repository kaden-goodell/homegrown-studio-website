/**
 * One party (`#party-<day>-<id>`): Details · Guests · Payments, and what can
 * be done to it. At a glance: when, who, how many, the craft, what's paid and
 * what's still due (studio fee and extras; crafts are rung up at the studio),
 * and any payment going through right now.
 *
 * Actions: Move (only free party times, or another free time), Cancel (never
 * refunds), Change details, + Add an extra, Send payment link, Take card now
 * (Square's card box), Email the host the details, Refund (one payment at a
 * time). Nothing is sent to the host on its own (S2-R7): after a move or a
 * cancel the sheet shows "Let Stefanie know" with Call, Text and Email.
 *
 * A party booked in Square is read only here: "Booked in Square. Change it
 * there."
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import { AmountRefundPanel, type AmountCharge, type WaitingAmountRefund } from '@components/shared/RefundPanel'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import type { PartyItem } from '@lib/party-store'
import { newAttemptId } from '@lib/checkout-attempt'
import { formatMoney } from '@lib/money'
import { partyInviteUrl } from '@lib/party-share'
import { localToUtcISO } from '@lib/party-slots'
import { formatSlotLabel } from '@lib/studio-time'
import { api } from '../classes/api'
import { dayLabel, today } from '../classes/dates'
import { smsHref, telHref } from '../inbox/describe'
import { ContactButton } from '../inbox/InboxSheets'
import { useRefresh } from '../shell/data'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { dayAndClock, dayAndSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import {
  byStudioDay, firstOf, newKey, PARTY_ACTIONS, partyTitle, STATE_WORDS, timesWindow, useCrafts, useParty, usePartySettings, usePartyTimes,
  type AdminParty, type AdminPartyGuest, type HostToTell, type SendDetailsOffer,
} from './api'
import { ANOTHER_TIME_HINT, OWNER_EARLIEST, OWNER_LATEST, startClock, type PartyNotice } from './BookPartySheet'

type Tab = 'details' | 'guests' | 'pay'
type Panel = null | 'move' | 'cancel'
const WAIVER: Record<AdminPartyGuest['waiver'], string> = { current: 'Waiver signed', expired: 'Waiver expired', outdated: 'Needs the new waiver' }
const CARD_UNREAD = 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.'

/** After a move, a cancel or a change: what happened and how to tell the host (nothing is sent for her). */
interface Told { text: string; warn?: boolean; host: HostToTell | null; offer: SendDetailsOffer | null }

const kv = (k: string, v: ReactNode, key?: string) => (
  <div key={key ?? k} className="adm-kv"><span>{k}</span><span>{v === '' || v === null ? '—' : v}</span></div>
)

export function PartySheet({ day, id }: { day: string; id: string }) {
  const { data } = useSheet()
  const { info, error, reload } = useParty(id)
  const given = data && typeof data === 'object' ? data as Partial<CalendarItem> & { notice?: PartyNotice } : null
  const item = given && given.id === id && given.startIso ? given as CalendarItem : null
  const notice = given?.notice && given.notice.id === id ? given.notice : null

  if (error && !info) return <SheetFrame title="Party"><Failed message={error} onRetry={reload} /></SheetFrame>
  if (!info) return <SheetFrame title="Party" subtitle={item ? dayAndSpan(item.startIso, item.endIso) : dayLabel(day)}><Skeleton rows={4} label="Loading the party" /></SheetFrame>
  const p = info.party
  if (!p || p.legacy) return <SquareParty party={p} item={item} guests={info.guests} day={day} />
  return <OurParty party={p} guests={info.guests} notice={notice} />
}

/** Call and Text, with the number showing underneath (pinned at the bottom). */
function CallText({ phone }: { phone: string }) {
  if (!phone) return null
  return (
    <div className="adm-two">
      <ContactButton label="Call" href={telHref(phone)} text={phone} />
      <ContactButton label="Text" href={smsHref(phone)} text={phone} />
    </div>
  )
}

/** Booked in Square: read only. */
function SquareParty({ party: p, item, guests, day }: { party: AdminParty | null; item: CalendarItem | null; guests: AdminPartyGuest[] | null; day: string }) {
  const [tab, setTab] = useState<'details' | 'guests'>('details')
  const title = p ? partyTitle(p.hostName) : item ? item.label.replace(/^./, (c) => c.toUpperCase()) : 'Party'
  const when = p ? (p.endIso ? dayAndSpan(p.startIso, p.endIso) : dayAndClock(p.startIso)) : item ? dayAndSpan(item.startIso, item.endIso) : dayLabel(day)
  return (
    <SheetFrame tall title={title} subtitle={<>{when} <span className="adm-tag is-grey">Booked in Square</span></>} footer={p ? <CallText phone={p.hostPhone} /> : undefined}>
      <div className="adm-panel adm-gap-bottom"><b>Booked in Square. Change it there.</b><span className="adm-small">Moving, cancelling and refunds for this party happen in Square, as before.</span></div>
      <Seg label="Party" value={tab} onChange={setTab} options={[['details', 'Details'], ['guests', 'Guests']]} />
      {tab === 'details' && (p
        ? (
          <>
            {kv('When', when)}
            {kv('Host', p.hostName)}
            {kv('Phone', p.hostPhone)}
            {kv('Email', p.hostEmail)}
            {kv('Guests', p.guestCount)}
            {kv('Craft', p.craftName)}
            {p.themeName && kv('Themed table', p.themeName)}
          </>
        )
        : <p className="adm-note">There are no details on file here for this party. Open it in Square.</p>)}
      {tab === 'guests' && <GuestList guests={guests} party={p} />}
    </SheetFrame>
  )
}

function GuestList({ guests, party, onCopy }: { guests: AdminPartyGuest[] | null; party: AdminParty | null; onCopy?: () => void }) {
  if (guests === null) return <p className="adm-error" role="alert">The guest list couldn’t be read. Try again in a minute.</p>
  return (
    <>
      <p className="adm-small adm-muted" style={{ marginBottom: '0.25rem' }}>
        {`${guests.length} ${guests.length === 1 ? 'family has' : 'families have'} said yes · ${guests.reduce((n, g) => n + g.coming, 0)} people`}
        {party ? ` · booked for ${party.guestCount}` : ''}
      </p>
      {guests.length === 0 && <p className="adm-empty">No one has said yes yet.</p>}
      {guests.map((g, n) => (
        <div key={n} className="adm-bk">
          <div className="adm-rm">
            <b>{g.name || 'No name'}</b>
            <small>{g.kids ? `+${g.kids} ${g.kids === 1 ? 'kid' : 'kids'} · ` : ''}{g.coming} coming</small>
          </div>
          <span className={`adm-tag${g.waiver === 'current' ? ' is-grey' : ''}`}>{WAIVER[g.waiver]}</span>
        </div>
      ))}
      {onCopy && <button type="button" className="adm-btn is-ghost adm-gap-top" onClick={onCopy}>Copy invite link</button>}
    </>
  )
}

/** "Card, taken here · Sat Oct 17 · 9:14 AM" */
function chargeWords(c: AdminParty['charges'][number]): string {
  const how = c.via === 'admin-card' ? 'Card, taken here' : c.via === 'link' ? 'Paid by payment link' : 'Paid online when booked'
  return `${how}${c.simulated ? ' (test, no real card)' : ''} · ${dayAndClock(c.at)}`
}

function itemWords(it: PartyItem): string {
  if (it.kind === 'package') return it.label === 'Whole studio' ? 'Studio fee' : `${it.label} (studio fee)`
  if (it.forGuests !== undefined) return `${it.label}${it.topUp ? ', for new guests' : ''} · ${it.forGuests} ${it.forGuests === 1 ? 'guest' : 'guests'}`
  return it.qty > 1 ? `${it.label} × ${it.qty}` : it.label
}

function OurParty({ party: p, guests, notice }: { party: AdminParty; guests: AdminPartyGuest[] | null; notice: PartyNotice | null }) {
  const { bump } = useRefresh()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('details')
  const [panel, setPanel] = useState<Panel>(null)
  const [told, setTold] = useState<Told | null>(notice ? { text: notice.text, warn: notice.warn, host: null, offer: null } : null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [taking, setTaking] = useState(false)
  const [busy, setBusy] = useState('')
  const top = useRef<HTMLDivElement>(null)
  const cancelled = p.status === 'cancelled'
  const first = firstOf(p.hostName)
  const paying = p.paymentInFlight
  const extraMinutes = (p.items ?? []).filter((it) => it.kind === 'addon').reduce((m, it) => m + it.extraMinutes, 0)
  const when = p.endIso ? dayAndSpan(p.startIso, p.endIso) : dayAndClock(p.startIso)
  const started = Date.parse(p.startIso) <= Date.now()

  function show(t: Told) {
    setTold(t)
    top.current?.scrollIntoView?.({ block: 'start' })
  }

  async function act<T>(body: Record<string, unknown>, tag: string): Promise<{ ok: true; data: T; warning?: string } | { ok: false; error: string }> {
    setBusy(tag)
    const r = await api<T>(PARTY_ACTIONS, { id: p.bookingId, ...body })
    setBusy('')
    if (r.ok && r.data) { bump(); return { ok: true, data: r.data, warning: r.warning } }
    return { ok: false, error: r.error ?? DIDNT_SAVE }
  }

  async function sendLink() {
    const r = await act<{ message: string }>({ action: 'send-link' }, 'link')
    if (!r.ok) return toast(r.error)
    toast(r.warning ?? r.data.message)
  }

  // "Email Stefanie the details": one request at a time (the button is off while it goes), a new key for every
  // deliberate tap, the same key only for the one automatic retry after the network dropped (the server may have
  // sent it already: the same key answers that result instead of a second email). A failed send never sticks to
  // a key: the next tap is a new key, so "tap again" always tries again.
  const sendingDetails = useRef(false)
  async function sendDetails() {
    if (sendingDetails.current) return
    sendingDetails.current = true
    setBusy('details')
    const createKey = newKey()
    let r = await api<{ message: string }>(PARTY_ACTIONS, { id: p.bookingId, action: 'send-details', createKey })
    if (!r.ok && r.status === 0) {
      await new Promise((res) => setTimeout(res, 1500))
      r = await api<{ message: string }>(PARTY_ACTIONS, { id: p.bookingId, action: 'send-details', createKey })
    }
    sendingDetails.current = false
    setBusy('')
    if (!r.ok || !r.data) return toast(r.error ?? DIDNT_SAVE)
    bump()
    toast(r.warning ?? r.data.message)
    if (told?.offer) setTold({ ...told, offer: null, text: `${told.text} ${r.warning ?? r.data.message}` })
  }

  async function takeOff(it: PartyItem) {
    const r = await act<{ message: string }>({ action: 'remove-extra', itemId: it.id }, `off-${it.id}`)
    toast(r.ok ? (r.warning ?? r.data.message) : r.error)
  }

  const host: HostToTell = { name: p.hostName, phone: p.hostPhone, email: p.hostEmail }
  const lastSent = p.linkSent.length ? p.linkSent[p.linkSent.length - 1] : null
  const charges: AmountCharge[] = p.charges.filter((c) => !c.simulated).map((c) => ({
    id: c.id,
    left: Math.max(0, c.cents - p.refunds.filter((f) => f.chargeId === c.id).reduce((s, f) => s + f.cents, 0)),
    label: `${chargeWords(c)} · ${formatMoney(c.cents)}`,
  }))
  const waitingReq = (p.refundRequests ?? []).find((q) => q.status === 'pending' && !q.squareRefundId)
  const waiting: WaitingAmountRefund | null = waitingReq ? { requestId: waitingReq.requestId, cents: waitingReq.cents, at: waitingReq.at, by: waitingReq.by, chargeId: waitingReq.chargeId } : null
  const canPay = !cancelled && p.dueCents > 0 && !paying
  const paidCents = p.charges.reduce((s, c) => s + c.cents, 0) - p.refunds.reduce((s, f) => s + f.cents, 0)

  let footer: ReactNode
  if (panel === 'move') footer = <MovePanel party={p} onClose={() => setPanel(null)} onMoved={(t) => { setPanel(null); show(t) }} />
  else if (panel === 'cancel') {
    footer = (
      <CancelPanel party={p} paidCents={paidCents} onClose={() => setPanel(null)} onDone={(t) => { setPanel(null); setTab('details'); show(t) }} />
    )
  } else if (cancelled || started) footer = <CallText phone={p.hostPhone} />
  else {
    footer = (
      <div className="adm-stack">
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setPanel('move')}>Move</button>
          <button type="button" className="adm-btn is-danger" onClick={() => setPanel('cancel')}>Cancel party</button>
        </div>
        <CallText phone={p.hostPhone} />
      </div>
    )
  }

  const statusTag = <span className={`adm-tag${p.paymentState === 'paid' ? ' is-grey' : p.paymentState === 'cancelled' ? ' is-red' : ''}`}>{STATE_WORDS[p.paymentState]}</span>

  return (
    <SheetFrame tall title={partyTitle(p.hostName)} subtitle={<>{when} {statusTag}</>} footer={footer}>
      <div ref={top} />
      {told && (
        <div className={`adm-panel adm-gap-bottom${told.warn ? ' is-warn' : ''}`} role="status" aria-label={told.host ? `Let ${first} know` : 'What happened'}>
          {told.host && <b>{`Let ${first} know`}</b>}
          <span>{told.text}</span>
          {told.host && (
            <div className="adm-three">
              {told.host.phone ? <a className="adm-btn is-ghost" href={telHref(told.host.phone)}>Call</a> : <span />}
              {told.host.phone ? <a className="adm-btn is-ghost" href={smsHref(told.host.phone)}>Text</a> : <span />}
              {told.host.email ? <a className="adm-btn is-ghost" href={`mailto:${told.host.email}`}>Email</a> : <span />}
            </div>
          )}
          {told.offer && !cancelled && (
            <button type="button" className="adm-btn is-pri" disabled={busy === 'details'} onClick={sendDetails}>{busy === 'details' ? 'Sending…' : told.offer.label}</button>
          )}
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setTold(null)}>Done</button>
        </div>
      )}
      {cancelled && (
        <div className="adm-panel is-warn adm-gap-bottom">
          <b>{`Cancelled${p.cancelled ? ` ${dayAndClock(p.cancelled.at)} by ${p.cancelled.by.name}` : ''}`}</b>
          <span className="adm-small">{paidCents > 0 ? `Nothing was refunded. ${formatMoney(paidCents)} is still with us. Use Refund on the Payments tab if ${first} should get money back.` : 'Nothing is owed either way.'}</span>
        </div>
      )}
      {p.overlap && !cancelled && (
        <div className="adm-panel is-warn adm-gap-bottom" role="alert">
          <b>Two parties at once</b>
          <span className="adm-small">{`${first} paid after this time was taken by another party. Nothing was refunded. Move one of the parties, then let the hosts know.`}</span>
        </div>
      )}
      <Seg label="Party" value={tab} onChange={setTab} options={[['details', 'Details'], ['guests', 'Guests'], ['pay', p.dueCents > 0 && !cancelled ? `Payments · ${formatMoney(p.dueCents)} due` : 'Payments']]} />

      {tab === 'details' && (
        editing
          ? <EditDetails party={p} onClose={() => setEditing(false)} onSaved={(t) => { setEditing(false); show(t) }} />
          : (
            <>
              {kv('When', <>{when}{extraMinutes > 0 && <><br />{`includes ${extraMinutes} minutes of extra time`}</>}</>)}
              {kv('Host', p.hostName)}
              {kv('Phone', p.hostPhone ? <a href={telHref(p.hostPhone)}>{p.hostPhone}</a> : '')}
              {kv('Email', p.hostEmail ? <a href={`mailto:${p.hostEmail}`}>{p.hostEmail}</a> : '')}
              {kv('Guests', p.guestCount)}
              {kv('Craft', p.craftName)}
              {p.items.filter((it) => it.kind === 'package').map((it) => kv('Package', `${it.label} · ${formatMoney(it.cents)}`, it.id))}
              {kv('Extras', p.items.filter((it) => it.kind === 'addon').map(itemWords).join(', ') || 'None')}
              {p.themeName && kv('Themed table', p.themeName)}
              {kv('Payment', STATE_WORDS[p.paymentState])}
              {!cancelled && (
                <div className="adm-stack adm-gap-top">
                  {p.sendDetails && (
                    <>
                      <button type="button" className="adm-btn is-ghost" disabled={busy === 'details'} onClick={sendDetails}>{busy === 'details' ? 'Sending…' : p.sendDetails.label}</button>
                      <p className="adm-small adm-muted" style={{ margin: '-0.25rem 0 0' }}>{`Emails ${first} the party details with a calendar invite and the invite link for guests.`}</p>
                    </>
                  )}
                  <button type="button" className="adm-btn is-ghost" onClick={() => setEditing(true)}>Change details</button>
                  {!adding && <button type="button" className="adm-btn is-ghost" onClick={() => { setAdding(true); setTab('pay') }}>+ Add an extra</button>}
                </div>
              )}
            </>
          )
      )}

      {tab === 'guests' && <GuestList guests={guests} party={p} onCopy={() => copyInvite(p, toast)} />}

      {tab === 'pay' && (
        <section aria-label="Payments">
          {paying && <div className="adm-panel is-warn adm-gap-bottom" role="status"><b>A payment is going through</b><span className="adm-small">{paying.message}</span></div>}
          {p.items.map((it) => (
            <div key={it.id} className="adm-kv">
              <span>{itemWords(it)}{it.chargeId === null && it.kind === 'addon' && !cancelled && (
                <><br /><button type="button" className="adm-quiet" disabled={busy === `off-${it.id}`} aria-label={`Take off ${it.label}`} onClick={() => takeOff(it)}>Take off</button></>
              )}</span>
              <span>{formatMoney(it.cents)} <span className={`adm-tag${it.chargeId ? ' is-grey' : ''}`}>{it.chargeId ? 'Paid' : cancelled ? 'Not paid' : 'Due'}</span></span>
            </div>
          ))}
          <div className="adm-kv is-tot"><span>{cancelled ? 'Nothing due, the party was cancelled' : p.dueCents > 0 ? 'Still due' : 'Nothing due'}</span><span>{cancelled ? '' : formatMoney(p.dueCents)}</span></div>
          <p className="adm-small adm-muted adm-gap-top">{`Crafts (${p.craftName}) are rung up on the POS at the studio, for whoever comes.`}</p>

          {canPay && !taking && (
            <div className="adm-stack adm-gap-top">
              <button type="button" className="adm-btn is-pri" disabled={busy === 'link'} onClick={sendLink}>{busy === 'link' ? 'Sending…' : lastSent ? 'Send it again' : 'Send payment link'}</button>
              {lastSent && <p className="adm-small adm-muted" style={{ margin: 0 }}>{`Last sent ${dayAndClock(lastSent.at)}${lastSent.email || lastSent.text ? ` by ${[lastSent.email && 'email', lastSent.text && 'text'].filter(Boolean).join(' and ')}` : ', but it didn’t go out'}.`}</p>}
              <button type="button" className="adm-btn is-ghost" onClick={() => setTaking(true)}>Take card now</button>
            </div>
          )}
          {canPay && taking && <TakeCard party={p} onClose={() => setTaking(false)} onPaid={(t) => { setTaking(false); show(t) }} />}

          {!cancelled && (adding
            ? <AddExtra party={p} onClose={() => setAdding(false)} onAdded={(text) => { setAdding(false); toast(text) }} />
            : <button type="button" className="adm-btn is-ghost adm-gap-top" onClick={() => setAdding(true)}>+ Add an extra</button>)}

          {p.charges.length > 0 && <p className="adm-lbl">Payments</p>}
          {p.charges.map((c) => (
            <div key={c.id} className="adm-kv">
              <span>{chargeWords(c)}{c.receiptUrl && <><br /><a href={c.receiptUrl} target="_blank" rel="noopener">Receipt</a></>}</span>
              <span>{formatMoney(c.cents)}</span>
            </div>
          ))}
          {p.refunds.map((f) => (
            <div key={f.id} className="adm-kv">
              <span>{`Refunded · ${dayAndClock(f.at)}${f.by ? ` · by ${f.by.name}` : ''}`}{f.reason && <><br /><span className="adm-small">{f.reason}</span></>}</span>
              <span>{`−${formatMoney(f.cents)}`}</span>
            </div>
          ))}
          {(charges.some((c) => c.left > 0) || waiting) && (
            <div className="adm-gap-top">
              <AmountRefundPanel partyId={p.bookingId} payer={p.hostName} charges={charges} waiting={waiting} send={(url, body) => api(url, body)} onDone={bump} />
            </div>
          )}
          {p.charges.some((c) => c.simulated) && <p className="adm-small adm-muted">A test payment with no real card can’t be refunded.</p>}
        </section>
      )}
    </SheetFrame>
  )
}

function copyInvite(p: AdminParty, toast: (t: string) => void) {
  const url = partyInviteUrl({ bookingId: p.bookingId, craftName: p.craftName, slotLabel: formatSlotLabel(p.startIso), startIso: p.startIso, ...(p.title ? { title: p.title } : {}) }, window.location.origin)
  const clip = navigator.clipboard
  if (!clip) return toast(`Couldn’t copy. The link is ${url}`)
  clip.writeText(url).then(() => toast(`Copied the invite link for ${firstOf(p.hostName)}’s guests.`), () => toast(`Couldn’t copy. The link is ${url}`))
}

// ── Move ────────────────────────────────────────────────────────────────────

function MovePanel({ party: p, onClose, onMoved }: { party: AdminParty; onClose: () => void; onMoved: (t: Told) => void }) {
  const { bump } = useRefresh()
  const toast = useToast()
  const { times, error, retry } = usePartyTimes({ ...timesWindow(), exclude: p.bookingId })
  const [pick, setPick] = useState('')
  const [other, setOther] = useState(false)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  useSheetDirty(!!pick || !!day || !!time)
  const free = (times?.open ?? []).filter((s) => Date.parse(s) !== Date.parse(p.startIso))
  const startIso = other ? (day && /^\d{2}:\d{2}$/.test(time) ? localToUtcISO(day, time) : '') : pick

  // The record couldn't be checked after a move (both times held): "Finish the move" sends it again with the
  // times the server named, which finishes it whichever time the party is on.
  const [finish, setFinish] = useState<{ from: string; to: string } | null>(null)
  async function move(target?: { from: string; to: string }) {
    const to = target?.to ?? startIso
    if (!to || busy) return
    setBusy(true)
    setRefusal('')
    const r = await api<{ message: string; hostToTell: HostToTell; sendDetails: SendDetailsOffer }>(PARTY_ACTIONS, { id: p.bookingId, action: 'move', startIso: to, fromIso: target?.from ?? p.startIso })
    setBusy(false)
    if (!r.ok || !r.data) {
      setRefusal(r.error ?? DIDNT_SAVE)
      const both = r.extra?.both as { from: string; to: string } | undefined
      setFinish(both && typeof both.from === 'string' && typeof both.to === 'string' ? both : null)
      // Someone else moved it, or it may have moved: show the party as it is now.
      if (both || typeof r.extra?.startIso === 'string') bump()
      retry()
      return
    }
    setFinish(null)
    bump()
    toast(r.data.message)
    onMoved({ text: r.warning ?? r.data.message, warn: !!r.warning, host: r.data.hostToTell, offer: r.data.sendDetails })
  }

  return (
    <div className="adm-panel" role="group" aria-label={`Move ${firstOf(p.hostName)}’s party`}>
      <b>{`Move ${firstOf(p.hostName)}’s party`}</b>
      <span className="adm-small">{`Now ${dayAndClock(p.startIso)}. Its length, extras and payments stay the same.`}</span>
      {!other && (error ? <Failed message={error} onRetry={retry} />
        : !times ? <Skeleton rows={1} label="Loading the free party times" />
          : free.length === 0 ? <span className="adm-small">No other free party times in the next eight weeks. Use Another time.</span>
            : (
              <label className="adm-fld" style={{ margin: 0 }}>
                <span>New day and time</span>
                <select value={pick} onChange={(e) => { setPick(e.target.value); setRefusal('') }}>
                  <option value="">Pick a free party time</option>
                  {byStudioDay(free).map(([d, list]) => (
                    <optgroup key={d} label={dayLabel(d)}>
                      {list.map((s) => <option key={s} value={s}>{`${dayLabel(d)} · ${startClock(s)}`}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            ))}
      {other && (
        <div className="adm-two">
          <label className="adm-fld" style={{ margin: 0 }}><span>Day</span><input type="date" min={today()} value={day} onChange={(e) => { setDay(e.target.value); setRefusal('') }} /></label>
          <label className="adm-fld" style={{ margin: 0 }}><span>Start time</span><input type="time" step={900} min={OWNER_EARLIEST} max={OWNER_LATEST} value={time} onChange={(e) => { setTime(e.target.value); setRefusal('') }} /></label>
        </div>
      )}
      {other && <span className="adm-small">{ANOTHER_TIME_HINT}</span>}
      <button type="button" className="adm-quiet" onClick={() => { setOther(!other); setRefusal('') }}>{other ? 'Back to the free party times' : 'Another time'}</button>
      {refusal && <p className="adm-error" role="alert">{refusal}</p>}
      {finish
        ? (
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={onClose}>Not now</button>
            <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => move(finish)}>{busy ? 'Moving…' : 'Finish the move'}</button>
          </div>
        )
        : (
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={onClose}>Never mind</button>
            <button type="button" className="adm-btn is-pri" disabled={!startIso || busy} onClick={() => move()}>{busy ? 'Moving…' : 'Move party'}</button>
          </div>
        )}
    </div>
  )
}

// ── Cancel ──────────────────────────────────────────────────────────────────

function CancelPanel({ party: p, paidCents, onClose, onDone }: { party: AdminParty; paidCents: number; onClose: () => void; onDone: (t: Told) => void }) {
  const { bump } = useRefresh()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const first = firstOf(p.hostName)
  async function cancel() {
    setBusy(true)
    setRefusal('')
    const r = await api<{ message: string; hostToTell: HostToTell }>(PARTY_ACTIONS, { id: p.bookingId, action: 'cancel' })
    setBusy(false)
    if (!r.ok || !r.data) return setRefusal(r.error ?? DIDNT_SAVE)
    bump()
    toast(r.data.message)
    onDone({ text: r.warning ?? r.data.message, warn: !!r.warning, host: r.data.hostToTell, offer: null })
  }
  return (
    <div className="adm-panel is-warn" role="group" aria-label={`Cancel ${first}’s party?`}>
      <b>{`Cancel ${first}’s party?`}</b>
      <span className="adm-small">{`${dayAndClock(p.startIso)}. ${paidCents > 0 ? `${p.hostName} has paid ${formatMoney(paidCents)}.` : 'Nothing has been paid.'}`}</span>
      <span className="adm-small">The time opens up on the calendar. This does not refund anything. Use Refund on the Payments tab if they should get money back.</span>
      {refusal && <p className="adm-error" role="alert">{refusal}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onClose}>Keep it</button>
        <button type="button" className="adm-btn is-danger" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel party'}</button>
      </div>
    </div>
  )
}

// ── Change details ──────────────────────────────────────────────────────────

function EditDetails({ party: p, onClose, onSaved }: { party: AdminParty; onClose: () => void; onSaved: (t: Told) => void }) {
  const { bump } = useRefresh()
  const toast = useToast()
  const { crafts, error: craftError, retry } = useCrafts()
  const [f, setF] = useState({ hostName: p.hostName, hostPhone: p.hostPhone, hostEmail: p.hostEmail, guests: String(p.guestCount), craftId: p.craftId ?? '' })
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ field: string; text: string } | null>(null)
  const changed: Record<string, unknown> = {}
  if (f.hostName.trim() !== p.hostName) changed.hostName = f.hostName
  if (f.hostPhone.trim() !== p.hostPhone) changed.hostPhone = f.hostPhone
  if (f.hostEmail.trim() !== p.hostEmail) changed.hostEmail = f.hostEmail
  if (Number(f.guests) !== p.guestCount) changed.guests = Number(f.guests)
  if (f.craftId && f.craftId !== (p.craftId ?? '')) changed.craftId = f.craftId
  const dirty = Object.keys(changed).length > 0
  useSheetDirty(dirty)

  async function save() {
    setBusy(true)
    setRefusal(null)
    const r = await api<{ message: string; sendDetails?: SendDetailsOffer }>(PARTY_ACTIONS, { id: p.bookingId, action: 'edit-details', ...changed })
    setBusy(false)
    if (!r.ok || !r.data) return setRefusal({ field: String(r.extra.field ?? ''), text: r.error ?? DIDNT_SAVE })
    bump()
    toast(r.warning ?? r.data.message)
    onSaved({ text: r.warning ?? `Saved. Nothing was sent to ${firstOf(f.hostName)}.`, warn: !!r.warning, host: { name: f.hostName, phone: f.hostPhone, email: f.hostEmail }, offer: r.data.sendDetails ?? null })
  }
  const err = (field: string) => refusal?.field === field ? <p className="adm-error adm-fielderr" role="alert">{refusal.text}</p> : null
  return (
    <section aria-label="Change details">
      <label className="adm-fld"><span>Host name</span><input value={f.hostName} onChange={(e) => setF({ ...f, hostName: e.target.value })} /></label>
      {err('hostName')}
      <label className="adm-fld"><span>Phone</span><input type="tel" value={f.hostPhone} onChange={(e) => setF({ ...f, hostPhone: e.target.value })} /></label>
      {err('hostPhone')}
      <label className="adm-fld"><span>Email</span><input type="email" autoCapitalize="off" value={f.hostEmail} onChange={(e) => setF({ ...f, hostEmail: e.target.value })} /></label>
      {err('hostEmail')}
      <label className="adm-fld"><span>Guests</span><input type="number" inputMode="numeric" value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value })} /></label>
      {err('guests')}
      {craftError ? <Failed message={craftError} onRetry={retry} /> : (
        <label className="adm-fld">
          <span>Craft</span>
          <select value={f.craftId} onChange={(e) => setF({ ...f, craftId: e.target.value })}>
            {!crafts?.some((c) => c.id === f.craftId) && <option value={f.craftId}>{p.craftName}</option>}
            {(crafts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {err('craftId')}
      {refusal && !['hostName', 'hostPhone', 'hostEmail', 'guests', 'craftId'].includes(refusal.field) && <p className="adm-error" role="alert">{refusal.text}</p>}
      <p className="adm-small adm-muted">{`Prices already paid don’t change. Nothing is sent to ${firstOf(p.hostName)} unless you tap Email them the new details after.`}</p>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onClose}>Never mind</button>
        <button type="button" className="adm-btn is-pri" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  )
}

// ── Extras ──────────────────────────────────────────────────────────────────

function AddExtra({ party: p, onClose, onAdded }: { party: AdminParty; onClose: () => void; onAdded: (text: string) => void }) {
  const { bump } = useRefresh()
  const { settings, error, retry } = usePartySettings()
  const [addOnId, setAddOnId] = useState('')
  const [count, setCount] = useState(1)
  const [newGuests, setNewGuests] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const key = useRef(newKey())
  useSheetDirty(!!addOnId)
  const list = (settings?.addOns ?? []).filter((a) => !a.archived)
  const a = list.find((x) => x.id === addOnId)
  // Already on the party, per guest: this adds it for guests who joined since (S2-R4a).
  const topUp = !!a && a.per === 'guest' && p.items.some((it) => it.kind === 'addon' && it.refId === a.id)
  useEffect(() => { setCount(1); setNewGuests(''); setRefusal('') }, [addOnId])

  async function add() {
    if (!a) return
    setBusy(true)
    setRefusal('')
    const body: Record<string, unknown> = { id: p.bookingId, action: 'add-extra', addOnId: a.id, count, createKey: key.current }
    if (topUp) body.forGuests = Number(newGuests)
    const r = await api<{ message: string }>(PARTY_ACTIONS, body)
    setBusy(false)
    if (!r.ok || !r.data) return setRefusal(r.error ?? DIDNT_SAVE)
    key.current = newKey()
    bump()
    onAdded(r.warning ?? r.data.message)
  }

  if (error && !settings) return <Failed message={error} onRetry={retry} />
  if (!settings) return <Skeleton rows={1} label="Loading the extras" />
  return (
    <div className="adm-panel adm-gap-top" role="group" aria-label="Add an extra">
      <b>Add an extra</b>
      {list.length === 0
        ? <span className="adm-small">There are no extras yet. Add them in Parties setup.</span>
        : (
          <label className="adm-fld" style={{ margin: 0 }}>
            <span>Extra</span>
            <select value={addOnId} onChange={(e) => setAddOnId(e.target.value)}>
              <option value="">Pick an extra</option>
              {list.map((x) => <option key={x.id} value={x.id}>{`${x.label} · ${formatMoney(x.priceCents)}${x.per === 'guest' ? ' a guest' : ''}${x.extraMinutes ? ` · adds ${x.extraMinutes} minutes` : ''}`}</option>)}
            </select>
          </label>
        )}
      {a && !topUp && a.maxQty > 1 && (
        <label className="adm-fld" style={{ margin: 0 }}>
          <span>{a.per === 'guest' ? 'How many for each guest' : 'How many'}</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: a.maxQty }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      {topUp && (
        <label className="adm-fld" style={{ margin: 0 }}>
          <span>{`${a!.label} is already on this party. For how many new guests?`}</span>
          <input type="number" inputMode="numeric" min={1} value={newGuests} onChange={(e) => setNewGuests(e.target.value)} />
        </label>
      )}
      {a && <span className="adm-small">{`It’s added as due. ${firstOf(p.hostName)} pays for it by payment link, or you take a card.${a.extraMinutes ? ` The party gets ${a.extraMinutes} minutes longer, if the time after it is free.` : ''}`}</span>}
      {refusal && <p className="adm-error" role="alert">{refusal}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onClose}>Never mind</button>
        <button type="button" className="adm-btn is-pri" disabled={!a || busy || (topUp && !(Number(newGuests) > 0))} onClick={add}>{busy ? 'Adding…' : 'Add it'}</button>
      </div>
    </div>
  )
}

// ── Take a card ─────────────────────────────────────────────────────────────

function TakeCard({ party: p, onClose, onPaid }: { party: AdminParty; onClose: () => void; onPaid: (t: Told) => void }) {
  const { bump } = useRefresh()
  const toast = useToast()
  const card = useRef<PaymentFormRef>(null)
  const attempt = useRef(newAttemptId())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const due = formatMoney(p.dueCents)

  async function charge() {
    if (busy) return
    setRefusal('')
    setBusy(true)
    let token: string
    try {
      token = (await card.current!.tokenize()).token
    } catch {
      setBusy(false)
      return setRefusal(CARD_UNREAD)
    }
    const r = await api<{ message: string }>(PARTY_ACTIONS, { id: p.bookingId, action: 'take-card', attemptId: attempt.current, paymentToken: token, expectedCents: p.dueCents })
    setBusy(false)
    if (!r.ok || !r.data) {
      // Not sure yet, or still going through: keep this attempt so a retry is recognised, never a second charge.
      if (!(r.status === 0 || r.extra.code === 'unknown_outcome' || r.extra.code === 'in_progress')) attempt.current = newAttemptId()
      setRefusal(r.error ?? DIDNT_SAVE)
      bump()
      return
    }
    bump()
    toast(r.data.message)
    onPaid({ text: r.data.message, host: null, offer: null })
  }

  return (
    <div className="adm-panel adm-gap-top" role="group" aria-label="Take a card">
      <b>{`Take ${firstOf(p.hostName)}’s card for ${due}`}</b>
      <span className="adm-small">Type the card into Square’s card box. Crafts aren’t included. They’re paid at the studio after the party.</span>
      <PaymentForm ref={card} giftCards="cards-only" onReadyChange={setReady} />
      {!ready && <span className="adm-small adm-muted">The card box is loading…</span>}
      {refusal && <p className="adm-error" role="alert">{refusal}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" disabled={busy} onClick={onClose}>Never mind</button>
        <button type="button" className="adm-btn is-pri" disabled={!ready || busy} onClick={charge}>{busy ? 'Charging…' : `Charge ${due}`}</button>
      </div>
    </div>
  )
}

