import { useState, useEffect, useRef } from 'react'
import { useWizard } from '@components/booking/WizardContext'
import OrderSummary from '@components/checkout/OrderSummary'
import CouponInput from '@components/checkout/CouponInput'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import type { LineItem, Discount } from '@providers/interfaces/payment'
import type { EventType, AddOn } from '@providers/interfaces/catalog'

export default function CheckoutStep() {
  const { state, dispatch } = useWizard()
  const paymentFormRef = useRef<PaymentFormRef>(null)

  const [name, setName] = useState(state.customerInfo?.name ?? '')
  const [email, setEmail] = useState(state.customerInfo?.email ?? '')
  const [phone, setPhone] = useState(state.customerInfo?.phone ?? '')
  const [processing, setProcessing] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [catalogEvent, setCatalogEvent] = useState<EventType | null>(null)
  const [catalogAddOns, setCatalogAddOns] = useState<AddOn[]>([])

  // Fetch catalog data (variations + add-ons) for the selected event type
  useEffect(() => {
    if (!state.eventType) return

    const eventId = state.eventType.id

    Promise.all([
      fetch('/api/catalog/event-types.json')
        .then((res) => res.json())
        .then((data) => {
          const events: EventType[] = data.data ?? data
          return events.find((e) => e.id === eventId) ?? null
        })
        .catch(() => null),
      fetch(`/api/catalog/add-ons.json?eventTypeId=${eventId}`)
        .then((res) => res.json())
        .then((data) => (data.data ?? data) as AddOn[])
        .catch(() => [] as AddOn[]),
    ]).then(([event, addOns]) => {
      setCatalogEvent(event)
      setCatalogAddOns(addOns)
    })
  }, [state.eventType])

  const lineItems: LineItem[] = buildLineItems()
  const subtotal = lineItems.reduce((sum, item) => sum + item.pricePerUnit * item.quantity, 0)
  const discountAmount = state.appliedDiscount
    ? state.appliedDiscount.type === 'percent'
      ? Math.round((subtotal * state.appliedDiscount.value) / 100)
      : state.appliedDiscount.value
    : 0
  const total = subtotal - discountAmount

  function buildLineItems(): LineItem[] {
    const items: LineItem[] = []

    if (state.eventType) {
      // Use first variation price from catalog as the base price
      const variation = catalogEvent?.variations?.[0]
      const basePrice = variation?.priceAmount ?? 0

      items.push({
        name: state.eventType.name,
        quantity: 1,
        pricePerUnit: basePrice,
      })

      // Add extra guest charges
      if (
        state.eventType.allowExtraGuests &&
        state.eventType.extraGuestPrice &&
        state.eventType.baseCapacity &&
        state.guestCount > state.eventType.baseCapacity
      ) {
        const extraGuests = state.guestCount - state.eventType.baseCapacity
        items.push({
          name: `Extra Guest (x${extraGuests})`,
          quantity: extraGuests,
          pricePerUnit: state.eventType.extraGuestPrice,
        })
      }

      // Add selected add-ons
      if (state.selectedAddOns?.length && catalogAddOns.length) {
        for (const addonId of state.selectedAddOns) {
          const addon = catalogAddOns.find((m) => m.id === addonId)
          if (addon) {
            items.push({
              name: addon.name,
              quantity: 1,
              pricePerUnit: addon.priceAmount,
            })
          }
        }
      }
    }

    return items
  }

  function handleCouponApply(code: string, discount: Discount) {
    dispatch({ type: 'APPLY_COUPON', payload: { code, discount } })
  }

  async function handleBookAndPay() {
    if (!name.trim() || !email.trim()) {
      dispatch({ type: 'SET_ERROR', payload: 'Name and email are required' })
      return
    }

    dispatch({ type: 'SET_ERROR', payload: null })
    dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'processing' })
    setProcessing(true)

    try {
      dispatch({
        type: 'SET_CUSTOMER_INFO',
        payload: { name: name.trim(), email: email.trim(), phone: phone.trim() },
      })

      const [firstName, ...lastParts] = name.trim().split(' ')
      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: firstName,
          familyName: lastParts.join(' ') || firstName,
          email: email.trim(),
          phone: phone.trim(),
        }),
      })
      if (!customerRes.ok) throw new Error('Failed to create customer')
      const customerData = await customerRes.json()

      const orderRes = await fetch('/api/checkout/create-order.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customerData.data.id,
          lineItems,
          discounts: state.appliedDiscount ? [state.appliedDiscount] : [],
        }),
      })
      if (!orderRes.ok) throw new Error('Failed to create order')
      const orderData = await orderRes.json()
      dispatch({ type: 'SET_ORDER_ID', payload: orderData.data.id })

      const token = await paymentFormRef.current!.tokenize()

      const paymentRes = await fetch('/api/checkout/process-payment.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderData.data.id,
          paymentToken: token,
          amount: orderData.data.totalAmount,
          currency: 'USD',
        }),
      })
      if (!paymentRes.ok) throw new Error('Payment failed')
      const paymentData = await paymentRes.json()

      const bookingRes = await fetch('/api/booking/create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderData.data.id,
          paymentId: paymentData.data.id,
          customerId: customerData.data.id,
          eventType: state.eventType?.id,
          slotId: state.selectedSlot?.id,
          guestCount: state.guestCount,
          addOns: state.selectedAddOns,
          specialRequests: state.specialRequests,
        }),
      })
      if (!bookingRes.ok) throw new Error('Failed to create booking')
      const bookingData = await bookingRes.json()

      dispatch({ type: 'SET_BOOKING_ID', payload: bookingData.data.id })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'completed' })
      setReceiptUrl(paymentData.data.receiptUrl ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      dispatch({ type: 'SET_ERROR', payload: message })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'failed' })
    } finally {
      setProcessing(false)
    }
  }

  if (state.paymentStatus === 'completed') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          width: '3rem',
          height: '3rem',
          margin: '0 auto 1.25rem',
          borderRadius: '50%',
          background: 'rgba(34, 197, 94, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          color: 'rgb(34, 197, 94)',
        }}>
          &#10003;
        </div>
        <h3 style={{
          fontSize: '1.25rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--color-dark)',
          marginBottom: '0.75rem',
        }}>
          Booking Confirmed
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
          Your <strong>{state.eventType?.name}</strong> booking has been created successfully.
          A confirmation has been sent to <strong>{email}</strong>.
        </p>
        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: '1rem',
              fontSize: '0.875rem',
              color: 'var(--color-primary)',
            }}
          >
            View Receipt
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Contact Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="checkout-name" className="mb-1 block text-sm font-medium text-gray-700">
              Name *
            </label>
            <input
              id="checkout-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="checkout-email" className="mb-1 block text-sm font-medium text-gray-700">
              Email *
            </label>
            <input
              id="checkout-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div>
          <label htmlFor="checkout-phone" className="mb-1 block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            id="checkout-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:max-w-xs"
          />
        </div>
      </div>

      <OrderSummary
        lineItems={lineItems}
        discount={state.appliedDiscount}
        total={total}
        currency="USD"
      />

      <CouponInput onApply={handleCouponApply} />

      <PaymentForm ref={paymentFormRef} />

      {state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="button"
        onClick={handleBookAndPay}
        disabled={processing}
        className="w-full rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white hover:brightness-90 disabled:opacity-50"
      >
        {processing ? 'Processing...' : 'Book & Pay'}
      </button>
    </div>
  )
}
