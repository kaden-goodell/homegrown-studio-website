import { useState, useRef } from 'react'
import { useWizard } from '@components/booking/WizardContext'
import OrderSummary from '@components/checkout/OrderSummary'
import CouponInput from '@components/checkout/CouponInput'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import type { LineItem, Discount } from '@providers/interfaces/payment'

export default function CheckoutStep() {
  const { state, dispatch } = useWizard()
  const paymentFormRef = useRef<PaymentFormRef>(null)

  const [name, setName] = useState(state.customerInfo?.name ?? '')
  const [email, setEmail] = useState(state.customerInfo?.email ?? '')
  const [phone, setPhone] = useState(state.customerInfo?.phone ?? '')
  const [processing, setProcessing] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

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
      items.push({
        name: state.eventType.name,
        quantity: 1,
        pricePerUnit: 0,
      })
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

      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
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
      <div className="space-y-4 text-center">
        <h2 className="text-2xl font-bold text-green-700">Booking Confirmed!</h2>
        <p className="text-gray-600">Your booking has been created successfully.</p>
        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-purple-600 underline hover:text-purple-800"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 sm:max-w-xs"
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
        className="w-full rounded-lg bg-purple-600 px-6 py-3 text-base font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {processing ? 'Processing...' : 'Book & Pay'}
      </button>
    </div>
  )
}
