import { useState } from 'react'
import { useEnrollment } from '../EnrollmentContext'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'rgba(255, 255, 255, 0.75)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(150, 112, 91, 0.1)',
  borderRadius: '0.75rem',
  fontSize: '0.875rem',
  color: 'var(--color-dark)',
  outline: 'none',
  transition: 'border-color 0.3s ease',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-dark)',
  marginBottom: '0.375rem',
}

export default function ParentInfoStep() {
  const { state, dispatch } = useEnrollment()
  const [firstName, setFirstName] = useState(state.parentInfo?.firstName ?? '')
  const [lastName, setLastName] = useState(state.parentInfo?.lastName ?? '')
  const [email, setEmail] = useState(state.parentInfo?.email ?? '')
  const [phone, setPhone] = useState(state.parentInfo?.phone ?? '')

  const isValid = firstName.trim() && lastName.trim() && email.trim() && phone.trim()

  function handleContinue() {
    dispatch({
      type: 'SET_PARENT_INFO',
      payload: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      },
    })
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
        Parent or guardian contact information
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>First Name *</label>
          <input style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Last Name *</label>
          <input style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Email *</label>
        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Phone *</label>
        <input style={inputStyle} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <button
        type="button"
        disabled={!isValid}
        onClick={handleContinue}
        style={{
          padding: '0.875rem',
          background: isValid ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: isValid ? 'pointer' : 'not-allowed',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (isValid) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue to Payment
      </button>
    </div>
  )
}
