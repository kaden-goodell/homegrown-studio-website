/**
 * The "Hold December 12 · $1,500" button on /for/corky, and the
 * small sheet that takes the deposit right there: name, email, phone, then
 * Square's payment form (Apple Pay / Google Pay / card).
 *
 * Wired like the party payment link (PartyPayPanel): PaymentForm fetches the
 * client config itself and runs under our own app (no app id override, which
 * Apple Pay needs); one attempt id per payment, kept while the outcome is
 * unclear so a retry is recognised, replaced once the server answers plainly;
 * the payment bypass on previews shows the form's test card and the server
 * simulates. The amount is fixed on the server; this only shows it.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { attemptIdFor, forgetPendingAttempt, newAttemptId, rememberPendingAttempt } from '@lib/checkout-attempt'
import { noteVisit, readVisitorId } from '@lib/quote/corky-visit-client'
import { HELD_EVENT } from '@lib/quote/corky-page'

export const BUTTON_LABEL = 'Hold December 12 · $1,500'
export const TITLE = 'Hold December 12'
export const SUBLINE = 'Corky Child Care Collective · $1,500 deposit, comes off your total'
export const PAYING = 'Holding your date…'
export const DONE_TITLE = 'You’re all set.'
export const DONE_LINE = 'Your date is held. We’ll text you to confirm.'
export const UNCLEAR_LINE = 'We’re checking on your payment. We’ll text you.'
export const CARD_UNREADABLE = 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.'
export const HELD_LINE = 'December 12 is held · Deposit paid'
export const FILL_FIRST = 'Add your name, email and phone first.'
const FALLBACK_ERROR = 'That didn’t go through. Nothing was charged. Please try again.'

const SCOPE = 'corky-deposit'
const SHAPE = '150000'
const AMOUNT = '1500.00'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** The night she picked on the page (set by corky-page.ts), or null. */
export function currentNight(): string | null {
  const v = typeof document !== 'undefined' ? document.body.dataset.pick : undefined
  return v ? v : null
}

/** Monograms added on the page (only ever true with the tote night). */
export function currentMonogram(): boolean {
  return typeof document !== 'undefined' && document.body.dataset.monogram === 'true'
}

/** Tell the page the date is held, so it locks the night in (this page load; the server keeps it for reloads). */
function announceHeld(night: string | null, monogram: boolean) {
  try {
    window.dispatchEvent(new CustomEvent(HELD_EVENT, { detail: { night, monogram } }))
  } catch { /* never in the way */ }
}

type Field = 'firstName' | 'lastName' | 'email' | 'phone'
type Stage = 'form' | 'done' | 'unclear'

function phoneOk(v: string): boolean {
  let d = v.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10
}

export function problemsFor(c: Record<Field, string>): Partial<Record<Field, string>> {
  const p: Partial<Record<Field, string>> = {}
  if (!c.firstName.trim()) p.firstName = 'Add your first name.'
  if (!c.lastName.trim()) p.lastName = 'Add your last name.'
  if (!EMAIL_RE.test(c.email.trim())) p.email = 'Add an email we can send the receipt to.'
  if (!phoneOk(c.phone)) p.phone = 'Add a 10-digit phone number.'
  return p
}

export default function CorkyDeposit() {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('form')
  const [contact, setContact] = useState<Record<Field, string>>({ firstName: '', lastName: '', email: '', phone: '' })
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({})
  const [processing, setProcessing] = useState(false)
  const [paymentReady, setPaymentReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  /** Paid already (this load, or found by the page on load from another device). */
  const [held, setHeld] = useState(false)
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const attemptId = useRef('')
  const triggerRef = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  // The page found the date already paid (reload, another device), or this sheet just paid.
  useEffect(() => {
    if (document.body.dataset.held === 'true') setHeld(true)
    const on = () => setHeld(true)
    window.addEventListener(HELD_EVENT, on)
    return () => window.removeEventListener(HELD_EVENT, on)
  }, [])

  // Open: lock the page behind, focus the first field. Close: focus goes back to the button.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => (stage === 'form' ? firstFieldRef.current : sheetRef.current)?.focus(), 30)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
      triggerRef.current?.focus()
    }
  }, [open])

  // Leaving while a payment is going through: the browser asks first.
  useEffect(() => {
    if (!processing) return
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', stay)
    return () => window.removeEventListener('beforeunload', stay)
  }, [processing])

  function openSheet() {
    if (!attemptId.current) attemptId.current = attemptIdFor(SCOPE, SHAPE)
    setError(null)
    setOpen(true)
    noteVisit('sheet')
  }

  function close() {
    if (processing) return
    setOpen(false)
  }

  const endAttempt = () => {
    forgetPendingAttempt(SCOPE, attemptId.current)
    attemptId.current = newAttemptId()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'Tab' || !sheetRef.current) return
    const focusable = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function checkFields(): boolean {
    const p = problemsFor(contact)
    setProblems(p)
    return Object.keys(p).length === 0
  }

  async function handlePay(walletToken?: string) {
    if (processing) return
    setError(null)
    if (!checkFields()) return
    setProcessing(true)
    noteVisit('pay')
    try {
      let token = walletToken
      let verificationToken: string | undefined
      let sourceKind: 'card' | 'gift_card' | 'wallet' = 'wallet'
      if (!token) {
        try {
          const t = await paymentFormRef.current!.tokenizeAndVerify({
            givenName: contact.firstName.trim(), familyName: contact.lastName.trim(), email: contact.email.trim(), phone: contact.phone.trim(),
            amount: AMOUNT, currencyCode: 'USD',
          })
          token = t.token
          verificationToken = t.verificationToken
          sourceKind = t.kind ?? 'card'
        } catch {
          setError(CARD_UNREADABLE)
          return
        }
      }
      if (!attemptId.current) attemptId.current = attemptIdFor(SCOPE, SHAPE)
      rememberPendingAttempt(SCOPE, attemptId.current, SHAPE)
      let res: Response
      try {
        res = await fetch('/api/quote/corky-deposit.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId: attemptId.current, paymentToken: token, ...(verificationToken ? { verificationToken } : {}), sourceKind,
            firstName: contact.firstName.trim(), lastName: contact.lastName.trim(), email: contact.email.trim(), phone: contact.phone.trim(),
            night: currentNight(), monogram: currentMonogram(), visitorId: readVisitorId(),
          }),
        })
      } catch {
        // No answer at all: it may have gone through. Keep the attempt, never say nothing was charged.
        setStage('unclear')
        return
      }
      const body = await res.json().catch(() => null)
      if (res.status === 200 && body?.data?.paid) {
        endAttempt()
        noteVisit('paid')
        announceHeld(currentNight(), currentMonogram())
        setReceiptUrl(typeof body.data.receiptUrl === 'string' ? body.data.receiptUrl : null)
        setStage('done')
        return
      }
      if (res.status === 202 || (res.status >= 500 && !body?.code)) {
        setStage('unclear')
        return
      }
      if (body?.code === 'unknown_outcome') {
        setStage('unclear')
        return
      }
      // A plain answer (declined, check your details, try again): this attempt is over, except "slow down".
      if (res.status !== 429) endAttempt()
      setError(typeof body?.detail === 'string' && body.detail ? body.detail : FALLBACK_ERROR)
    } finally {
      setProcessing(false)
    }
  }

  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setContact((c) => ({ ...c, [f]: v }))
    if (problems[f]) setProblems((p) => ({ ...p, [f]: undefined }))
  }

  const field = (f: Field, label: string, type: string, autoComplete: string, extra?: { half?: boolean; ref?: React.Ref<HTMLInputElement>; inputMode?: 'tel' | 'email' }) => (
    <label className={`cd-field${extra?.half ? ' half' : ''}`}>
      <span>{label}</span>
      <input
        ref={extra?.ref}
        type={type}
        name={f}
        autoComplete={autoComplete}
        inputMode={extra?.inputMode}
        value={contact[f]}
        onChange={set(f)}
        aria-invalid={problems[f] ? true : undefined}
        aria-describedby={problems[f] ? `cd-${f}-err` : undefined}
        disabled={processing}
        required
      />
      {problems[f] && <em id={`cd-${f}-err`} className="cd-err">{problems[f]}</em>}
    </label>
  )

  const sheet = (
    <div className="cd-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={sheetRef}
        className="cd-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <button type="button" className="cd-x" aria-label="Close" onClick={close} disabled={processing}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="cd-frame">
          {stage === 'form' && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                void handlePay()
              }}
            >
              <h2 id="cd-title">{TITLE}</h2>
              <svg className="cd-rule" aria-hidden="true" width="96" height="12" viewBox="0 0 120 14" fill="none" stroke="#b8925a" strokeWidth="1.2"><path d="M0 7h48M72 7h48" /><path d="M60 1l5 6-5 6-5-6z" /></svg>
              <p className="cd-sub">{SUBLINE}</p>
              <div className="cd-fields">
                {field('firstName', 'First name', 'text', 'given-name', { half: true, ref: firstFieldRef })}
                {field('lastName', 'Last name', 'text', 'family-name', { half: true })}
                {field('email', 'Email', 'email', 'email', { inputMode: 'email' })}
                {field('phone', 'Phone', 'tel', 'tel', { inputMode: 'tel' })}
              </div>
              <p className="cd-why">For your receipt, and so we can reach you about the night.</p>
              <div className="cd-pay">
                <PaymentForm
                  bookingKind="party"
                  ref={paymentFormRef}
                  wallet={{ amount: AMOUNT, label: 'Hometown Studio deposit' }}
                  giftCards="none"
                  onWalletToken={(token) => void handlePay(token)}
                  canPayWithWallet={() => (Object.keys(problemsFor(contact)).length === 0 ? null : (checkFields(), FILL_FIRST))}
                  onReadyChange={setPaymentReady}
                />
              </div>
              {error && <p role="alert" className="cd-alert">{error}</p>}
              <button type="submit" className="cd-btn" disabled={!paymentReady || processing}>
                {processing ? PAYING : !paymentReady ? 'Loading the payment form…' : 'Pay $1,500 deposit'}
              </button>
              <p className="cd-agree">Paying means you agree to <a href="#details" onClick={() => close()}>the details</a> above.</p>
              {processing && <p role="status" className="cd-sr">{PAYING}</p>}
            </form>
          )}
          {stage === 'done' && (
            <div className="cd-end" role="status">
              <svg className="cd-check" aria-hidden="true" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#b8925a" strokeWidth="1.4"><circle cx="22" cy="22" r="20.5" /><path d="M14 22.5l5.5 5.5L30.5 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <h2 id="cd-title">{DONE_TITLE}</h2>
              <p>{DONE_LINE}</p>
              {receiptUrl && <a className="cd-link" href={receiptUrl} target="_blank" rel="noopener noreferrer">See your receipt</a>}
              <button type="button" className="cd-btn" onClick={close}>Done</button>
            </div>
          )}
          {stage === 'unclear' && (
            <div className="cd-end" role="status">
              <h2 id="cd-title">Thank you</h2>
              <p>{UNCLEAR_LINE}</p>
              <button type="button" className="cd-btn" onClick={close}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <style>{CSS}</style>
      {held || stage === 'done' ? (
        <div className="cd-held">
          <p ref={(el) => { triggerRef.current = el }} tabIndex={-1} role="status">{HELD_LINE}</p>
          {receiptUrl && !open && <a href={receiptUrl} target="_blank" rel="noopener noreferrer">See your receipt</a>}
        </div>
      ) : (
        <button ref={(el) => { triggerRef.current = el }} type="button" className="cd-trigger" onClick={openSheet} aria-haspopup="dialog">{BUTTON_LABEL}</button>
      )}
      {open && mounted && createPortal(sheet, document.body)}
    </>
  )
}

const CSS = `
.cd-trigger { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 3.5rem; border: 0; border-radius: 999px; background: linear-gradient(180deg, #ecd9b4, #d9bf8e); color: #1f3329; font: inherit; font-weight: 600; font-size: 1.05rem; cursor: pointer; transition: transform 0.15s ease; box-shadow: 0 0.4rem 1.2rem rgba(0,0,0,0.25); }
.cd-trigger:hover { transform: translateY(-1px); }
.cd-trigger:focus-visible { outline: 3px solid #f1d7b6; outline-offset: 3px; }
.cd-held { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; animation: cd-fade 0.6s ease-out both; }
.cd-held p { margin: 0; width: 100%; display: flex; align-items: center; justify-content: center; min-height: 3.5rem; padding: 0 1rem; border: 1px solid rgba(216,189,138,0.7); border-radius: 999px; color: #ecd9b4; font-family: 'Playfair Display', serif; font-style: italic; font-size: 1.1rem; outline: none; }
.cd-held a { color: #ecd9b4; font-size: 0.85rem; text-underline-offset: 3px; }

.cd-scrim { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(23,36,30,0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); animation: cd-fade 0.32s ease-out both; }
.cd-sheet { position: relative; width: 100%; max-width: 27rem; max-height: calc(100dvh - 2rem); overflow-y: auto; overscroll-behavior: contain; background: #fffdf8; border-radius: 6px; padding: 0.55rem; box-shadow: 0 1.5rem 3.5rem rgba(20,32,26,0.35); color: #3f3a33; font-family: Inter, sans-serif; animation: cd-rise 0.42s cubic-bezier(.22,.7,.3,1) both; outline: none; }
.cd-frame { border: 1px solid #b8925a; outline: 1px solid rgba(184,146,90,0.55); outline-offset: -6px; padding: 2rem 1.35rem 1.5rem; }
.cd-x { position: absolute; top: 1rem; right: 1rem; width: 2.75rem; height: 2.75rem; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #6f665b; cursor: pointer; transition: background 0.2s ease, color 0.2s ease; z-index: 1; }
.cd-x:hover { background: rgba(184,146,90,0.12); color: #1f3329; }
.cd-x:focus-visible { outline: 2px solid #b8925a; outline-offset: 2px; }
.cd-x:disabled { opacity: 0.4; cursor: default; }
.cd-sheet h2 { margin: 0; text-align: center; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 500; font-size: 1.9rem; line-height: 1.1; color: #23392f; }
.cd-rule { display: block; margin: 0.7rem auto 0.6rem; }
.cd-sub { margin: 0 0 1.35rem; text-align: center; font-size: 0.9rem; line-height: 1.5; color: #6f665b; }
.cd-fields { display: flex; flex-wrap: wrap; gap: 0.8rem 0.7rem; }
.cd-field { flex: 1 1 100%; display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.cd-field.half { flex: 1 1 8rem; }
.cd-field span { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #9a7a46; }
.cd-field input { width: 100%; min-height: 2.9rem; padding: 0.55rem 0.75rem; border: 1px solid #ddd0bd; border-radius: 4px; background: #fff; color: #23392f; font: inherit; font-size: 1rem; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.cd-field input:focus { outline: none; border-color: #b8925a; box-shadow: 0 0 0 3px rgba(184,146,90,0.2); }
.cd-field input[aria-invalid='true'] { border-color: #7d2530; }
.cd-err { font-style: normal; font-size: 0.8rem; color: #7d2530; }
.cd-why { margin: 0.7rem 0 1.2rem; font-size: 0.8rem; line-height: 1.45; color: #6f665b; }
.cd-agree { margin: 0.6rem 0 0; text-align: center; font-size: 0.78rem; color: #6f665b; }
.cd-agree a { color: #7d2530; }
.cd-pay { padding-top: 1.15rem; border-top: 1px solid rgba(184,146,90,0.4); }
.cd-alert { margin: 0.9rem 0 0; padding: 0.7rem 0.85rem; border-left: 2px solid #7d2530; background: rgba(125,37,48,0.05); font-size: 0.92rem; line-height: 1.45; color: #5c1c24; }
.cd-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 3.25rem; margin-top: 1.1rem; border: 0; border-radius: 999px; background: #1f3329; color: #f3e6cc; font: inherit; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s ease, opacity 0.2s ease; }
.cd-btn:hover:not(:disabled) { background: #2b4a3a; }
.cd-btn:focus-visible { outline: 3px solid #b8925a; outline-offset: 3px; }
.cd-btn:disabled { opacity: 0.6; cursor: default; }
.cd-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.cd-end { display: flex; flex-direction: column; align-items: center; gap: 0.7rem; text-align: center; padding: 0.75rem 0 0; animation: cd-fade 0.45s ease-out both; }
.cd-end p { margin: 0; font-family: 'Playfair Display', serif; font-size: 1.1rem; line-height: 1.45; color: #23392f; }
.cd-check { margin-bottom: 0.25rem; }
.cd-link { color: #7d2530; font-size: 0.95rem; text-underline-offset: 3px; }
.cd-end .cd-btn { margin-top: 0.6rem; }
@keyframes cd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cd-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 420px) {
  .cd-scrim { padding: 0.6rem; align-items: flex-end; }
  .cd-sheet { max-height: calc(100dvh - 1.2rem); }
  .cd-frame { padding: 1.85rem 1rem 1.25rem; }
}
@media (prefers-reduced-motion: reduce) {
  .cd-scrim, .cd-sheet, .cd-end, .cd-held { animation: none; }
  .cd-trigger, .cd-x, .cd-btn, .cd-field input { transition: none; }
  .cd-trigger:hover { transform: none; }
}
`
