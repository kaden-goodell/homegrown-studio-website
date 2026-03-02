import { useState } from 'react'
import { useWizard } from '@components/booking/WizardContext'

function formatSlotDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const inputStyle = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'rgba(255, 255, 255, 0.75)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(150, 112, 91, 0.1)',
  borderRadius: '0.75rem',
  fontSize: '0.875rem',
  color: 'var(--color-dark)',
  outline: 'none',
}

export default function InquiryStep() {
  const { state, dispatch } = useWizard()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function validate(): boolean {
    const next: { name?: string; email?: string } = {}
    if (!name.trim()) next.name = 'Name is required'
    if (!email.trim()) next.email = 'Email is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return

    setSubmitting(true)
    dispatch({ type: 'SET_ERROR', payload: null })

    try {
      const [givenName, ...rest] = name.trim().split(' ')
      const familyName = rest.join(' ')

      await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          givenName,
          familyName,
          phone: phone.trim() || undefined,
        }),
      })

      const res = await fetch('/api/inquiry/submit.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          eventType: state.eventType?.id,
          dates: state.selectedDates,
          duration: state.desiredDuration,
          guestCount: state.guestCount,
          details: state.specialRequests,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to submit inquiry')
      }

      dispatch({ type: 'SET_CUSTOMER_INFO', payload: { name: name.trim(), email: email.trim(), phone: phone.trim() } })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'completed' })
      setSubmitted(true)
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Failed to submit inquiry' })
    } finally {
      setSubmitting(false)
    }
  }

  // Determine the date display: prefer selected slot, fall back to date range
  const dateDisplay = state.selectedSlot
    ? formatSlotDateTime(state.selectedSlot.startAt)
    : state.selectedDates
      ? state.selectedDates.end !== state.selectedDates.start
        ? `${formatDate(state.selectedDates.start)} – ${formatDate(state.selectedDates.end)}`
        : formatDate(state.selectedDates.start)
      : null

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
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
          Inquiry Submitted
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
          Thank you! We'll get back to you within 24 hours.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Contact info */}
      <div>
        <h3 style={{
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--color-dark)',
          marginBottom: '0.75rem',
        }}>
          Contact Information
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label
              htmlFor="inquiry-name"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.375rem',
              }}
            >
              Name *
            </label>
            <input
              id="inquiry-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            {errors.name && <p style={{ fontSize: '0.8125rem', color: '#dc2626', marginTop: '0.25rem' }}>{errors.name}</p>}
          </div>
          <div>
            <label
              htmlFor="inquiry-email"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.375rem',
              }}
            >
              Email *
            </label>
            <input
              id="inquiry-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
            {errors.email && <p style={{ fontSize: '0.8125rem', color: '#dc2626', marginTop: '0.25rem' }}>{errors.email}</p>}
          </div>
          <div>
            <label
              htmlFor="inquiry-phone"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.375rem',
              }}
            >
              Phone
            </label>
            <input
              id="inquiry-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ ...inputStyle, maxWidth: '16rem' }}
            />
          </div>
        </div>
      </div>

      {/* Review summary */}
      <div style={{
        padding: '1rem 1.25rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
      }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.25rem' }}>
          Review Your Inquiry
        </h3>
        {state.eventType && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Event: {state.eventType.name}
          </p>
        )}
        {dateDisplay && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Date: {dateDisplay}
          </p>
        )}
        {state.guestCount > 1 && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Guests: {state.guestCount}
          </p>
        )}
        {state.specialRequests && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Notes: {state.specialRequests}
          </p>
        )}
      </div>

      {state.error && (
        <p style={{ fontSize: '0.8125rem', color: '#dc2626' }}>{state.error}</p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        style={{
          padding: '0.875rem',
          background: submitting ? 'rgba(150, 112, 91, 0.5)' : 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        {submitting ? 'Submitting...' : 'Submit Inquiry'}
      </button>
    </div>
  )
}
