import { useEnrollment, type ChildInfo } from '../EnrollmentContext'

interface ChildIntakeStepProps {
  childIndex: number
}

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

export default function ChildIntakeStep({ childIndex }: ChildIntakeStepProps) {
  const { state, dispatch } = useEnrollment()
  const child = state.children[childIndex]

  function update(field: keyof ChildInfo, value: string) {
    dispatch({
      type: 'SET_CHILD_INFO',
      payload: { index: childIndex, info: { ...child, [field]: value } },
    })
  }

  const isValid = child.firstName.trim() && child.lastName.trim() && child.age.trim()
    && child.emergencyContactName.trim() && child.emergencyContactPhone.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
        Child {childIndex + 1} of {state.headcount}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>First Name *</label>
          <input style={inputStyle} value={child.firstName} onChange={(e) => update('firstName', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Last Name *</label>
          <input style={inputStyle} value={child.lastName} onChange={(e) => update('lastName', e.target.value)} />
        </div>
      </div>

      <div style={{ maxWidth: '8rem' }}>
        <label style={labelStyle}>Age *</label>
        <input style={inputStyle} type="number" min={1} max={18} value={child.age} onChange={(e) => update('age', e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Allergies / Dietary Restrictions</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3.5rem', resize: 'vertical' }}
          value={child.allergies}
          onChange={(e) => update('allergies', e.target.value)}
          placeholder="List any food allergies or dietary needs..."
        />
      </div>

      <div>
        <label style={labelStyle}>Medical Notes</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3.5rem', resize: 'vertical' }}
          value={child.medicalNotes}
          onChange={(e) => update('medicalNotes', e.target.value)}
          placeholder="Any medical conditions, medications, or special needs..."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Emergency Contact Name *</label>
          <input style={inputStyle} value={child.emergencyContactName} onChange={(e) => update('emergencyContactName', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Emergency Contact Phone *</label>
          <input style={inputStyle} type="tel" value={child.emergencyContactPhone} onChange={(e) => update('emergencyContactPhone', e.target.value)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Authorized Pickup Persons</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3rem', resize: 'vertical' }}
          value={child.authorizedPickup}
          onChange={(e) => update('authorizedPickup', e.target.value)}
          placeholder="Names of people authorized to pick up this child..."
        />
      </div>

      <button
        type="button"
        disabled={!isValid}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
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
        {childIndex < state.headcount - 1 ? 'Next Child' : 'Continue'}
      </button>
    </div>
  )
}
