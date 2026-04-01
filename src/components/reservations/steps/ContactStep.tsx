import { useState } from 'react'
import { useReservation } from '../ReservationContext'

export default function ContactStep() {
  const { state, dispatch } = useReservation()
  const [firstName, setFirstName] = useState(state.customer.firstName)
  const [lastName, setLastName] = useState(state.customer.lastName)
  const [email, setEmail] = useState(state.customer.email)
  const [phone, setPhone] = useState(state.customer.phone)
  const [hovered, setHovered] = useState(false)

  const isValid = firstName.trim() && lastName.trim() && email.trim()

  function handleNext() {
    if (!isValid) return
    dispatch({
      type: 'SET_CUSTOMER',
      customer: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      },
    })
    dispatch({ type: 'NEXT_STEP' })
  }

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
            Last Name *
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
        onClick={handleNext}
        disabled={!isValid}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: isValid
            ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
            : 'rgba(150, 112, 91, 0.2)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: isValid ? 'pointer' : 'default',
          opacity: isValid ? 1 : 0.5,
          boxShadow: isValid && hovered ? '0 8px 25px rgba(150, 112, 91, 0.35)' : isValid ? '0 4px 15px rgba(150, 112, 91, 0.2)' : 'none',
          transform: isValid && hovered ? 'translateY(-1px)' : 'none',
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        Continue to Payment
      </button>
    </div>
  )
}
