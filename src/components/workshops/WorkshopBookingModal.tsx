import { useState, useEffect, useRef } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import OrderSummary from '@components/checkout/OrderSummary'
import CouponInput from '@components/checkout/CouponInput'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import type { LineItem, Discount } from '@providers/interfaces/payment'

interface WorkshopBookingModalProps {
  workshop: WorkshopData
  onClose: () => void
}

const STEP_LABELS = ['Details', 'Your Info', 'Payment']

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export default function WorkshopBookingModal({ workshop, onClose }: WorkshopBookingModalProps) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(0)
  const prevStep = useRef(0)

  // Contact info
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Booking
  const [seats, setSeats] = useState(1)
  const [discount, setDiscount] = useState<Discount | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const paymentFormRef = useRef<PaymentFormRef>(null)

  const maxSeats = workshop.remainingSeats ?? 10

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Step transition
  useEffect(() => {
    if (step !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(step)
        prevStep.current = step
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [step])

  const lineItems: LineItem[] = [{
    name: workshop.name,
    quantity: seats,
    pricePerUnit: workshop.price,
  }]
  const subtotal = lineItems.reduce((sum, item) => sum + item.pricePerUnit * item.quantity, 0)
  const discountAmount = discount
    ? discount.type === 'percent'
      ? Math.round((subtotal * discount.value) / 100)
      : discount.value
    : 0
  const total = subtotal - discountAmount

  const progress = completed ? 100 : (step / (STEP_LABELS.length - 1)) * 100

  function handleBack() {
    if (step === 0) {
      onClose()
    } else {
      setStep(step - 1)
    }
  }

  async function handlePay() {
    setError(null)
    setProcessing(true)

    try {
      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: firstName.trim(),
          familyName: lastName.trim() || firstName.trim(),
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
          discounts: discount ? [discount] : [],
        }),
      })
      if (!orderRes.ok) throw new Error('Failed to create order')
      const orderData = await orderRes.json()

      const token = await paymentFormRef.current!.tokenize()

      const paymentRes = await fetch('/api/checkout/process-payment.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderData.data.id,
          paymentToken: token,
          amount: orderData.data.totalAmount,
          currency: workshop.currency,
        }),
      })
      if (!paymentRes.ok) throw new Error('Payment failed')
      const paymentData = await paymentRes.json()

      setReceiptUrl(paymentData.data.receiptUrl ?? null)
      setCompleted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setProcessing(false)
    }
  }

  function renderStep() {
    if (completed) {
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
            {seats} seat{seats > 1 ? 's' : ''} reserved for <strong>{workshop.name}</strong>.
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

    switch (displayStep) {
      case 0:
        return (
          <div>
            {/* Workshop details */}
            <div style={{
              padding: '1.25rem',
              background: 'rgba(150, 112, 91, 0.04)',
              borderRadius: '0.75rem',
              marginBottom: '1.5rem',
            }}>
              <h3 style={{
                fontSize: '1.125rem',
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                color: 'var(--color-dark)',
                marginBottom: '0.5rem',
              }}>
                {workshop.name}
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
                {workshop.description}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                <span>{formatDate(workshop.date)}</span>
                <span>{formatTime(workshop.startTime)} - {formatTime(workshop.endTime)}</span>
                <span>{workshop.duration} min</span>
              </div>
            </div>

            {/* Seat selector */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.5rem',
              }}>
                Number of Seats
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setSeats(Math.max(1, seats - 1))}
                  disabled={seats <= 1}
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '1.25rem',
                    cursor: seats <= 1 ? 'default' : 'pointer',
                    opacity: seats <= 1 ? 0.3 : 1,
                    color: 'var(--color-dark)',
                  }}
                >
                  &minus;
                </button>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)', minWidth: '2rem', textAlign: 'center' }}>
                  {seats}
                </span>
                <button
                  type="button"
                  onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                  disabled={seats >= maxSeats}
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '1.25rem',
                    cursor: seats >= maxSeats ? 'default' : 'pointer',
                    opacity: seats >= maxSeats ? 0.3 : 1,
                    color: 'var(--color-dark)',
                  }}
                >
                  +
                </button>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                  {formatPrice(workshop.price, workshop.currency)} / seat
                </span>
              </div>
              {workshop.remainingSeats !== null && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                  {workshop.remainingSeats} seats remaining
                </p>
              )}
            </div>

            {/* Total */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '1rem 0',
              borderTop: '1px solid rgba(150, 112, 91, 0.08)',
              marginBottom: '1.5rem',
            }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Total</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                {formatPrice(workshop.price * seats, workshop.currency)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                width: '100%',
                padding: '0.875rem',
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 8px 25px rgba(150, 112, 91, 0.35)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 15px rgba(150, 112, 91, 0.2)'
                e.currentTarget.style.transform = 'none'
              }}
            >
              Continue
            </button>
          </div>
        )

      case 1: {
        const infoValid = firstName.trim() && email.trim()
        return (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)', marginBottom: '0.375rem' }}>
                  First Name *
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '0.875rem',
                    color: 'var(--color-text)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)', marginBottom: '0.375rem' }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '0.875rem',
                    color: 'var(--color-text)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)', marginBottom: '0.375rem' }}>
                Email *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  background: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '0.875rem',
                  color: 'var(--color-text)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)', marginBottom: '0.375rem' }}>
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  background: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '0.875rem',
                  color: 'var(--color-text)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!infoValid}
              style={{
                width: '100%',
                padding: '0.875rem',
                background: infoValid
                  ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
                  : 'rgba(150, 112, 91, 0.2)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: infoValid ? 'pointer' : 'default',
                opacity: infoValid ? 1 : 0.5,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              Continue to Payment
            </button>
          </div>
        )
      }

      case 2:
        return (
          <div>
            <OrderSummary
              lineItems={lineItems}
              discount={discount}
              total={total}
              currency={workshop.currency}
            />

            <div style={{ marginTop: '1rem' }}>
              <CouponInput onApply={(code, d) => setDiscount(d)} />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <PaymentForm ref={paymentFormRef} />
            </div>

            {error && (
              <p style={{ fontSize: '0.875rem', color: '#dc2626', marginTop: '0.75rem' }}>{error}</p>
            )}

            <button
              type="button"
              onClick={handlePay}
              disabled={processing}
              style={{
                width: '100%',
                marginTop: '1.25rem',
                padding: '0.875rem',
                background: processing
                  ? 'rgba(150, 112, 91, 0.4)'
                  : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: processing ? 'default' : 'pointer',
                opacity: processing ? 0.7 : 1,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              {processing ? 'Processing...' : `Pay ${formatPrice(total, workshop.currency)}`}
            </button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !completed) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '40rem',
          maxHeight: '90vh',
          overflow: 'auto',
          margin: '1rem',
          padding: '2.5rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
          backdropFilter: 'blur(32px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(150, 112, 91, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{
            fontSize: '1.25rem',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-dark)',
          }}>
            Book Seat
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Progress bar */}
        {!completed && (
          <nav aria-label="Booking progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {STEP_LABELS[step]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {step + 1} / {STEP_LABELS.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={step + 1}
                aria-valuemin={1}
                aria-valuemax={STEP_LABELS.length}
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                  borderRadius: '1px',
                  transition: 'width 0.5s cubic-bezier(0.25, 0.1, 0, 1)',
                }}
              />
            </div>
          </nav>
        )}

        {/* Back button */}
        {!completed && (
          <button
            type="button"
            onClick={handleBack}
            style={{
              marginBottom: '1.25rem',
              fontSize: '0.8125rem',
              color: 'var(--color-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              transition: 'color 0.3s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-dark)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <span style={{ fontSize: '0.875rem' }}>&larr;</span>
            Back
          </button>
        )}

        {/* Step content with transition */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {renderStep()}
        </div>

        {/* Done button on completion */}
        {completed && (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: '1.5rem',
              width: '100%',
              padding: '0.875rem',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'filter 0.3s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  )
}
