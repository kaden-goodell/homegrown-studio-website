import { useReservation } from '../ReservationContext'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
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

interface ConfirmationStepProps {
  onClose: () => void
}

export default function ConfirmationStep({ onClose }: ConfirmationStepProps) {
  const { state } = useReservation()

  const addOns: string[] = []
  if (state.partyTable) addOns.push('Party Table')
  if (state.dedicatedHost) addOns.push('Dedicated Host')

  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      {/* Green checkmark */}
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
        marginBottom: '1rem',
      }}>
        Reservation Confirmed!
      </h3>

      {/* Details box */}
      <div style={{
        textAlign: 'left',
        padding: '1rem 1.25rem',
        borderRadius: '0.75rem',
        border: '1px solid rgba(150, 112, 91, 0.08)',
        background: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Date</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 500 }}>
            {state.date ? formatDate(state.date) : ''}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Time</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 500 }}>
            {state.startTime ? formatTime(state.startTime) : ''}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Duration</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 500 }}>
            {state.durationMinutes} min
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: addOns.length > 0 ? '0.5rem' : 0 }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Tables</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 500 }}>
            {state.wholeStudio ? 'Whole Studio (6 tables)' : `${state.tableCount} table${state.tableCount !== 1 ? 's' : ''}`}
          </span>
        </div>
        {addOns.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Add-ons</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 500 }}>
              {addOns.join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Charged amount */}
      <p style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 600, marginBottom: '0.25rem' }}>
        Charged: {formatPrice(state.totalCharged)}
      </p>

      {/* Craft credit info */}
      {state.craftCreditCents > 0 && (
        <p style={{ fontSize: '0.875rem', color: 'rgb(34, 197, 94)', marginBottom: '1rem' }}>
          {formatPrice(state.craftCreditCents)} craft credit will be applied when you visit
        </p>
      )}

      {/* Confirmation message */}
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto 1rem' }}>
        A confirmation has been sent to <strong>{state.customer.email}</strong>. Just give your name when you arrive — your craft credit is already on your account.
      </p>

      {/* Receipt link */}
      {state.receiptUrl && (
        <a
          href={state.receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: 'var(--color-primary)',
          }}
        >
          View Receipt
        </a>
      )}

      {/* Done button */}
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: '0.5rem',
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
    </div>
  )
}
