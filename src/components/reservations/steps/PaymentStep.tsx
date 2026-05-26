import { useState, useRef } from 'react'
import { CLASS_BOOKING_APP_ID } from '@config/site.config'
import { useReservation } from '../ReservationContext'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function PaymentStep() {
  const { state, dispatch } = useReservation()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paymentFormRef = useRef<PaymentFormRef>(null)

  const tableDeposit = state.tableCount * state.depositPerTableCents
  const partyTableCost = state.partyTable ? state.partyTablePriceCents : 0
  const dedicatedHostCost = state.dedicatedHost ? state.dedicatedHostPriceCents : 0
  const total = tableDeposit + partyTableCost + dedicatedHostCost

  async function handlePay() {
    if (processing) return
    setError(null)
    setProcessing(true)

    try {
      // Step 1: Tokenize card
      let token: string
      try {
        token = await paymentFormRef.current!.tokenize()
      } catch (tokenErr) {
        throw new Error('Could not process your card. Please check your details and try again.')
      }

      // Step 2: Book + pay on server
      const res = await fetch('/api/reservations/book.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: state.date,
          startTime: state.startTime,
          durationMinutes: state.selectedVariation?.durationMinutes ?? state.durationMinutes,
          serviceVariationId: state.selectedVariation?.id,
          serviceVariationVersion: state.selectedVariation?.version,
          tableCount: state.tableCount,
          wholeStudio: state.wholeStudio,
          partyTable: state.partyTable,
          dedicatedHost: state.dedicatedHost,
          depositPerTableCents: state.depositPerTableCents,
          partyTablePriceCents: state.partyTablePriceCents,
          dedicatedHostPriceCents: state.dedicatedHostPriceCents,
          customer: state.customer,
          paymentToken: token,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.detail ?? 'Booking failed. Your card was not charged.')
      }

      const data = await res.json()
      dispatch({
        type: 'SET_RESULT',
        bookingIds: data.data.bookingIds ?? [],
        orderId: data.data.orderId ?? '',
        receiptUrl: data.data.receiptUrl ?? null,
        giftCardId: data.data.giftCardId ?? null,
        craftCreditCents: data.data.craftCreditCents ?? 0,
        totalCharged: total,
      })
      dispatch({ type: 'NEXT_STEP' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      {/* Order summary */}
      <div style={{
        padding: '1rem 1.25rem',
        borderRadius: '0.75rem',
        border: '1px solid rgba(150, 112, 91, 0.08)',
        background: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '1.25rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            {state.wholeStudio ? 'Whole Studio (6 tables)' : `${state.tableCount} table${state.tableCount !== 1 ? 's' : ''}`} &times; {formatPrice(state.depositPerTableCents)}
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
            {formatPrice(tableDeposit)}
          </span>
        </div>
        {state.partyTable && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Party Table</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {formatPrice(state.partyTablePriceCents)}
            </span>
          </div>
        )}
        {state.dedicatedHost && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Dedicated Host</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {formatPrice(state.dedicatedHostPriceCents)}
            </span>
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(150, 112, 91, 0.08)',
        }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>Total</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {formatPrice(total)}
          </span>
        </div>
      </div>

      {/* Payment form */}
      <div style={{ marginBottom: '1rem' }}>
        <PaymentForm ref={paymentFormRef} applicationIdOverride={CLASS_BOOKING_APP_ID} environmentOverride="production" />
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
        {processing ? 'Processing...' : `Pay ${formatPrice(total)}`}
      </button>
    </div>
  )
}
