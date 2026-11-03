/**
 * The payment link page: what a party still owes (the package and extras not
 * yet paid), a reminder that crafts are paid at the studio, Square's payment
 * form (card, Apple/Google Pay, gift card) and a paid screen.
 *
 * Prices come from the server; this only shows them. One attempt id per
 * payment, kept while the outcome is unknown so a retry is recognised, and
 * replaced once the server says plainly what happened (same rule as /book).
 *
 * DRAFT copy for Kaden throughout (no colons, no timelines).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { attemptIdFor, forgetPendingAttempt, newAttemptId, pendingAttempt, rememberPendingAttempt } from '@lib/checkout-attempt'
import { POLICY_ANCHORS, POLICY_PATH } from '@config/policy-content'
import { partyContent } from '@config/party-content'
import { messageForFailure, outcomeUnknown, partyMessages, UNKNOWN_OUTCOME_MESSAGE, TEXT_US } from '@lib/checkout-messages'
import { formatMoney } from '@lib/money'
import { rememberedPageKey } from '@lib/page-key'

interface Props {
  partyId: string
  payKey: string
}

interface Balance {
  when: string
  hostFirstName: string
  packageName: string
  items: { id: string; label: string; qty: number; cents: number }[]
  dueCents: number
  state: 'paid' | 'waiting' | 'partly' | 'legacy' | 'cancelled'
  receiptUrl: string | null
  /** a payment is going through right now */
  paying?: boolean
  /** the party is paid for; only extras added since are due */
  extrasOnly?: boolean
  /** the party cancellation policy for this date, in one line */
  refundLine?: string
}

export const PAY_HEADING = 'Pay for your party'
export const CRAFTS_LINE = 'Crafts are paid at the studio for whoever comes.'
export const LINK_BROKEN = `This payment link doesn’t work. Please ${TEXT_US} and we’ll send a new one.`
export const LOAD_FAILED = 'We couldn’t load this payment. Please try again.'
export const CANCELLED_LINE = partyContent.textNumber
  ? `This party was cancelled, so nothing is due. Questions about a payment? Text us at ${partyContent.textNumber}.`
  : 'This party was cancelled, so nothing is due.'
/** C2: an earlier payment from this tab never got a clear answer. */
export const EARLIER_PENDING = 'Your last payment for this party may still be going through. Check your email for a receipt before you pay again.'
export const BUSY_LINE = 'A payment for this party is already going through. Check back in a few minutes.'
export const AMOUNT_CHANGED = 'The amount changed. Refresh to see what’s due. Nothing was charged.'

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(var(--color-primary-rgb),0.16)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
  boxShadow: '0 18px 44px rgba(var(--color-primary-rgb),0.12)',
}
const helpText = { margin: 0, fontSize: '1rem', lineHeight: 1.5, color: 'var(--color-text)' } as const

export default function PartyPayPanel({ partyId, payKey }: Props) {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState<{ cents: number; receiptUrl: string | null; stillDueCents: number } | null>(null)
  const paymentFormRef = useRef<PaymentFormRef>(null)
  // C2: a payment still going through is kept for this tab, so a reload resumes it instead of paying twice.
  const scope = `party-pay:${partyId}`
  const attemptId = useRef('')
  const [earlierPending] = useState(() => pendingAttempt(scope))
  // The key is in the link (and the address bar); a copy kept in this tab covers an address without it.
  const linkKey = () => payKey || rememberedPageKey()
  useEffect(() => {
    if (balance) attemptId.current = attemptIdFor(scope, String(balance.dueCents))
  }, [balance?.dueCents])
  // Leaving or reloading while a payment is going through: the browser asks first.
  useEffect(() => {
    if (!processing) return
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', stay)
    return () => window.removeEventListener('beforeunload', stay)
  }, [processing])
  const endAttempt = () => {
    forgetPendingAttempt(scope, attemptId.current)
    attemptId.current = newAttemptId()
  }

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/party/balance.json?id=${encodeURIComponent(partyId)}&k=${encodeURIComponent(linkKey())}`)
      if (res.status === 404) return setLoadError(LINK_BROKEN)
      if (!res.ok) return setLoadError(LOAD_FAILED)
      const json = await res.json()
      setBalance(json.data as Balance)
    } catch {
      setLoadError(LOAD_FAILED)
    }
  }, [partyId, payKey])

  useEffect(() => {
    void load()
  }, [load])

  async function handlePay(walletToken?: string) {
    if (processing || !balance) return
    setError(null)
    setProcessing(true)
    try {
      let token = walletToken
      let sourceKind: 'card' | 'gift_card' = 'card'
      if (!token) {
        try {
          const t = await paymentFormRef.current!.tokenize()
          token = t.token
          sourceKind = t.kind
        } catch {
          throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        }
      }
      if (!attemptId.current) attemptId.current = attemptIdFor(scope, String(balance.dueCents))
      rememberPendingAttempt(scope, attemptId.current, String(balance.dueCents))
      let res: Response
      try {
        res = await fetch('/api/party/pay.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The amount shown: the server refuses anything else before any order.
          body: JSON.stringify({ id: partyId, k: linkKey(), attemptId: attemptId.current, expectedCents: balance.dueCents, paymentToken: token, sourceKind }),
        })
      } catch {
        throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const failure = { status: res.status, body }
        // A plain answer ends this attempt; "not sure", "another payment is going through" and "slow down" keep it.
        if (!(outcomeUnknown(failure) || body?.code === 'in_progress' || res.status === 429)) endAttempt()
        if (res.status === 404) throw new Error(LINK_BROKEN)
        if (body?.code === 'amount_changed') {
          await load()
          throw new Error(AMOUNT_CHANGED)
        }
        if (res.status === 410) {
          setBalance({ ...balance, state: 'cancelled', items: [], dueCents: 0 })
          return
        }
        throw new Error(messageForFailure(failure, partyMessages))
      }
      const json = await res.json().catch(() => null)
      if (!json) throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      const d = json.data ?? {}
      endAttempt()
      setPaid({
        cents: typeof d.paidCents === 'number' ? d.paidCents : 0,
        receiptUrl: typeof d.receiptUrl === 'string' ? d.receiptUrl : null,
        stillDueCents: typeof d.stillDueCents === 'number' ? d.stillDueCents : 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : UNKNOWN_OUTCOME_MESSAGE)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={card}>
      <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.75rem' }}>{PAY_HEADING}</h1>
      {renderBody()}
    </div>
  )

  function renderBody() {
    if (loadError) {
      return (
        <div role="alert">
          <p style={{ ...helpText, color: 'var(--color-error)', marginBottom: '1rem' }}>{loadError}</p>
          {loadError === LOAD_FAILED && (
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )
    }
    if (!balance) return <p role="status" style={helpText}>Loading…</p>
    if (paid || balance.state === 'paid') {
      const receipt = paid?.receiptUrl ?? balance.receiptUrl
      return (
        <div role="status">
          <p style={{ ...helpText, fontWeight: 700, marginBottom: '0.5rem' }}>
            {paid && paid.cents > 0 ? `Thank you! You paid ${formatMoney(paid.cents)}.` : 'Your party is paid.'}
          </p>
          <p style={{ ...helpText, marginBottom: '0.5rem' }}>Your party on {balance.when} is booked.</p>
          {paid && paid.stillDueCents > 0 && (
            <p style={{ ...helpText, marginBottom: '0.5rem' }}>There is still {formatMoney(paid.stillDueCents)} to pay for extras added since. Refresh this page to pay it.</p>
          )}
          <p style={{ ...helpText, marginBottom: '1rem' }}>{CRAFTS_LINE}</p>
          {receipt && (
            <a href={receipt} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
              See your receipt
            </a>
          )}
        </div>
      )
    }
    if (balance.state === 'cancelled' || balance.state === 'legacy') {
      return <p role="status" style={helpText}>{CANCELLED_LINE}</p>
    }
    if (balance.paying) {
      return (
        <div role="status">
          <p style={{ ...helpText, marginBottom: '1rem' }}>{BUSY_LINE}</p>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => void load()}>
            Check again
          </button>
        </div>
      )
    }
    const amount = formatMoney(balance.dueCents)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handlePay()
        }}
      >
        <p style={{ ...helpText, marginBottom: '1rem' }}>
          {balance.hostFirstName ? `Hi ${balance.hostFirstName}! ` : ''}
          {balance.extrasOnly ? `Your party on ${balance.when} is paid. These extras were added since.` : `Your party on ${balance.when} is held for you.`}
        </p>
        <ul aria-label="To pay" style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
          {balance.items.map((it) => (
            <li key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.375rem 0', fontSize: '1rem' }}>
              <span>{it.qty > 1 ? `${it.label} × ${it.qty}` : it.label}</span>
              <span>{formatMoney(it.cents)}</span>
            </li>
          ))}
          <li style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0 0', borderTop: '1px solid rgba(var(--color-primary-rgb),0.16)', fontWeight: 700, fontSize: '1rem' }}>
            <span>To pay now</span>
            <span>{amount}</span>
          </li>
        </ul>
        <p style={{ ...helpText, marginBottom: '1rem' }}>{CRAFTS_LINE}</p>
        {balance.refundLine && (
          <p data-testid="pay-policy" style={{ ...helpText, marginBottom: '1.25rem' }}>
            {balance.refundLine}{' '}
            <a href={`${POLICY_PATH}#${POLICY_ANCHORS.parties}`} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}>
              Read the party policy
            </a>
          </p>
        )}
        {earlierPending && (
          <p role="status" data-testid="earlier-pending" style={{ ...helpText, fontWeight: 600, marginBottom: '1rem' }}>{EARLIER_PENDING}</p>
        )}

        <PaymentForm
          bookingKind="party"
          ref={paymentFormRef}
          wallet={{ amount: (balance.dueCents / 100).toFixed(2), label: 'Hometown Studio party', bnpl: true }}
          onWalletToken={(token) => void handlePay(token)}
          onReadyChange={setPaymentReady}
        />

        {error && (
          <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '1rem', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={!paymentReady || processing} style={{ marginTop: '1rem', minHeight: 44 }}>
          {processing ? 'Paying…' : !paymentReady ? 'Loading payment form…' : `Pay ${amount}`}
        </button>
      </form>
    )
  }
}
