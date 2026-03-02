import { useEnrollment } from '../EnrollmentContext'

export default function ConfirmationStep() {
  const { state } = useEnrollment()

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
        Enrollment Confirmed
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
        You're enrolled in <strong>{state.program.name}</strong> for{' '}
        {state.headcount} child{state.headcount > 1 ? 'ren' : ''}.
        A confirmation has been sent to <strong>{state.parentInfo?.email}</strong>.
      </p>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
        The instructor will receive a roster before each session.
      </p>
    </div>
  )
}
