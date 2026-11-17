/**
 * The customer's private event quote page (/quote/<token>), in the approved
 * "Invitation" style (canvas "C · The Invitation"; hand-built reference:
 * the Corky Christmas quote). Spec §3 Public, §7 Customer page, §8.
 *
 * Prices, totals and the deposit all come from the server (view.json); this
 * only shows them. Picking a package tells the server once per change
 * (pick.json). Paying sends the package, the view's priceKey (so a quote
 * that changed under the page is refused, never charged at new prices) and
 * one attempt id per payment, kept while the outcome is unknown so a retry
 * is recognised, replaced once the server says plainly nothing was charged
 * (same rule as the party pay link). The payment bypass on test sites is the
 * server's (pay.json reads it like /api/party/pay.json).
 *
 * Copy is short on purpose: photos lead, few words.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { attemptIdFor, forgetPendingAttempt, rememberPendingAttempt } from '@lib/checkout-attempt'
import { UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { POLICY_ANCHORS, POLICY_PATH } from '@config/policy-content'
import { partyConfig } from '@config/party.config'
import { formatMoney } from '@lib/money'
import './quote.css'

// ── What view.json answers (src/lib/quotes/public-view.ts; the browser can't import it) ──

type Per = 'person' | 'event'
interface Line { label: string; photoUrl: string | null; per: Per; cents: number }
interface Tier {
  id: string
  key: 'simple' | 'pick' | 'all' | 'custom'
  name: string
  photoUrl: string | null
  lines: Line[]
  normalPerPersonCents: number
  priceCents: number
  totalCents: number
  depositCents: number
  offPct: number
}
interface OpenView {
  state: 'open'
  firstName: string
  event: { startIso: string | null; endIso: string | null; guests: number; place: 'studio' | 'away'; address?: string }
  note: string
  expiresAt: string
  updatedAt?: string
  depositPct: number
  tiers: Tier[]
  pickedTierId?: string
  priceKey?: string
}
interface PaidView { state: 'paid'; date: string; tierName: string; paidCents: number; dueCents: number; payUrl?: string; hostUrl: string }
type View = OpenView | PaidView | { state: 'paying' } | { state: 'cancelled' } | { state: 'closed' } | { state: 'booked' }

// ── Copy (the server's refusals carry their own sentence; these are the page's own) ──

const PHONE = '(256) 464-1710'
const SMS = 'sms:+12564641710'
/** Same words as QUOTE_CLOSED_MESSAGE in src/lib/quotes/pay.ts. */
export const CLOSED_LINE = `This quote is no longer available. Text us at ${PHONE}.`
/** Same words as QUOTE_CHECKING_MESSAGE in src/lib/quotes/pay.ts. */
export const CHECKING_LINE = 'We’re checking your payment. We’ll text you.'
export const CANCELLED_LINE = 'This event was cancelled, so nothing is due.'
export const BOOKED_LINE = 'Your date is held. We’ll text you soon.'
export const LOAD_FAILED = 'We couldn’t load this quote just now. Please try again in a minute.'
const CARD_UNREADABLE = 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.'
const TRY_AGAIN = 'That didn’t go through, so nothing was charged. Please try again.'

// ── Dates and times in words, studio time ──

const TZ = partyConfig.timezone
const ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
  'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth',
  'thirty-first',
]
const HOURS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven']

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))) out[p.type] = p.value
  return out
}

/** "Saturday, December twelfth" */
export function dayInWords(iso: string): string {
  const p = parts(iso)
  return `${p.weekday}, ${p.month} ${ORDINALS[Number(p.day)] ?? p.day}`
}

/** "Tuesday, November 24" */
function dayShort(iso: string): string {
  const p = parts(iso)
  return `${p.weekday}, ${p.month} ${p.day}`
}

/** "November 18" */
function monthDay(iso: string): string {
  const p = parts(iso)
  return `${p.month} ${p.day}`
}

/** "half past five", "seven o’clock", "quarter to six"; any other minute stays in digits ("5:20"). */
export function timeInWords(iso: string): string {
  const p = parts(iso)
  const h = Number(p.hour) % 24
  const m = Number(p.minute)
  const name = (hour: number) => HOURS[hour % 12]
  if (m === 0) return `${name(h)} o’clock`
  if (m === 30) return `half past ${name(h)}`
  if (m === 15) return `quarter past ${name(h)}`
  if (m === 45) return `quarter to ${name(h + 1)}`
  return `${h % 12 || 12}:${p.minute}`
}

const money = formatMoney

// ── The page ──

interface Props { token: string }

export default function QuotePage({ token }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [tierId, setTierId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<{ text: string; reload?: boolean } | null>(null)
  const formRef = useRef<PaymentFormRef>(null)
  /** The package the server last heard was picked. */
  const sentPick = useRef<string | null>(null)
  /** This payment's attempt: kept while its outcome is unknown, for the same package and amount. */
  const attempt = useRef<{ id: string; shape: string } | null>(null)
  const scope = `quote:${token}`

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch(`/api/quote/view.json?t=${encodeURIComponent(token)}`)
      if (!res.ok) return setLoadError(true)
      const json = await res.json()
      const v = json?.data as View | undefined
      if (!v || typeof v !== 'object' || !('state' in v)) return setLoadError(true)
      if (v.state === 'open') {
        const pick = v.tiers.find((t) => t.id === v.pickedTierId) ?? v.tiers.find((t) => t.key === 'pick') ?? v.tiers[0]
        sentPick.current = v.pickedTierId ?? null
        setTierId(pick?.id ?? null)
      }
      setError(null)
      setView(v)
    } catch {
      setLoadError(true)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  // Leaving or reloading while a payment is going through: the browser asks first.
  useEffect(() => {
    if (!processing) return
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', stay)
    return () => window.removeEventListener('beforeunload', stay)
  }, [processing])

  const open = view?.state === 'open' ? view : null
  const tier = open?.tiers.find((t) => t.id === tierId) ?? null

  function choose(id: string) {
    if (processing || id === tierId) return
    setTierId(id)
    setError(null)
    if (id === sentPick.current) return
    sentPick.current = id
    void fetch('/api/quote/pick.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, tierId: id }),
    })
      .then((res) => { if (res.status === 410) setView({ state: 'closed' }) })
      .catch(() => { /* A pick is a hint for the owners; paying sends the package anyway. */ })
  }

  const endAttempt = () => {
    if (attempt.current) forgetPendingAttempt(scope, attempt.current.id)
    attempt.current = null
  }

  async function pay(walletToken?: string) {
    if (processing || !open || !tier) return
    setError(null)
    setProcessing(true)
    try {
      let paymentToken = walletToken
      let sourceKind: 'card' | 'gift_card' = 'card'
      if (!paymentToken) {
        try {
          const t = await formRef.current!.tokenize()
          paymentToken = t.token
          sourceKind = t.kind
        } catch {
          return setError({ text: CARD_UNREADABLE })
        }
      }
      const shape = `${tier.id}:${tier.depositCents}`
      if (!attempt.current || attempt.current.shape !== shape) attempt.current = { id: attemptIdFor(scope, shape), shape }
      rememberPendingAttempt(scope, attempt.current.id, shape)
      let res: Response
      try {
        res = await fetch('/api/quote/pay.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: token, tierId: tier.id, priceKey: open.priceKey ?? '', attemptId: attempt.current.id, pay: { paymentToken, sourceKind } }),
        })
      } catch {
        return setError({ text: UNKNOWN_OUTCOME_MESSAGE })
      }
      const body = await res.json().catch(() => null)
      const why: string | undefined = body?.why
      if (res.ok && res.status === 200) {
        endAttempt()
        return await afterPaid()
      }
      // Not sure how it ended: keep the attempt, so trying again can't charge twice.
      if (res.status === 202 || why === 'checking') return setError({ text: CHECKING_LINE })
      if (res.status === 429 || why === 'busy') return setError({ text: body?.error ?? CHECKING_LINE })
      if (!why && res.status >= 500) return setError({ text: UNKNOWN_OUTCOME_MESSAGE })
      // A plain answer: nothing was charged, the next try is a new attempt.
      endAttempt()
      if (res.status === 410 || why === 'closed') return setView({ state: 'closed' })
      if (why === 'price_changed' || why === 'tier_unavailable' || res.status === 400) {
        return setError({ text: body?.error ?? TRY_AGAIN, reload: true })
      }
      setError({ text: body?.error ?? TRY_AGAIN })
    } finally {
      setProcessing(false)
    }
  }

  /** Paid: show the receipt the server now has. */
  async function afterPaid() {
    try {
      const res = await fetch(`/api/quote/view.json?t=${encodeURIComponent(token)}`)
      const v = res.ok ? ((await res.json())?.data as View | undefined) : undefined
      setView(v && (v.state === 'paid' || v.state === 'paying') ? v : { state: 'booked' })
    } catch {
      setView({ state: 'booked' })
    }
  }

  return <main className="qi">{renderBody()}</main>

  function renderBody() {
    if (loadError) {
      return (
        <Notice>
          <p role="alert" className="qi-msg">{LOAD_FAILED}</p>
          <button type="button" className="qi-btn qi-btn-light" onClick={() => void load()}>Try again</button>
        </Notice>
      )
    }
    if (!view) return <p role="status" className="qi-loading">Loading your evening…</p>
    if (view.state === 'closed') {
      return (
        <Notice>
          <p className="qi-msg">{CLOSED_LINE}</p>
          <a className="qi-btn qi-btn-light" href={SMS}>Text us</a>
        </Notice>
      )
    }
    if (view.state === 'cancelled') {
      return (
        <Notice>
          <p className="qi-msg">{CANCELLED_LINE}</p>
          <a className="qi-btn qi-btn-light" href={SMS}>Text us</a>
        </Notice>
      )
    }
    if (view.state === 'paying' || view.state === 'booked') {
      return (
        <>
          <Notice>
            <p role="status" className="qi-msg">{view.state === 'paying' ? CHECKING_LINE : BOOKED_LINE}</p>
            {view.state === 'paying' && (
              <button type="button" className="qi-btn qi-btn-light" onClick={() => void load()}>Check again</button>
            )}
          </Notice>
          <SignOff />
        </>
      )
    }
    if (view.state === 'paid') return <Receipt v={view} />
    return renderOpen(view)
  }

  function renderOpen(v: OpenView) {
    const photos = polaroidPhotos(v.tiers)
    const { startIso, endIso, guests, place, address } = v.event
    const where = place === 'away' ? `at ${address || 'your place'}` : 'at the studio'
    return (
      <>
        {photos.length > 0 && (
          <div className={`qi-polaroids n${photos.length}`} aria-hidden="true">
            {photos.map((src, i) => <img key={src} className={`qi-pol p${i + 1}`} src={src} alt="" />)}
          </div>
        )}

        <section className={`qi-card${photos.length ? '' : ' flat'}`}>
          <div className="qi-frame">
            <p className="qi-kicker">Hometown Studio presents</p>
            <h1>An Evening of Making</h1>
            <Rule />
            {v.firstName && <p className="qi-for">for {v.firstName}</p>}
            <p className="qi-when">
              {startIso && <>{dayInWords(startIso)}<br /></>}
              {startIso && endIso && <>{timeInWords(startIso)} to {timeInWords(endIso)}<br /></>}
              {guests} {guests === 1 ? 'guest' : 'guests'} · {where}
            </p>
            {v.updatedAt && <p className="qi-updated">Updated {monthDay(v.updatedAt)}</p>}
          </div>
        </section>

        {v.note.trim() && (
          <p className="qi-note">
            {v.note.trim().split(/\n+/).map((l, i, all) => <span key={i}>{l}{i < all.length - 1 && <br />}</span>)}
          </p>
        )}

        {v.tiers.length > 1 && (
          <section className="qi-pick">
            <p className="qi-kicker center" id="qi-pick-label">Choose your evening</p>
            <div className="qi-tickets" role="radiogroup" aria-labelledby="qi-pick-label">
              {v.tiers.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={t.id === tierId}
                  className="qi-ticket"
                  disabled={processing}
                  onClick={() => choose(t.id)}
                >
                  {t.key === 'pick' && <span className="qi-ours">Our pick</span>}
                  <span className="qi-tname">{t.name}</span>
                  <span className="qi-tprice">{money(t.priceCents)}<small> a guest</small></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {tier && (
          <section className="qi-menu" aria-label={tier.name}>
            <div className="qi-menu-frame">
              <p className="qi-kicker center">The menu</p>
              <h2>{tier.name}</h2>
              <ul data-testid="menu">
                {tier.lines.map((l, i) => (
                  <li key={`${l.label}-${i}`}>
                    <span className="qi-lname">{l.label}</span>
                    <span className="leader" aria-hidden="true" />
                    <span className="qi-lprice">
                      <span>{money(l.cents)}</span>
                      {l.per === 'event' && <small> for the group</small>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="qi-price">
                <p className="qi-row muted">
                  <span>Menu value</span>
                  <span><s data-testid="normal-price">{money(tier.normalPerPersonCents)}</s> a guest</span>
                </p>
                <p className="qi-row big">
                  <span className="qi-your">Your price{tier.offPct > 0 && <em>{tier.offPct}% off</em>}</span>
                  <span className="qi-amt"><span data-testid="your-price">{money(tier.priceCents)}</span><small> a guest</small></span>
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="qi-included" aria-label="Always included">
          <p className="qi-kicker center">Always included</p>
          <div className="qi-grid">
            <Included icon="host">Your own hosts</Included>
            <Included icon="supply">Every supply</Included>
            <Included icon="clean">We set up &amp; clean up</Included>
            <Included icon="home">Everything goes home</Included>
          </div>
        </section>

        {tier && (
          <section className="qi-steps">
            <p className="qi-kicker center">How it works</p>
            <ol>
              <li><span><b>Hold your date.</b> {money(tier.depositCents)} today goes toward your total.</span></li>
              <li><span><b>Pay the rest later.</b> We’ll text you a link.</span></li>
              <li><span><b>Come make something.</b> We take care of the rest.</span></li>
            </ol>
          </section>
        )}

        {tier && (
          <section className="qi-reserve" aria-label="Hold your date">
            <p className="qi-kicker light">Kindly reply by {dayShort(v.expiresAt)}</p>
            <p className="qi-sum">{tier.name} · {money(tier.priceCents)} a guest</p>
            <dl className="qi-totals">
              <div><dt>{money(tier.priceCents)} × {guests} {guests === 1 ? 'guest' : 'guests'}</dt><dd data-testid="total">{money(tier.totalCents)}</dd></div>
              <div className="today"><dt>Due today</dt><dd data-testid="deposit">{money(tier.depositCents)}</dd></div>
            </dl>
            <form
              className="qi-payform"
              onSubmit={(e) => { e.preventDefault(); void pay() }}
            >
              <PaymentForm
                bookingKind="party"
                ref={formRef}
                wallet={{ amount: (tier.depositCents / 100).toFixed(2), label: 'Hometown Studio private event' }}
                onWalletToken={(t) => void pay(t)}
                onReadyChange={setReady}
              />
              {error && (
                <div className="qi-error">
                  <p role="alert">{error.text}</p>
                  {error.reload && (
                    <button type="button" className="qi-btn qi-btn-light small" onClick={() => void load()}>Reload</button>
                  )}
                </div>
              )}
              <button type="submit" className="qi-btn" disabled={!ready || processing}>
                {processing ? 'Holding…' : !ready ? 'Loading…' : `Hold my date · ${money(tier.depositCents)}`}
              </button>
            </form>
            <p className="qi-fine">
              The rest is paid later. <a href={`${POLICY_PATH}#${POLICY_ANCHORS.parties}`} target="_blank" rel="noopener">Our policies</a>
            </p>
          </section>
        )}

        <SignOff />
      </>
    )
  }
}

// ── Pieces ──

function polaroidPhotos(tiers: Tier[]): string[] {
  const out: string[] = []
  const add = (u: string | null) => { if (u && !out.includes(u) && out.length < 3) out.push(u) }
  tiers.forEach((t) => add(t.photoUrl))
  tiers.forEach((t) => t.lines.forEach((l) => add(l.photoUrl)))
  return out
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <section className="qi-card flat">
      <div className="qi-frame">
        <p className="qi-kicker">Hometown Studio</p>
        <Rule />
        {children}
      </div>
    </section>
  )
}

function Receipt({ v }: { v: PaidView }) {
  return (
    <>
      <section className="qi-card flat">
        <div className="qi-frame">
          <p className="qi-kicker">Hometown Studio</p>
          <h1>See you soon</h1>
          <Rule />
          <p className="qi-for">{v.tierName}</p>
          <p className="qi-when">{dayInWords(v.date)} at {timeInWords(v.date)}</p>
          <dl className="qi-receipt">
            <div><dt>Paid</dt><dd data-testid="paid">{money(v.paidCents)}</dd></div>
            <div><dt>Still due</dt><dd data-testid="due">{money(v.dueCents)}</dd></div>
          </dl>
          {v.dueCents > 0 && v.payUrl && <a className="qi-btn qi-btn-dark" href={v.payUrl}>Pay the rest</a>}
          <a className="qi-link" href={v.hostUrl}>Your event page</a>
        </div>
      </section>
      <SignOff />
    </>
  )
}

function SignOff() {
  return (
    <footer className="qi-sign">
      <p className="qi-love">with love, Catherine &amp; Kaden</p>
      <p>Questions? <a href={SMS}>Text us at {PHONE}</a></p>
    </footer>
  )
}

function Rule() {
  return (
    <svg className="qi-rule" aria-hidden="true" width="120" height="14" viewBox="0 0 120 14" fill="none" stroke="#c4a882" strokeWidth="1.2">
      <path d="M0 7h48M72 7h48" />
      <path d="M60 1l5 6-5 6-5-6z" />
    </svg>
  )
}

const ICONS: Record<string, React.ReactNode> = {
  host: <><circle cx="12" cy="7" r="3.5" /><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" /></>,
  supply: <path d="M4 7h16M4 12h16M4 17h10" />,
  clean: <path d="M3 12l3-3 4 4 8-8 3 3-11 11z" />,
  home: <path d="M4 9h16v11H4zM12 9v11M4 9l2-5h12l2 5" />,
}

function Included({ icon, children }: { icon: keyof typeof ICONS; children: React.ReactNode }) {
  return (
    <div>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7a4a2e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
      <span>{children}</span>
    </div>
  )
}
