import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EventRequest } from '@lib/event-request-options'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import { draftTiers } from '@lib/quotes/draft'
import { depositCents, totalCents } from '@lib/quotes/money'
import { DEFAULT_SETTINGS, type Quote, type QuoteSettings, type Tier } from '@lib/quotes/types'
import { partsOf, toIsoAt } from '../classes/dates'
import { useInboxMaybe } from '../inbox/InboxData'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { dayAndClock } from '../shell/time'
import {
  centsFromDollars, chipClass, chipText, dollarsFromCents, draftQuote, loadMenu, loadQuote, quoteAction, saveQuote,
  savePackageFrom, sendQuote, stateOf, type MenuData,
} from './api'
import { tierMoney, TierCard } from './TierCard'

const HOUR_MS = 3_600_000

type Clash = { label: string; startIso: string }
type Panel =
  | { kind: 'redraft'; cents: number }
  | { kind: 'send'; resend: boolean }
  | { kind: 'overcap'; then: 'send' | 'save'; resend?: boolean }
  | { kind: 'clash'; clash: Clash | null; canSkipHold: boolean; resend?: boolean }
  | { kind: 'withdraw' }

/** The facts as the boxes hold them (text, so a half-typed box doesn't jump). */
interface Facts { date: string; time: string; hours: string; guests: string; deposit: string; reply: string }

function factsOf(q: Quote, request: EventRequest | null): Facts {
  const start = q.startIso ? partsOf(q.startIso) : { day: request?.event.date ?? '', time: '' }
  const hours = q.startIso && q.endIso ? (Date.parse(q.endIso) - Date.parse(q.startIso)) / HOUR_MS : 2
  return {
    date: start.day, time: start.time, hours: String(Math.round(hours * 100) / 100),
    guests: String(q.guests), deposit: String(q.depositPct), reply: localDate(q.expiresAt),
  }
}

const posInt = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null)

/** What each box says is wrong, if anything. */
function factErrors(f: Facts): Partial<Record<keyof Facts, string>> {
  const e: Partial<Record<keyof Facts, string>> = {}
  const g = posInt(f.guests)
  if (g == null || g < 1) e.guests = 'Type how many guests, 1 or more.'
  const d = posInt(f.deposit)
  if (d == null || d < 1 || d > 100) e.deposit = 'Type a deposit from 1 to 100%.'
  const h = Number(f.hours)
  if (!(h > 0 && h <= 24)) e.hours = 'Type how many hours, like 2 or 2.5.'
  if (!f.reply) e.reply = 'Pick a reply-by date.'
  return e
}

/** The quote with the boxes' facts applied; facts left as they were keep the stored times exactly. */
function withFacts(q: Quote, f: Facts, was: Facts, base: Quote): Quote {
  const out = { ...q }
  const g = posInt(f.guests)
  if (g && g >= 1) out.guests = g
  const d = posInt(f.deposit)
  if (d && d >= 1 && d <= 100) out.depositPct = d
  if (f.date !== was.date || f.time !== was.time || f.hours !== was.hours) {
    const h = Number(f.hours) > 0 ? Number(f.hours) : 2
    if (f.date && f.time) {
      const start = toIsoAt(f.date, f.time)
      out.startIso = start
      out.endIso = new Date(Date.parse(start) + h * HOUR_MS).toISOString()
    } else {
      out.startIso = null
      out.endIso = null
    }
  } else {
    out.startIso = base.startIso
    out.endIso = base.endIso
  }
  out.expiresAt = f.reply !== was.reply && f.reply ? toIsoAt(f.reply, '23:59') : base.expiresAt
  return out
}

const overCap = (q: Quote, s: QuoteSettings) => q.tiers.some((t) => !t.hidden && tierMoney(t, q.guests, s).meter === 'red')

/** The request's quote (`#quote-<requestId>`): loads it and the quote menu, then the editor. */
export function QuoteSheet({ id: requestId }: { id: string }) {
  const inbox = useInboxMaybe()
  const request = inbox?.request.items?.find((r) => r.id === requestId) ?? null
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined)
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let live = true
    setError('')
    Promise.all([loadQuote(requestId), loadMenu()]).then(([q, m]) => {
      if (!live) return
      if (m.ok && m.data) setMenu(m.data)
      if (q.ok && q.data) setQuote(q.data.quote)
      else setError(q.error ?? 'That didn’t load.')
    })
    return () => { live = false }
  }, [requestId, tries])

  const name = request?.about.name ?? ''
  const title = name ? `Quote for ${name.split(' ')[0]}` : 'Quote'
  if (error) return <SheetFrame title={title}><Failed message={error} onRetry={() => setTries((n) => n + 1)} /></SheetFrame>
  if (quote === undefined) return <SheetFrame title={title} tall><Skeleton rows={4} label="Loading the quote" /></SheetFrame>
  if (quote === null) return <NoQuote requestId={requestId} request={request} title={title} onQuote={setQuote} />
  return (
    <QuoteEditor
      initial={quote}
      request={request}
      title={title}
      menu={menu}
      onPackages={(packages) => setMenu((m) => (m ? { ...m, packages } : m))}
      onChanged={() => inbox?.request.retry()}
    />
  )
}

/** No quote yet: one button that drafts it (asking first when the request is already Quoted or Booked). */
function NoQuote({ requestId, request, title, onQuote }: { requestId: string; request: EventRequest | null; title: string; onQuote: (q: Quote) => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settled = request?.status === 'quoted' || request?.status === 'booked'
  async function make() {
    setBusy(true)
    setError('')
    const r = await draftQuote(requestId, request?.status === 'booked' ? { force: true } : {})
    setBusy(false)
    if (r.ok && r.data) onQuote(r.data.quote)
    else setError(r.error ?? 'That didn’t work. Try again.')
  }
  return (
    <SheetFrame title={title} tall footer={!asking ? <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => (settled ? setAsking(true) : make())}>{busy ? 'Making it…' : 'Make a quote'}</button> : undefined}>
      <p className="adm-note">No quote for this request yet. Make one and we’ll fill in packages from the quote menu.</p>
      {asking && <MakeAnyway status={request?.status ?? ''} busy={busy} onNo={() => setAsking(false)} onYes={() => { setAsking(false); make() }} />}
      {error && <p className="adm-error" role="alert">{error}</p>}
    </SheetFrame>
  )
}

/** "This request is already Booked. Make a quote anyway?", in the sheet. */
export function MakeAnyway({ status, busy, onNo, onYes }: { status: string; busy?: boolean; onNo: () => void; onYes: () => void }) {
  const label = status === 'booked' ? 'Booked' : 'Quoted'
  return (
    <div className="adm-panel" role="group" aria-label="Make a quote anyway?">
      <b>{`This request is already ${label}. Make a quote anyway?`}</b>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onNo}>Not now</button>
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={onYes}>Make a quote</button>
      </div>
    </div>
  )
}

function QuoteEditor({ initial, request, title, menu, onPackages, onChanged }: {
  initial: Quote
  request: EventRequest | null
  title: string
  menu: MenuData | null
  onPackages: (p: MenuData['packages']) => void
  /** The request's status may have moved (send, withdraw, reopen): read the inbox again. */
  onChanged: () => void
}) {
  const sheet = useSheet()
  const settings = menu?.settings ?? DEFAULT_SETTINGS
  const [base, setBase] = useState(initial)
  const [q, setQ] = useState(initial)
  const [was, setWas] = useState(() => factsOf(initial, request))
  const [facts, setFacts] = useState(was)
  const [target, setTarget] = useState(dollarsFromCents(initial.targetCents))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [text, setText] = useState(true)
  const [email, setEmail] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  const overCapOk = useRef(false)
  const dateBox = useRef<HTMLInputElement>(null)

  const state = stateOf(base)
  const editable = state === 'draft' || state === 'sent' || state === 'picked' || state === 'expired'
  const open = base.status === 'sent' || base.status === 'picked'
  const built = withFacts(q, facts, was, base)
  const errors = factErrors(facts)
  const invalid = Object.keys(errors).length > 0 || q.tiers.some((t) => !t.name.trim())
  const dirty = editable && JSON.stringify(built) !== JSON.stringify(base)
  useSheetDirty(dirty)

  const first = request?.about.name.split(' ')[0] ?? 'them'
  const phone = request?.about.phone ?? ''
  const mail = request?.about.email ?? ''

  /** A fresh copy from the server: everything on screen follows it. */
  function take(next: Quote) {
    const f = factsOf(next, request)
    setBase(next); setQ(next); setWas(f); setFacts(f); setTarget(dollarsFromCents(next.targetCents))
    setError(''); setStale(false)
  }
  const setFact = (k: keyof Facts, v: string) => { setFacts((cur) => ({ ...cur, [k]: v })); setNotice('') }
  const setTier = (t: Tier) => { setQ((cur) => ({ ...cur, tiers: cur.tiers.map((x) => (x.id === t.id ? t : x)) })); setNotice('') }

  async function reload() {
    setBusy(true)
    const r = await loadQuote(base.requestId)
    setBusy(false)
    if (r.ok && r.data?.quote) take(r.data.quote)
    else setError(r.error ?? 'That didn’t load. Try again.')
  }

  function refused(r: { error?: string; extra: Record<string, any> }, then: 'send' | 'save', resend = false): void {
    const why = r.extra.why
    if (why === 'over_cap') { setPanel({ kind: 'overcap', then, resend }); return }
    if (why === 'time_taken') { setPanel({ kind: 'clash', clash: r.extra.clash ?? null, canSkipHold: then === 'send' && !resend && built.place === 'studio' }); return }
    if (why === 'stale') setStale(true)
    setPanel(null)
    setError(r.error ?? 'That didn’t work. Try again.')
  }

  /** Save the edits; the saved quote, or null after showing why not. */
  async function save(): Promise<Quote | null> {
    if (open && overCap(built, settings) && !overCapOk.current) { setPanel({ kind: 'overcap', then: 'save' }); return null }
    setBusy(true)
    setError('')
    const r = await saveQuote(built, base.version, overCapOk.current)
    setBusy(false)
    if (r.ok && r.data) return r.data.quote
    refused(r, 'save')
    return null
  }

  async function saveClick() {
    const saved = await save()
    if (!saved) return
    overCapOk.current = false
    take(saved)
    setPanel(null)
    setNotice(open ? 'Saved. The customer will see “Updated” on their page.' : 'Saved.')
  }

  async function send(resend: boolean, noHold = false) {
    if (overCap(built, settings) && !overCapOk.current) { setPanel({ kind: 'overcap', then: 'send', resend }); return }
    let cur = base
    if (dirty) {
      const saved = await save()
      if (!saved) return
      take(saved)
      cur = saved
    }
    setBusy(true)
    setError('')
    const r = resend
      ? await quoteAction(cur.id, 'resend', { text, email })
      : await sendQuote(cur.id, { text, email, overCapOk: overCapOk.current, noHold })
    setBusy(false)
    if (!r.ok || !r.data) { refused(r, 'send', resend); return }
    overCapOk.current = false
    take(r.data.quote)
    setPanel(null)
    const how = [text && phone ? 'text' : '', email && mail ? 'email' : ''].filter(Boolean).join(' and ')
    setNotice(`${resend ? 'Sent again' : 'Sent'} to ${first}${how ? ` by ${how}` : ''}.${noHold ? ' The time isn’t held.' : ''}`)
    onChanged()
  }

  async function act(action: 'withdraw' | 'reopen') {
    setBusy(true)
    setError('')
    const r = await quoteAction(base.id, action)
    setBusy(false)
    if (!r.ok || !r.data) {
      if (r.extra.why === 'time_taken') { setPanel({ kind: 'clash', clash: r.extra.clash ?? null, canSkipHold: false }); return }
      setPanel(null)
      setError(r.error ?? 'That didn’t work. Try again.')
      return
    }
    take(r.data.quote)
    setPanel(null)
    setNotice(action === 'withdraw' ? 'Quote withdrawn.' : 'Reopened. Their link works again.')
    onChanged()
  }

  function redraft(cents: number) {
    const tiers = draftTiers({
      menu: menu?.items ?? [], targetCents: cents, guests: built.guests, crafters: built.crafters,
      month: Number(facts.date.slice(5, 7)) || new Date().getMonth() + 1,
      theme: [request?.craft.theme, request?.craft.vision].filter(Boolean).join(' '),
    }, settings)
    setPanel(null)
    if (!tiers.length) { setError('Nothing on the quote menu fits that price. Try a higher price, or add lines by hand.'); return }
    setError('')
    setQ((cur) => ({ ...cur, targetCents: cents, tiers }))
  }

  async function savePkg(t: Tier): Promise<string> {
    const r = await savePackageFrom({ name: t.name.trim(), photoUrl: t.photoUrl, lines: t.lines })
    if (r.ok && r.data) { onPackages(r.data.packages); return '' }
    return r.error ?? 'That didn’t save. Try again.'
  }

  const targetCents = centsFromDollars(target)
  const visible = built.tiers.filter((t) => !t.hidden)
  const partyDay = base.startIso ? localDate(base.startIso) : null

  const subtitle = (
    <>
      <span className={chipClass(state)} style={{ marginLeft: 0 }}>{chipText(state, base.views)}</span>
      {request && ` ${[request.about.name, phone, mail].filter(Boolean).join(' · ')}`}
    </>
  )

  let footer: ReactNode = null
  if (panel?.kind === 'send' || panel?.kind === 'overcap' || panel?.kind === 'clash' || panel?.kind === 'withdraw' || panel?.kind === 'redraft') footer = null
  else if (state === 'paid' || state === 'paying') {
    footer = partyDay ? <button type="button" className="adm-btn is-pri" onClick={() => sheet.open({ kind: 'party', day: partyDay, id: base.partyId })}>Open the party</button> : null
  } else if (state === 'withdrawn') {
    footer = <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => act('reopen')}>{busy ? 'Reopening…' : 'Reopen'}</button>
  } else if (state === 'draft') {
    footer = (
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" disabled={!dirty || invalid || busy} onClick={saveClick}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="adm-btn is-pri" disabled={invalid || busy} onClick={() => { setNotice(''); setPanel({ kind: 'send', resend: false }) }}>{`Send to ${first}`}</button>
      </div>
    )
  } else if (dirty) {
    footer = <button type="button" className="adm-btn is-pri" disabled={invalid || busy} onClick={saveClick}>{busy ? 'Saving…' : 'Save changes'}</button>
  } else if (state === 'expired') {
    footer = <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => act('reopen')}>{busy ? 'Reopening…' : 'Reopen'}</button>
  } else {
    footer = <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => { setNotice(''); setPanel({ kind: 'send', resend: true }) }}>{`Send again to ${first}`}</button>
  }

  return (
    <SheetFrame title={title} subtitle={subtitle} tall footer={footer}>
      {notice && <p className="adm-done" role="status">{notice}</p>}
      {state === 'paid' && <p className="adm-note">Paid. This is a party now: changes go on the party.</p>}
      {state === 'paying' && <p className="adm-note">They’re paying the deposit right now. Nothing here can change.</p>}
      {state === 'withdrawn' && <p className="adm-note">Withdrawn. Their link says it’s no longer available. Reopen to send it again.</p>}
      {state === 'expired' && <p className="adm-note">Their reply-by date has passed. Change anything you like, then Reopen.</p>}
      {open && dirty && <p className="adm-warntext">The customer will see “Updated” on their page once you save.</p>}

      <h3 className="adm-lbl">The event</h3>
      {editable ? (
        <>
          <div className="adm-two">
            <label className="adm-fld"><span>Date</span><input ref={dateBox} type="date" value={facts.date} onChange={(e) => setFact('date', e.target.value)} /></label>
            <label className="adm-fld"><span>Start time</span><input type="time" value={facts.time} onChange={(e) => setFact('time', e.target.value)} /></label>
          </div>
          {!facts.time && <p className="adm-small adm-muted">Add a start time before sending.</p>}
          <div className="adm-two">
            <label className="adm-fld"><span>How long (hours)</span><input inputMode="decimal" value={facts.hours} onChange={(e) => setFact('hours', e.target.value)} /></label>
            <label className="adm-fld"><span>Guests</span><input inputMode="numeric" value={facts.guests} onChange={(e) => setFact('guests', e.target.value)} /></label>
          </div>
          {errors.hours && <p className="adm-fielderr" role="alert">{errors.hours}</p>}
          {errors.guests && <p className="adm-fielderr" role="alert">{errors.guests}</p>}
          <Seg<'studio' | 'away'> label="Where" value={q.place} options={[['studio', 'At the studio'], ['away', 'At their place']]} onChange={(place) => { setQ((cur) => ({ ...cur, place })); setNotice('') }} />
          {q.place === 'away' && (
            <label className="adm-fld adm-gap-top"><span>Their address</span><input value={q.address} onChange={(e) => setQ((cur) => ({ ...cur, address: e.target.value }))} /></label>
          )}
        </>
      ) : (
        <dl className="adm-ans">
          <div><dt>When</dt><dd>{base.startIso ? dayAndClock(base.startIso) : 'No time yet'}</dd></div>
          <div><dt>Guests</dt><dd>{base.guests}</dd></div>
          <div><dt>Where</dt><dd>{base.place === 'away' ? `At their place: ${base.address}` : 'At the studio'}</dd></div>
        </dl>
      )}

      {editable && (
        <>
          <h3 className="adm-lbl adm-gap-top">Target price</h3>
          <label className="adm-fld"><span>Target price per person ($)</span><input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          {targetCents != null && targetCents > 0 && targetCents !== q.targetCents && (
            <button type="button" className="adm-btn is-ghost adm-gap-top" disabled={!menu} onClick={() => setPanel({ kind: 'redraft', cents: targetCents })}>
              {`Build packages around ${formatMoney(targetCents)}`}
            </button>
          )}
          {panel?.kind === 'redraft' && (
            <div className="adm-panel" role="group" aria-label="Replace the packages?">
              <b>This replaces the packages.</b>
              <p className="adm-small">{`New packages are built from the quote menu around ${formatMoney(panel.cents)} per person. Your changes to the packages go away.`}</p>
              <div className="adm-two">
                <button type="button" className="adm-btn is-ghost" onClick={() => setPanel(null)}>Keep them</button>
                <button type="button" className="adm-btn is-danger" onClick={() => redraft(panel.cents)}>Replace</button>
              </div>
            </div>
          )}
        </>
      )}

      <h3 className="adm-lbl adm-gap-top">Packages</h3>
      {built.tiers.length === 0 && <p className="adm-empty">No packages yet. Set a target price above to build some.</p>}
      {built.tiers.map((t, i) => (
        <TierCard
          key={t.id}
          n={i + 1}
          tier={t}
          guests={built.guests}
          settings={settings}
          items={menu?.items ?? []}
          packages={menu?.packages ?? []}
          editable={editable}
          onChange={setTier}
          onSavePackage={savePkg}
        />
      ))}

      <h3 className="adm-lbl adm-gap-top">For the customer</h3>
      {editable ? (
        <>
          <label className="adm-fld"><span>Note to the customer</span><textarea rows={3} maxLength={1000} value={q.note} onChange={(e) => setQ((cur) => ({ ...cur, note: e.target.value }))} /></label>
          <div className="adm-two adm-gap-top">
            <label className="adm-fld"><span>Deposit (%)</span><input inputMode="numeric" value={facts.deposit} onChange={(e) => setFact('deposit', e.target.value)} /></label>
            <label className="adm-fld"><span>Reply by</span><input type="date" value={facts.reply} onChange={(e) => setFact('reply', e.target.value)} /></label>
          </div>
          {errors.deposit && <p className="adm-fielderr" role="alert">{errors.deposit}</p>}
          {errors.reply && <p className="adm-fielderr" role="alert">{errors.reply}</p>}
          {visible.length > 0 && (
            <p className="adm-small adm-muted">
              {visible.map((t) => {
                const total = totalCents(t.priceCents, built.guests)
                return `${t.name}: deposit ${formatMoney(depositCents(total, built.depositPct))}`
              }).join(' · ')}
            </p>
          )}
        </>
      ) : (
        <dl className="adm-ans">
          {base.note && <div><dt>Note</dt><dd>{base.note}</dd></div>}
          <div><dt>Deposit</dt><dd>{`${base.depositPct}%`}</dd></div>
        </dl>
      )}

      {panel?.kind === 'send' && (
        <div className="adm-panel" role="group" aria-label={panel.resend ? 'Send it again' : 'Send the quote'}>
          <b>{`${panel.resend ? 'Send the link again' : 'Send the quote'} to ${first}`}</b>
          {phone && <label className="adm-check"><input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} /> {`Text ${phone}`}</label>}
          {mail && <label className="adm-check"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> {`Email ${mail}`}</label>}
          {!panel.resend && built.place === 'studio' && <p className="adm-small adm-muted">The time is held for them until the reply-by date.</p>}
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setPanel(null)}>Not yet</button>
            <button type="button" className="adm-btn is-pri" disabled={busy || (!(text && phone) && !(email && mail) && !!(phone || mail))} onClick={() => send(panel.resend)}>
              {busy ? 'Sending…' : 'Send now'}
            </button>
          </div>
        </div>
      )}
      {panel?.kind === 'overcap' && (
        <div className="adm-panel" role="group" aria-label="More than the limit off">
          <b>{`A package is more than ${settings.capPct}% off its normal price.`}</b>
          <p className="adm-small">{`${panel.then === 'send' ? 'Send' : 'Save'} it anyway?`}</p>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setPanel(null)}>Go back</button>
            <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => {
              overCapOk.current = true
              if (panel.then === 'send') send(!!panel.resend)
              else saveClick()
            }}>{panel.then === 'send' ? 'Send anyway' : 'Save anyway'}</button>
          </div>
        </div>
      )}
      {panel?.kind === 'clash' && (
        <div className="adm-panel" role="group" aria-label="That time is taken">
          <b>That time is taken.</b>
          {panel.clash && <p className="adm-small">{`${panel.clash.label} · ${dayAndClock(panel.clash.startIso)}`}</p>}
          {panel.canSkipHold && <p className="adm-small adm-muted">You can send it without holding the time. We hold it for 15 minutes when they pay, if it’s free then.</p>}
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => { setPanel(null); dateBox.current?.focus() }}>Pick another time</button>
            {panel.canSkipHold && <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => send(false, true)}>Send without holding</button>}
          </div>
        </div>
      )}
      {panel?.kind === 'withdraw' && (
        <div className="adm-panel" role="group" aria-label="Withdraw this quote?">
          <b>Withdraw this quote?</b>
          <p className="adm-small">Their link stops working and the time is let go. You can reopen it later.</p>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setPanel(null)}>Keep it</button>
            <button type="button" className="adm-btn is-danger" disabled={busy} onClick={() => act('withdraw')}>{busy ? 'Withdrawing…' : 'Withdraw'}</button>
          </div>
        </div>
      )}

      {error && <p className="adm-error" role="alert">{error}</p>}
      {stale && <button type="button" className="adm-btn is-ghost" disabled={busy} onClick={reload}>Load the latest</button>}

      <h3 className="adm-lbl adm-gap-top">More</h3>
      <div className="adm-qactions">
        <a className="adm-btn is-ghost is-sm" href={`/quote/${base.token}`} target="_blank" rel="noopener">Preview their page</a>
        <a className="adm-btn is-ghost is-sm" href={`/admin/quote/${base.id}/flyer`} target="_blank" rel="noopener">Flyer</a>
        {editable && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setNotice(''); setPanel({ kind: 'withdraw' }) }}>Withdraw</button>}
      </div>
    </SheetFrame>
  )
}
