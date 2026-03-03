import { useState, useEffect, useRef } from 'react'
import type { EventType } from '@providers/interfaces/catalog'
import { EnrollmentProvider, useEnrollment } from './EnrollmentContext'
import DetailsStep from '@components/shared/DetailsStep'
import SessionSelectStep from './steps/SessionSelectStep'
import HeadcountStep from './steps/HeadcountStep'
import ChildIntakeStep from './steps/ChildIntakeStep'
import ParentInfoStep from './steps/ParentInfoStep'
import PaymentStep from './steps/PaymentStep'
import ConfirmationStep from './steps/ConfirmationStep'

interface EnrollmentModalProps {
  program: EventType
  onClose: () => void
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function getStepLabels(program: EventType, headcount: number): string[] {
  const labels: string[] = ['Details']
  if (program.enrollmentType === 'per-session') {
    labels.push('Select Sessions')
  }
  labels.push('Headcount')
  for (let i = 0; i < headcount; i++) {
    labels.push(`Child ${i + 1}`)
  }
  labels.push('Parent Info')
  labels.push('Payment')
  labels.push('Confirmation')
  return labels
}

function ModalContent({ program, onClose }: EnrollmentModalProps) {
  const { state, dispatch } = useEnrollment()
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(state.currentStep)
  const prevStep = useRef(state.currentStep)

  // Step transition animation
  useEffect(() => {
    if (state.currentStep !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(state.currentStep)
        prevStep.current = state.currentStep
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.currentStep])

  const stepLabels = getStepLabels(program, state.headcount)
  const isPerSession = program.enrollmentType === 'per-session'

  // Map currentStep to actual component
  function renderStep() {
    // Step 0 is always Details
    if (displayStep === 0) {
      const tags = [
        ...(program.ageRange ? [{ label: `Ages ${program.ageRange.min}–${program.ageRange.max}` }] : []),
        ...(program.programDates ? [{ label: program.programDates }] : []),
        ...(program.schedule ? [{ label: program.schedule.days }, { label: program.schedule.time }] : []),
        ...(program.enrollmentType === 'per-session' ? [{ label: `${program.variations.length} session${program.variations.length !== 1 ? 's' : ''}` }] : []),
        ...(program.pricePerHead ? [{ label: `${formatPrice(program.pricePerHead)} / child` }] : []),
      ]
      return (
        <DetailsStep
          imageUrl={program.imageUrl}
          title={program.name}
          description={program.description}
          tags={tags}
          onContinue={() => dispatch({ type: 'NEXT_STEP' })}
        />
      )
    }

    // Remaining steps offset by 1 (details takes slot 0)
    let step = displayStep - 1
    if (!isPerSession) step += 1 // skip session select

    if (isPerSession && step === 0) return <SessionSelectStep />
    const offset = isPerSession ? 1 : 1
    if (step === offset) return <HeadcountStep />

    const childStart = offset + 1
    const childEnd = childStart + state.headcount - 1
    if (step >= childStart && step <= childEnd) {
      return <ChildIntakeStep childIndex={step - childStart} />
    }

    if (step === childEnd + 1) return <ParentInfoStep />
    if (step === childEnd + 2) return <PaymentStep />
    return <ConfirmationStep />
  }

  const isConfirmation = state.paymentStatus === 'completed'
  const progress = isConfirmation ? 100 : (state.currentStep / (stepLabels.length - 1)) * 100

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
        if (e.target === e.currentTarget && !isConfirmation) onClose()
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
            {program.name}
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
        {!isConfirmation && (
          <nav aria-label="Enrollment progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {stepLabels[state.currentStep]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {state.currentStep + 1} / {stepLabels.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={state.currentStep + 1}
                aria-valuemin={1}
                aria-valuemax={stepLabels.length}
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
        {state.currentStep > 0 && !isConfirmation && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'PREV_STEP' })}
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

        {/* Close button on confirmation */}
        {isConfirmation && (
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

export default function EnrollmentModal({ program, onClose }: EnrollmentModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <EnrollmentProvider program={program}>
      <ModalContent program={program} onClose={onClose} />
    </EnrollmentProvider>
  )
}
