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
import { newAttemptId } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, partyMessages, UNKNOWN_OUTCOME_MESSAGE, TEXT_US } from '@lib/checkout-messages'
import { formatMoney } from '@lib/money'

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
}

export const PAY_HEADING = 'Pay for your party'
export const CRAFTS_LINE = 'Crafts are paid at the studio for whoever comes.'
export const LINK_BROKEN = `This payment link doesn’t work. Please ${TEXT_US} and we’ll send a new one.`
export const LOAD_FAILED = 'We couldn’t load this payment. Please try again.'
export const CANCELLED_LINE = 'This party was cancelled. Nothing is due.'

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
  const attemptId = useRef(newAttemptId())

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/party/balance.json?id=${encodeURIComponent(partyId)}&k=${encodeURIComponent(payKey)}`)
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
      let res: Response
      try {
        res = await fetch('/api/party/pay.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: partyId, k: payKey, attemptId: attemptId.current, paymentToken: token, sourceKind }),
        })
      } catch {
        throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const failure = { status: res.status, body }
        // A plain answer ends this attempt; "not sure" and "another payment is going through" keep it.
        if (!(outcomeUnknown(failure) || body?.code === 'in_progress')) attemptId.current = newAttemptId()
        if (res.status === 404) throw new Error(LINK_BROKEN)
        if (res.status === 410) {
          setBalance({ ...balance, state: 'cancelled', items: [], dueCents: 0 })
          return
        }
        throw new Error(messageForFailure(failure, partyMessages))
      }
      const json = await res.json().catch(() => null)
      if (!json) throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      const d = json.data ?? {}
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
    const amount = formatMoney(balance.dueCents)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handlePay()
        }}
      >
        <p style={{ ...helpText, marginBottom: '1rem' }}>
          {balance.hostFirstName ? `Hi ${balance.hostFirstName}! ` : ''}Your party on {balance.when} is held for you.
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
        <p style={{ ...helpText, marginBottom: '1.25rem' }}>{CRAFTS_LINE}</p>

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
          {processing ? 'Paying…' : `Pay ${amount}`}
        </button>
      </form>
    )
  }
}
