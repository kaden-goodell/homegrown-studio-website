/**
 * One party (`#party-<day>-<id>`): Details · Guests · Payments, and what can
 * be done to it. At a glance: when, who, how many, the craft, what's paid and
 * what's still due (studio fee and extras; crafts are rung up at the studio),
 * and any payment going through right now.
 *
 * Actions: Move (only free party times, or another free time), Cancel (never
 * refunds), Change details, + Add an extra, Send payment link, Take card now
 * (Square's card box), Email the host the details, Refund (one payment at a
 * time). Nothing is sent to the host on its own (S2-R7). After every
 * action the result stays on the sheet (heading focused, so it's read out),
 * and a move, cancel or change leaves a "Not told yet" reminder (Call, Text,
 * Write, Email the new details, I told them) until the host is told (DV8).
 * Move and Cancel open in the body, never in the pinned footer.
 *
 * A party booked in Square is read only here: "Booked in Square. Change it
 * there."
 *
 * Staff (stage 3): who's on the party, on both kinds; a staffing line opens
 * the sheet on Staff.
 */
import { prettyPhone } from '@lib/phone-display'
import { SQ_LEGACY_PARTY } from '@lib/admin-help'
import { SquareHow } from '../shell/SquareHow'
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
import { StaffRow } from '../staffing/StaffRow'
import { staffOpenOf } from '../staffing/api'
import { ANOTHER_TIME_HINT, OWNER_EARLIEST, OWNER_LATEST, startClock, type PartyNotice } from './BookPartySheet'

type Tab = 'details' | 'guests' | 'pay' | 'staff'
type Panel = null | 'move' | 'cancel'
const WAIVER: Record<AdminPartyGuest['waiver'], string> = { current: 'Waiver signed', expired: 'Waiver expired', outdated: 'Needs the new waiver' }
const CARD_UNREAD = 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.'

/** What just happened (after a move, a cancel, a change, a payment, a refund), kept on the sheet: a heading and the server's words. */
interface Told { title: string; text: string; warn?: boolean }

/** Shows an action's reply on the sheet at once (the party as the server saved it); the reload follows. */
const PartyUpdate = createContext<(p: unknown) => void>(() => {})
/** bump() plus the reply's party shown right away. */
function useApplied() {
  const { bump } = useRefresh()
  const update = useContext(PartyUpdate)
  return (data?: unknown) => {
    const party = data && typeof data === 'object' ? (data as { party?: unknown }).party : undefined
    if (party && typeof party === 'object') update(party)
    bump()
  }
}

const kv = (k: string, v: ReactNode, key?: string) => (
  <div key={key ?? k} className="adm-kv"><span>{k}</span><span>{v === '' || v === null ? '—' : v}</span></div>
)

export function PartySheet({ day, id }: { day: string; id: string }) {
  const { data } = useSheet()
  const { info, error, reload, setParty } = useParty(id)
  const given = data && typeof data === 'object' ? data as Partial<CalendarItem> & { notice?: PartyNotice } : null
  const item = given && given.id === id && given.startIso ? given as CalendarItem : null
  const notice = given?.notice && given.notice.id === id ? given.notice : null
  const staffFirst = !!staffOpenOf(data)

  if (error && !info) return <SheetFrame title="Party"><Failed message={error} onRetry={reload} /></SheetFrame>
  if (!info) return <SheetFrame title="Party" subtitle={item ? dayAndSpan(item.startIso, item.endIso) : dayLabel(day)}><Skeleton rows={4} label="Loading the party" /></SheetFrame>
  const p = info.party
  if (!p || p.legacy) return <SquareParty id={id} party={p} item={item} guests={info.guests} day={day} staffFirst={staffFirst} />
  return (
    <PartyUpdate.Provider value={(next) => setParty(next as AdminParty)}>
      <OurParty party={p} guests={info.guests} notice={notice} staffFirst={staffFirst} />
    </PartyUpdate.Provider>
  )
}

/** Call and Text, with the number showing underneath (pinned at the bottom). */
function CallText({ phone }: { phone: string }) {
  if (!phone) return null
  return (
    <div className="adm-two">
      <ContactButton label="Call" href={telHref(phone)} text={prettyPhone(phone)} />
      <ContactButton label="Text" href={smsHref(phone)} text={prettyPhone(phone)} />
    </div>
  )
}

/** Booked in Square: read only. */
function SquareParty({ id, party: p, item, guests, day, staffFirst }: { id: string; party: AdminParty | null; item: CalendarItem | null; guests: AdminPartyGuest[] | null; day: string; staffFirst: boolean }) {
  const [tab, setTab] = useState<'details' | 'guests' | 'staff'>(staffFirst ? 'staff' : 'details')
  const startIso = p?.startIso ?? item?.startIso
  const title = p ? partyTitle(p.hostName, p.craftName) : item ? item.label.replace(/^./, (c) => c.toUpperCase()) : 'Party'
  const when = p ? (p.endIso ? dayAndSpan(p.startIso, p.endIso) : dayAndClock(p.startIso)) : item ? dayAndSpan(item.startIso, item.endIso) : dayLabel(day)
  return (
    <SheetFrame tall title={title} subtitle={<>{when} <span className="adm-tag is-grey">Booked in Square</span></>} footer={p ? <CallText phone={p.hostPhone} /> : undefined}>
      <div className="adm-panel adm-gap-bottom"><b>Booked in Square. Change it there.</b><span className="adm-small">Moving, cancelling and refunds for this party happen in Square, as before.</span><SquareHow how={SQ_LEGACY_PARTY} /></div>
      <Seg label="Party" value={tab} onChange={setTab} options={[['details', 'Details'], ['guests', 'Guests'], ['staff', 'Staff']]} />
      {tab === 'details' && (p
        ? (
          <>
            {kv('When', when)}
            {kv('Host', p.hostName)}
            {kv('Phone', p.hostPhone ? prettyPhone(p.hostPhone) : '')}
            {kv('Email', p.hostEmail)}
            {kv('Guests', p.guestCount)}
            {kv('Craft', p.craftName)}
            {p.themeName && kv('Themed table', p.themeName)}
          </>
        )
        : <p className="adm-note">There are no details on file here for this party. Open it in Square.</p>)}
      {tab === 'guests' && <GuestList guests={guests} party={p} />}
      {tab === 'staff' && <StaffRow eventKey={`party:${p?.bookingId ?? id}`} startIso={startIso} />}
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

function OurParty({ party: p, guests, notice, staffFirst }: { party: AdminParty; guests: AdminPartyGuest[] | null; notice: PartyNotice | null; staffFirst: boolean }) {
  const { bump } = useRefresh()
  const applied = useApplied()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>(staffFirst ? 'staff' : 'details')
  const [panel, setPanel] = useState<Panel>(null)
  const [told, setTold] = useState<Told | null>(notice ? { title: notice.warn ? 'Booked, with something to check' : 'Booked', text: notice.text, warn: notice.warn } : null)
  const [toldSeq, setToldSeq] = useState(0)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [taking, setTaking] = useState(false)
  const [busy, setBusy] = useState('')
  const toldHead = useRef<HTMLHeadingElement>(null)
  const toldId = useId()
  const cancelled = p.status === 'cancelled'
  const first = firstOf(p.hostName)
  const paying = p.paymentInFlight
  const extraMinutes = (p.items ?? []).filter((it) => it.kind === 'addon').reduce((m, it) => m + it.extraMinutes, 0)
  const when = p.endIso ? dayAndSpan(p.startIso, p.endIso) : dayAndClock(p.startIso)
  const started = Date.parse(p.startIso) <= Date.now()

  /** What just happened, kept on the sheet (the toast goes after 4 s); focus moves to its heading so it's read out (I4). */
  function show(t: Told) {
    setTold(t)
    setToldSeq((n) => n + 1)
  }
  useEffect(() => {
    if (!toldSeq) return
    toldHead.current?.focus({ preventScroll: true })
    toldHead.current?.scrollIntoView?.({ block: 'start' })
  }, [toldSeq])

  async function act<T>(body: Record<string, unknown>, tag: string): Promise<{ ok: true; data: T; warning?: string } | { ok: false; error: string }> {
    setBusy(tag)
    const r = await api<T>(PARTY_ACTIONS, { id: p.bookingId, ...body })
    setBusy('')
    if (r.ok && r.data) { applied(r.data); return { ok: true, data: r.data, warning: r.warning } }
    return { ok: false, error: r.error ?? DIDNT_SAVE }
  }

  // One send at a time (m16): the server sends the same link again anyway, but a double tap shouldn't send two.
  const sendingLink = useRef(false)
  async function sendLink() {
    if (sendingLink.current) return
    sendingLink.current = true
    const r = await act<{ message: string }>({ action: 'send-link' }, 'link')
    sendingLink.current = false
    const text = r.ok ? (r.warning ?? r.data.message) : r.error
    toast(text)
    show({ title: 'Payment link', text, warn: !r.ok || !!r.warning })
  }

  function copyPayLink() {
    const url = p.payUrl
    if (!url) return
    const failed = () => show({ title: 'Payment link', text: `Couldn’t copy. ${first}’s payment link is ${url}`, warn: true })
    const clip = navigator.clipboard
    if (!clip) return failed()
    clip.writeText(url).then(() => {
      const text = `Copied ${first}’s payment link. Paste it into a text or email to ${first}. It isn’t the guest invite.`
      toast(text)
      show({ title: 'Payment link', text })
    }, failed)
  }

  // "Email Stefanie the details": one request at a time (the button is off while it goes), a new key for every
  // deliberate tap, the same key only for the one automatic retry after the network dropped (the server may have
  // sent it already: the same key answers that result instead of a second email). A failed send never sticks to
  // a key: the next tap is a new key, so "tap again" always tries again. The button stays until it went (m3).
  const sendingDetails = useRef(false)
  async function sendDetails() {
    if (sendingDetails.current) return
    sendingDetails.current = true
    setBusy('details')
    const createKey = newKey()
    let r = await api<{ message: string; sent: boolean | null }>(PARTY_ACTIONS, { id: p.bookingId, action: 'send-details', createKey })
    if (!r.ok && r.status === 0) {
      await new Promise((res) => setTimeout(res, 1500))
      r = await api<{ message: string; sent: boolean | null }>(PARTY_ACTIONS, { id: p.bookingId, action: 'send-details', createKey })
    }
    sendingDetails.current = false
    setBusy('')
    if (!r.ok || !r.data) {
      const text = r.error ?? DIDNT_SAVE
      toast(text)
      return show({ title: 'Email', text, warn: true })
    }
    applied(r.data)
    const text = r.warning ?? r.data.message
    toast(text)
    show({ title: 'Email', text, warn: r.data.sent !== true })
  }

  async function markTold() {
    const r = await act<{ message: string }>({ action: 'mark-told', ...(p.notTold ? { notToldAt: p.notTold.at } : {}) }, 'told')
    const text = r.ok ? r.data.message : r.error
    toast(text)
    show({ title: r.ok ? 'Noted' : 'Didn’t save', text, warn: !r.ok })
  }

  async function takeOff(it: PartyItem) {
    const r = await act<{ message: string }>({ action: 'remove-extra', itemId: it.id }, `off-${it.id}`)
    const text = r.ok ? (r.warning ?? r.data.message) : r.error
    toast(text)
    show({ title: 'Extras', text, warn: !r.ok || !!r.warning })
  }

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
  const paidRows = p.charges.length + p.refunds.length

  // The footer keeps only Call and Text while a panel, the card box or a form is open (I7: nothing pinned under them).
  const quiet = cancelled || started || panel !== null || taking || adding || editing
  const footer: ReactNode = quiet
    ? <CallText phone={p.hostPhone} />
    : (
      <div className="adm-stack">
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => setPanel('move')}>Move</button>
          <button type="button" className="adm-btn is-danger" onClick={() => setPanel('cancel')}>Cancel party</button>
        </div>
        <CallText phone={p.hostPhone} />
      </div>
    )

  const statusTag = <span className={`adm-tag${p.paymentState === 'paid' ? ' is-grey' : p.paymentState === 'cancelled' ? ' is-red' : ''}`}>{STATE_WORDS[p.paymentState]}</span>

  return (
    <SheetFrame tall title={partyTitle(p.hostName, p.craftName)} subtitle={<>{when} {statusTag}</>} footer={footer}>
      {told && (
        <div className={`adm-panel adm-gap-bottom adm-toldpanel${told.warn ? ' is-warn' : ''}`} role="group" aria-labelledby={`${toldId}-h`}>
          <h3 id={`${toldId}-h`} ref={toldHead} tabIndex={-1} aria-describedby={`${toldId}-t`}>{told.title}</h3>
          <span id={`${toldId}-t`}>{told.text}</span>
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setTold(null)}>Done</button>
        </div>
      )}
      {p.notTold && (
        <NotTold party={p} busy={busy} onEmail={sendDetails} onTold={markTold} />
      )}
      {panel === 'move' && <MovePanel party={p} onClose={() => setPanel(null)} onMoved={(t) => { setPanel(null); show(t) }} />}
      {panel === 'cancel' && (
        <CancelPanel party={p} paidCents={paidCents} onClose={() => setPanel(null)} onDone={(t) => { setPanel(null); setTab('details'); show(t) }} />
      )}
      {cancelled && (
        <div className="adm-panel is-warn adm-gap-bottom">
          <b>{`Cancelled${p.cancelled ? ` ${dayAndClock(p.cancelled.at)} by ${p.cancelled.by.name}` : ''}`}</b>
          <span className="adm-small">{paidCents > 0 ? `Nothing was refunded. ${formatMoney(paidCents)} is still with us. Use Refund on the Payments tab if ${first} should get money back.` : 'Nothing is owed either way.'}</span>
        </div>
      )}
      <HoldPanels party={p} onDone={(text) => show({ title: 'Held time', text })} />
      {p.overlap && !cancelled && (
        <div className="adm-panel is-warn adm-gap-bottom" role="alert">
          <b>Two parties at once</b>
          <span className="adm-small">{`${first} paid after this time was taken by another party. Nothing was refunded. Move one of the parties, then let the hosts know.`}</span>
        </div>
      )}
      <Seg label="Party" value={tab} onChange={setTab} options={[['details', 'Details'], ['guests', 'Guests'], ['pay', p.dueCents > 0 && !cancelled ? `Payments · ${formatMoney(p.dueCents)} due` : 'Payments'], ['staff', 'Staff']]} />

      {tab === 'staff' && <StaffRow eventKey={`party:${p.bookingId}`} startIso={p.startIso} />}

      {tab === 'details' && (
        editing
          ? <EditDetails party={p} onClose={() => setEditing(false)} onSaved={(t) => { setEditing(false); show(t) }} />
          : (
            <>
              {kv('When', <>{when}{extraMinutes > 0 && <><br />{`includes ${extraMinutes} minutes of extra time`}</>}</>)}
              {kv('Host', p.hostName)}
              {kv('Phone', p.hostPhone ? <a href={telHref(p.hostPhone)}>{prettyPhone(p.hostPhone)}</a> : '')}
              {kv('Email', p.hostEmail ? <a href={`mailto:${p.hostEmail}`}>{p.hostEmail}</a> : '')}
              {kv('Guests', p.guestCount)}
              {kv('Craft', p.craftName)}
              {p.items.filter((it) => it.kind === 'package').map((it) => kv('Package', `${it.label} · ${formatMoney(it.cents)}`, it.id))}
              {kv('Extras', p.items.filter((it) => it.kind === 'addon').map(itemWords).join(', ') || 'None')}
              {p.themeName && kv('Themed table', p.themeName)}
              {kv('Payment', STATE_WORDS[p.paymentState])}
              {!p.notTold && p.told && kv('Host told', `${p.told.how === 'email' ? 'Emailed the details' : 'Told by phone or text'} · ${dayAndClock(p.told.at)}${p.told.by ? ` · ${p.told.by.name}` : ''}`)}
              {!cancelled && (
                <div className="adm-stack adm-gap-top">
                  {p.sendDetails && !p.notTold && (
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
          <div className="adm-paygroup" role="group" aria-label={cancelled ? 'What was bought' : 'What’s due'}>
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
                {p.payUrl && (
                  <>
                    <button type="button" className="adm-btn is-ghost" onClick={copyPayLink}>Copy payment link</button>
                    <p className="adm-small adm-muted" style={{ margin: 0 }}>{`The link ${first} pays ${formatMoney(p.dueCents)} with. It isn’t the guest invite.`}</p>
                    <span className="adm-linkbox">{p.payUrl}</span>
                  </>
                )}
                <button type="button" className="adm-btn is-ghost" onClick={() => setTaking(true)}>Take card now</button>
              </div>
            )}
            {canPay && taking && <TakeCard party={p} onClose={() => setTaking(false)} onPaid={(t) => { setTaking(false); show(t) }} />}
          </div>

          {!cancelled && (
            <div className="adm-paygroup">
              {adding
                ? <AddExtra party={p} onClose={() => setAdding(false)} onAdded={(text, warn) => { setAdding(false); toast(text); show({ title: 'Extras', text, warn }) }} />
                : <button type="button" className="adm-btn is-ghost" onClick={() => setAdding(true)}>+ Add an extra</button>}
            </div>
          )}

          {paidRows > 0 && (
            <details className="adm-fold-group adm-paygroup" open={paidRows <= 2}>
              <summary><span>{`Payments and refunds (${paidRows})`}</span><i className="adm-chevron" aria-hidden="true" /></summary>
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
            </details>
          )}
          {(charges.some((c) => c.left > 0) || waiting) && (
            <div className="adm-paygroup">
              <AmountRefundPanel partyId={p.bookingId} payer={p.hostName} charges={charges} waiting={waiting} cancelled={cancelled} send={(url, body) => api(url, body)}
                onDone={(text) => { bump(); show({ title: 'Refund', text }) }} />
            </div>
          )}
          {p.charges.some((c) => c.simulated) && <p className="adm-small adm-muted">A test payment with no real card can’t be refunded.</p>}
        </section>
      )}
    </SheetFrame>
  )
}

/**
 * "Not told yet" (DV8): the host hasn't heard about a move, a cancel or a
 * change. Stays until the details email goes out or someone taps I told them.
 */
function NotTold({ party: p, busy, onEmail, onTold }: { party: AdminParty; busy: string; onEmail: () => void; onTold: () => void }) {
  const id = useId()
  const first = firstOf(p.hostName)
  const n = p.notTold!
  const cancelled = p.status === 'cancelled'
  return (
    <div className="adm-panel is-warn adm-gap-bottom adm-toldpanel" role="group" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{`Not told yet · let ${first} know`}</h3>
      <span>{n.message}</span>
      {!cancelled && p.sendDetails && (
        <button type="button" className="adm-btn is-pri" disabled={busy === 'details'} onClick={onEmail}>{busy === 'details' ? 'Sending…' : p.sendDetails.label}</button>
      )}
      {(p.hostPhone || p.hostEmail) && (
        <div className="adm-contactrow">
          {p.hostPhone && <a className="adm-btn is-ghost" href={telHref(p.hostPhone)}>Call</a>}
          {p.hostPhone && <a className="adm-btn is-ghost" href={smsHref(p.hostPhone)}>Text</a>}
          {p.hostEmail && <a className="adm-btn is-ghost" href={`mailto:${p.hostEmail}`}>{`Write to ${first}`}</a>}
        </div>
      )}
      <button type="button" className="adm-btn is-ghost" disabled={busy === 'told'} onClick={onTold}>{busy === 'told' ? 'Saving…' : 'I told them'}</button>
      <span className="adm-small adm-muted">{cancelled
        ? `Nothing is sent to ${first} on its own. Once you’ve called or texted, tap I told them. It notes who told them and when.`
        : `Nothing is sent to ${first} on its own. The email sends the new details and a calendar invite. If you called or texted instead, tap I told them.`}</span>
    </div>
  )
}

function copyInvite(p: AdminParty, toast: (t: string) => void) {
  const url = partyInviteUrl({ bookingId: p.bookingId, craftName: p.craftName, slotLabel: formatSlotLabel(p.startIso), startIso: p.startIso, ...(p.title ? { title: p.title } : {}) }, window.location.origin)
  const clip = navigator.clipboard
  if (!clip) return toast(`Couldn’t copy. The link is ${url}`)
  clip.writeText(url).then(() => toast(`Copied the invite link for ${firstOf(p.hostName)}’s guests.`), () => toast(`Couldn’t copy. The link is ${url}`))
}

/** A panel's heading takes focus when it opens, so the keyboard and VoiceOver land in it (I4). */
function useFocusOnOpen() {
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    head.current?.focus({ preventScroll: true })
    head.current?.scrollIntoView?.({ block: 'start' })
  }, [])
  return head
}

// ── Move ────────────────────────────────────────────────────────────────────

function MovePanel({ party: p, onClose, onMoved }: { party: AdminParty; onClose: () => void; onMoved: (t: Told) => void }) {
  const { bump } = useRefresh()
  const applied = useApplied()
  const toast = useToast()
  const head = useFocusOnOpen()
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
  const first = firstOf(p.hostName)

  // The record couldn't be checked after a move (both times held): "Finish the move" sends it again with the
  // times the server named, which finishes it whichever time the party is on.
  const [finish, setFinish] = useState<{ from: string; to: string } | null>(null)
  // The party's time isn't held (Minor D): the refusal comes with Hold this time again, right here.
  const [holdFirst, setHoldFirst] = useState(false)
  async function holdAgain() {
    if (busy) return
    setBusy(true)
    setRefusal('')
    const r = await api<{ message: string }>(PARTY_ACTIONS, { id: p.bookingId, action: 'hold-again' })
    setBusy(false)
    if (!r.ok || !r.data) return setRefusal(r.error ?? DIDNT_SAVE)
    setHoldFirst(false)
    applied(r.data)
    toast(r.data.message)
    retry()
  }
  async function move(target?: { from: string; to: string }) {
    const to = target?.to ?? startIso
    if (!to || busy) return
    setBusy(true)
    setRefusal('')
    const r = await api<{ message: string; hostToTell: HostToTell; sendDetails: SendDetailsOffer | null; from: string | null; to: string }>(PARTY_ACTIONS, { id: p.bookingId, action: 'move', startIso: to, fromIso: target?.from ?? p.startIso })
    setBusy(false)
    if (!r.ok || !r.data) {
      setRefusal(r.error ?? DIDNT_SAVE)
      setHoldFirst(r.extra?.holdAgain === true)
      const both = r.extra?.both as { from: string; to: string } | undefined
      setFinish(both && typeof both.from === 'string' && typeof both.to === 'string' ? both : null)
      // Someone else moved it, or it may have moved: show the party as it is now.
      if (both || typeof r.extra?.startIso === 'string') bump()
      retry()
      return
    }
    setFinish(null)
    setHoldFirst(false)
    applied(r.data)
    toast(r.data.message)
    // Nothing moved (already on that time): a plain "Nothing changed" heading.
    const moved = !r.data.from || Date.parse(r.data.from) !== Date.parse(r.data.to)
    onMoved({ title: moved ? `Moved ${first}’s party` : 'Nothing changed', text: r.warning ?? r.data.message, warn: !!r.warning })
  }

  return (
    <div className="adm-panel adm-actpanel" role="group" aria-labelledby={`move-${p.bookingId}`}>
      <h3 id={`move-${p.bookingId}`} ref={head} tabIndex={-1}>{`Move ${first}’s party`}</h3>
      <span className="adm-small">{`Now ${dayAndClock(p.startIso)}. Its length, extras and payments stay the same. Nothing is sent to ${first}.`}</span>
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
      {holdFirst && !finish && (
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={holdAgain}>{busy ? 'Holding…' : 'Hold this time again'}</button>
      )}
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

/**
 * The party book's repairs, each one button with its own safety rules on the server:
 * "Hold this time again" (a booked party whose time isn't held), "Free this time" (a cancelled
 * party still holding a time), "Free the old time" (a leftover hold after a move, sent with the
 * start and version this screen shows so a stale screen is refused) and "Put the end time back"
 * (held past the party's end). Nothing is sent to the host and no money moves.
 */
function HoldPanels({ party: p, onDone }: { party: AdminParty; onDone: (text: string) => void }) {
  const { bump } = useRefresh()
  const applied = useApplied()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [refusal, setRefusal] = useState('')
  const st = p.holdState
  if (!st) return null
  const first = firstOf(p.hostName)
  const cancelled = p.status === 'cancelled'
  async function send(body: Record<string, unknown>, tag: string) {
    setBusy(tag)
    setRefusal('')
    const r = await api<{ message: string }>(PARTY_ACTIONS, { id: p.bookingId, ...body })
    setBusy('')
    if (!r.ok || !r.data) {
      // Changed elsewhere since this screen loaded: show the party as it is now (the refusal stays).
      if (typeof r.extra?.startIso === 'string') bump()
      return setRefusal(r.error ?? DIDNT_SAVE)
    }
    setAsking(null)
    // The reply carries the party book's view: the panel that was acted on goes at once (the reload follows).
    applied(r.data)
    toast(r.data.message)
    onDone(r.data.message)
  }
  const notHeld = !cancelled && st.notHeld
  const longer = !cancelled && !notHeld && st.longer === true
  if (!notHeld && !longer && st.freeable.length === 0) return null
  return (
    <div className="adm-stack adm-gap-bottom">
      {notHeld && (
        <div className="adm-panel is-warn" role="group" aria-label="Not held on the calendar">
          <b>{st.notHeld === 'short' ? 'Extra time not held on the calendar' : 'Not held on the calendar'}</b>
          <span className="adm-small">{st.notHeld === 'short'
            ? `The extra time of ${first}’s party isn’t held, so someone else could book right after it. Holding it again keeps the party where it is and sends nothing to ${first}.`
            : `${dayAndClock(p.startIso)} isn’t held for ${first}’s party, so someone else could book it. Holding it again keeps the party where it is and sends nothing to ${first}.`}</span>
          <button type="button" className="adm-btn is-pri" disabled={busy === 'hold'} onClick={() => send({ action: 'hold-again' }, 'hold')}>{busy === 'hold' ? 'Holding…' : 'Hold this time again'}</button>
        </div>
      )}
      {longer && (
        <div className="adm-panel is-warn" role="group" aria-label="Held longer than the party">
          <b>Held longer than the party</b>
          <span className="adm-small">{`The calendar holds ${first}’s party past its end (extra time that wasn’t added), so nobody can book right after it. Putting the end time back frees that time. The party stays as it is and nothing is sent to ${first}.`}</span>
          <button type="button" className="adm-btn is-ghost" disabled={busy === 'fit'} onClick={() => send({ action: 'fit-hold' }, 'fit')}>{busy === 'fit' ? 'Putting it back…' : 'Put the end time back'}</button>
        </div>
      )}
      {st.freeable.map((f) => {
        const when = dayAndClock(f.startIso)
        const own = Date.parse(f.startIso) === Date.parse(p.startIso)
        const button = f.why === 'cancelled' ? (own ? 'Free this time' : `Free ${when}`) : `Free the old time (${when})`
        const tag = `free-${f.startIso}`
        if (asking === f.startIso) {
          return (
            <div key={tag} className="adm-panel is-warn" role="group" aria-label={`Free ${when}?`}>
              <b>{f.why === 'cancelled' ? `Free ${when} so others can book it?` : `${first}’s party stays on ${dayAndClock(p.startIso)}. Free ${when}?`}</b>
              <span className="adm-small">{`Nothing is sent to ${first} and no money moves.`}</span>
              <div className="adm-two">
                <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(null); setRefusal('') }}>Keep it</button>
                <button type="button" className="adm-btn is-danger" disabled={busy === tag} onClick={() => send({ action: 'free-time', startIso: f.startIso, shownStartIso: p.startIso, shownVersion: p.timeVersion }, tag)}>{busy === tag ? 'Freeing…' : (f.why === 'cancelled' ? 'Free this time' : 'Free the old time')}</button>
              </div>
            </div>
          )
        }
        return (
          <div key={tag} className="adm-panel is-warn" role="group" aria-label={`${when} still held`}>
            <b>{`${when} is still held`}</b>
            <span className="adm-small">{f.why === 'cancelled'
              ? `This party was cancelled, but ${when} is still held for it, so nobody can book that time.`
              : `${first}’s party moved to ${dayAndClock(p.startIso)}, but ${when} is still held for it, so nobody can book that time.`}</span>
            <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(f.startIso); setRefusal('') }}>{button}</button>
          </div>
        )
      })}
      {refusal && <p className="adm-error" role="alert">{refusal}</p>}
    </div>
  )
}

function CancelPanel({ party: p, paidCents, onClose, onDone }: { party: AdminParty; paidCents: number; onClose: () => void; onDone: (t: Told) => void }) {
  const applied = useApplied()
  const toast = useToast()
  const head = useFocusOnOpen()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const first = firstOf(p.hostName)
  async function cancel() {
    setBusy(true)
    setRefusal('')
    const r = await api<{ message: string; hostToTell: HostToTell }>(PARTY_ACTIONS, { id: p.bookingId, action: 'cancel' })
    setBusy(false)
    if (!r.ok || !r.data) return setRefusal(r.error ?? DIDNT_SAVE)
    applied(r.data)
    toast(r.data.message)
    onDone({ title: `Cancelled ${first}’s party`, text: r.warning ?? r.data.message, warn: !!r.warning })
  }
  return (
    <div className="adm-panel is-warn adm-actpanel" role="group" aria-labelledby={`cancel-${p.bookingId}`}>
      <h3 id={`cancel-${p.bookingId}`} ref={head} tabIndex={-1}>{`Cancel ${first}’s party?`}</h3>
      <span className="adm-small">{`${dayAndClock(p.startIso)}. ${paidCents > 0 ? `${p.hostName} has paid ${formatMoney(paidCents)}.` : 'Nothing has been paid.'}`}</span>
      <span className="adm-small">{`The time opens up on the calendar. This does not refund anything, and nothing is sent to ${first}. Use Refund on the Payments tab if they should get money back.`}</span>
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
  const applied = useApplied()
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
    applied(r.data)
    toast(r.warning ?? r.data.message)
    const nothing = r.data.message === 'Nothing changed.'
    onSaved({
      title: nothing ? 'Nothing changed' : 'Details saved',
      text: nothing ? 'Nothing changed.' : `${r.warning ?? 'Saved.'} Nothing was sent to ${firstOf(f.hostName)}.`,
      warn: !!r.warning,
    })
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

function AddExtra({ party: p, onClose, onAdded }: { party: AdminParty; onClose: () => void; onAdded: (text: string, warn: boolean) => void }) {
  const applied = useApplied()
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
  // A different choice is a different extra: a new key, so a retry never replays the first choice (m5).
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    key.current = newKey()
  }, [addOnId, count, newGuests])

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
    applied(r.data)
    onAdded(`${r.warning ?? r.data.message} Nothing was sent to ${firstOf(p.hostName)}.`, !!r.warning)
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
  const applied = useApplied()
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
    applied(r.data)
    toast(r.data.message)
    onPaid({ title: 'Card payment', text: r.data.message })
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

