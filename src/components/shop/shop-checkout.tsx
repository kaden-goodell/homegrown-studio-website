// src/components/shop/shop-checkout.tsx
/**
 * The pickup-or-shipping step, the payment step and the charge logic every shop product shares
 * (photo magnets, framed silhouettes). The server prices the order; this only sends it.
 */
import { useEffect, useRef, useState } from 'react'
import AddressInput from '@components/shared/AddressInput'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import type { Delivery, ShopProduct } from '@config/shop.config'
import { shopContent } from '@config/shop-content'
import { formatMoney } from '@lib/money'
import { newAttemptId } from '@lib/checkout-attempt'
import { readAttribution } from '@lib/attribution'
import { posthogId, trackPaymentCompleted, trackPaymentFailed, type AnalyticsItem } from '@lib/analytics'

const C = shopContent.modal
export interface Contact { name: string; email: string; phone: string }
export const inputStyle = { width: '100%', padding: '0.7rem 0.8rem', borderRadius: 10, border: '1px solid rgba(122,74,46,0.25)', fontSize: '1rem' } as const

export function deliveryValid(delivery: Delivery, address: string, contact: Contact): boolean {
  return !!contact.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) &&
    /^1?\d{10}$/.test(contact.phone.replace(/\D/g, '')) && (delivery === 'pickup' || address.trim().length >= 8)
}

export function DeliveryFields({ delivery, setDelivery, address, setAddress, contact, setContact, pickupNote = C.pickupNote }: {
  delivery: Delivery; setDelivery: (d: Delivery) => void; address: string; setAddress: (a: string) => void
  contact: Contact; setContact: (c: Contact) => void; pickupNote?: string
}) {
  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      {(['pickup', 'ship'] as const).map((d) => (
        <label key={d} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
          <input type="radio" name="delivery" checked={delivery === d} onChange={() => setDelivery(d)} />
          <span><strong>{d === 'pickup' ? C.pickupLabel : C.shipLabel}</strong><br /><small>{d === 'pickup' ? pickupNote : C.shipNote}</small></span>
        </label>
      ))}
      {delivery === 'ship' && <label>{C.addressLabel}<AddressInput value={address} onChange={setAddress} style={inputStyle} /></label>}
      <label>{C.nameLabel}<input style={inputStyle} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" /></label>
      <label>{C.emailLabel}<input style={inputStyle} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></label>
      <label>{C.phoneLabel}<input style={inputStyle} type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" /></label>
    </div>
  )
}

interface Quote { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number }

export interface ShopPayOptions {
  product: ShopProduct
  draftId: string
  sets: number
  items: (string | null)[]
  delivery: Delivery
  address: string
  contact: Contact
  quote: Quote
  analyticsItem: AnalyticsItem
  /** The server lost some photos: empty those slots and go back to them. */
  onMissing: (ids: Set<string>) => void
}

/** The charge: attempt ids (kept after an unknown outcome so a retry finds the same charge), errors, the result. */
export function useShopPay(o: ShopPayOptions) {
  const [attemptId, setAttemptId] = useState(newAttemptId)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const [done, setDone] = useState<{ reference: string; emailSent: boolean } | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const payRef = useRef<PaymentFormRef>(null)
  // A changed order is a new attempt — unless an earlier charge's outcome is still unknown.
  useEffect(() => { if (!unknownOutcome) setAttemptId(newAttemptId()) }, [o.sets, o.delivery, o.address]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pay(e?: React.FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing) return
    setProcessing(true); setError(null)
    let token: string
    try {
      token = walletToken ?? (await payRef.current!.tokenize()).token
    } catch {
      setError('Check your card details and try again.')
      setProcessing(false)
      return
    }
    try {
      const res = await fetch('/api/shop/magnet-order.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: o.product, draftId: o.draftId, attemptId, sets: o.sets, magnets: o.items, delivery: o.delivery, address: o.address, contact: o.contact, paymentToken: token, attribution: readAttribution(), posthogId: posthogId() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.detail ?? 'Something went wrong. Try again.')
        trackPaymentFailed(body?.code ?? `http_${res.status}`)
        if (body?.code === 'unknown_outcome') { setUnknownOutcome(true); return } // keep the attempt id: a retry must find the same charge
        if (Array.isArray(body?.missingPhotos)) o.onMissing(new Set<string>(body.missingPhotos))
        setUnknownOutcome(false)
        setAttemptId(newAttemptId()) // we know nothing was charged
        return
      }
      setUnknownOutcome(false)
      trackPaymentCompleted(o.quote.totalCents / 100, { kind: 'shop', transactionId: body.data.reference, items: [o.analyticsItem], extra: { sets: o.sets, product: o.product } })
      setDone({ reference: body.data.reference, emailSent: !!body.data.emailSent })
    } catch {
      // The card was read; the order request never came back. It may or may not have charged.
      setUnknownOutcome(true)
      setError(C.connectionLost)
    } finally { setProcessing(false) }
  }

  return { pay, processing, error, setError, unknownOutcome, done, paymentReady, setPaymentReady, payRef }
}

export function PayStep({ formId, itemsLine, quote, shop, walletLabel }: {
  formId: string; itemsLine: string; quote: Quote; shop: ReturnType<typeof useShopPay>; walletLabel: string
}) {
  return (
    <form id={formId} onSubmit={shop.pay} style={{ display: 'grid', gap: '0.75rem' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 1rem', margin: 0 }}>
        <dt>{itemsLine}</dt><dd style={{ margin: 0 }}>{formatMoney(quote.subtotalCents)}</dd>
        <dt>Tax</dt><dd style={{ margin: 0 }}>{formatMoney(quote.taxCents)}</dd>
        {quote.shippingCents > 0 && (<><dt>Shipping</dt><dd style={{ margin: 0 }}>{formatMoney(quote.shippingCents)}</dd></>)}
        <dt><strong>Total</strong></dt><dd style={{ margin: 0 }}><strong>{formatMoney(quote.totalCents)}</strong></dd>
      </dl>
      <PaymentForm ref={shop.payRef} bookingKind="shop" environmentOverride="production" onReadyChange={shop.setPaymentReady}
        wallet={{ amount: (quote.totalCents / 100).toFixed(2), label: walletLabel }}
        onWalletToken={(t) => shop.pay(undefined, t)} canPayWithWallet={() => (shop.processing ? 'Paying…' : null)} />
    </form>
  )
}

export function PayButton({ formId, quote, shop }: { formId: string; quote: Quote; shop: ReturnType<typeof useShopPay> }) {
  return <button type="submit" form={formId} className="btn btn-primary" disabled={shop.processing || !shop.paymentReady}>{shop.processing ? 'Processing…' : `Pay ${formatMoney(quote.totalCents)}`}</button>
}
