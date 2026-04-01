import { useState, useEffect, useRef } from 'react'
import { ReservationProvider, useReservation } from './ReservationContext'
import DateStep from './steps/DateStep'
import TimeSlotStep from './steps/TimeSlotStep'
import OptionsStep from './steps/OptionsStep'
import ContactStep from './steps/ContactStep'
import PaymentStep from './steps/PaymentStep'
import ConfirmationStep from './steps/ConfirmationStep'

interface ReservationModalProps {
  onClose: () => void
}

const STEP_LABELS = ['Date', 'Time', 'Options', 'Your Info', 'Payment']
const TOTAL_STEPS = STEP_LABELS.length  // 5 numbered steps; confirmation is step 5 (index 5)

function ReservationModalInner({ onClose }: ReservationModalProps) {
  const { state, dispatch } = useReservation()
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(0)
  const prevStep = useRef(0)

  const completed = state.step >= TOTAL_STEPS  // step 5 = confirmation

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Step transition
  useEffect(() => {
    if (state.step !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(state.step)
        prevStep.current = state.step
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.step])

  const progress = completed ? 100 : (state.step / (TOTAL_STEPS - 1)) * 100

  function handleBack() {
    if (state.step === 0) {
      onClose()
    } else {
      dispatch({ type: 'PREV_STEP' })
    }
  }

  function renderStep() {
    if (completed) {
      return <ConfirmationStep onClose={onClose} />
    }

    switch (displayStep) {
      case 0:
        return <DateStep />
      case 1:
        return <TimeSlotStep />
      case 2:
        return <OptionsStep />
      case 3:
        return <ContactStep />
      case 4:
        return <PaymentStep />
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
            Reserve a Table
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
          <nav aria-label="Reservation progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {STEP_LABELS[state.step]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {state.step + 1} / {TOTAL_STEPS}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={state.step + 1}
                aria-valuemin={1}
                aria-valuemax={TOTAL_STEPS}
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
      </div>
    </div>
  )
}

export default function ReservationModal({ onClose }: ReservationModalProps) {
  return (
    <ReservationProvider>
      <ReservationModalInner onClose={onClose} />
    </ReservationProvider>
  )
}
