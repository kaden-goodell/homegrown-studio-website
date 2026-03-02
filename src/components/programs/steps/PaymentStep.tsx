import { useState, useRef } from 'react'
import { useEnrollment } from '../EnrollmentContext'
import CouponInput from '@components/checkout/CouponInput'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import type { Discount } from '@providers/interfaces/payment'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function PaymentStep() {
  const { state, dispatch } = useEnrollment()
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const [processing, setProcessing] = useState(false)

  const { program, selectedSessions, headcount, children, parentInfo } = state

  const sessionCount = selectedSessions.length
  const subtotal = (program.pricePerHead ?? 0) * headcount * sessionCount
  const discountAmount = state.appliedDiscount
    ? state.appliedDiscount.type === 'percent'
      ? Math.round((subtotal * state.appliedDiscount.value) / 100)
      : state.appliedDiscount.value
    : 0
  const total = subtotal - discountAmount

  function handleCouponApply(code: string, discount: Discount) {
    dispatch({ type: 'APPLY_COUPON', payload: { code, discount } })
  }

  async function handlePay() {
    if (!parentInfo) return
    dispatch({ type: 'SET_ERROR', payload: null })
    dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'processing' })
    setProcessing(true)

    try {
      // Create customer
      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: parentInfo.firstName,
          familyName: parentInfo.lastName,
          email: parentInfo.email,
          phone: parentInfo.phone,
        }),
      })
      if (!customerRes.ok) throw new Error('Failed to create customer')
      const customerData = await customerRes.json()

      // Build order note with child intake data
      const enrollmentData = {
        programId: program.id,
        programName: program.name,
        sessions: selectedSessions.map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })),
        children: children.map(c => ({
          name: `${c.firstName} ${c.lastName}`,
          age: c.age,
          allergies: c.allergies,
          medicalNotes: c.medicalNotes,
          emergencyContact: `${c.emergencyContactName} (${c.emergencyContactPhone})`,
          authorizedPickup: c.authorizedPickup,
        })),
        parentPhone: parentInfo.phone,
      }

      // Create order
      const orderRes = await fetch('/api/checkout/create-order.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customerData.data.id,
          lineItems: selectedSessions.map((session) => ({
            name: `${program.name} — ${session.name}`,
            quantity: headcount,
            pricePerUnit: program.pricePerHead,
          })),
          discounts: state.appliedDiscount ? [state.appliedDiscount] : [],
          note: JSON.stringify(enrollmentData),
        }),
      })
      if (!orderRes.ok) throw new Error('Failed to create order')
      const orderData = await orderRes.json()
      dispatch({ type: 'SET_ORDER_ID', payload: orderData.data.id })

      // Tokenize payment
      const token = await paymentFormRef.current!.tokenize()

      // Process payment
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

      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'completed' })
      dispatch({ type: 'NEXT_STEP' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      dispatch({ type: 'SET_ERROR', payload: message })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'failed' })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Order summary */}
      <div style={{
        padding: '1.25rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '0.75rem',
      }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.75rem' }}>
          Order Summary
        </h3>
        {selectedSessions.map((session) => (
          <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
            <span>{session.name} &times; {headcount}</span>
            <span>{formatPrice((program.pricePerHead ?? 0) * headcount)}</span>
          </div>
        ))}
        {state.appliedDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-primary)', marginBottom: '0.375rem' }}>
            <span>Discount</span>
            <span>-{formatPrice(discountAmount)}</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(150, 112, 91, 0.08)', marginTop: '0.5rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <CouponInput onApply={handleCouponApply} />

      <PaymentForm ref={paymentFormRef} />

      {state.error && (
        <p style={{ fontSize: '0.8125rem', color: '#dc2626' }}>{state.error}</p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={processing}
        style={{
          padding: '0.875rem',
          background: processing ? 'rgba(150, 112, 91, 0.5)' : 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: processing ? 'not-allowed' : 'pointer',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (!processing) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        {processing ? 'Processing...' : `Pay ${formatPrice(total)}`}
      </button>
    </div>
  )
}
