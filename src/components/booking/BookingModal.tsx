import { useState, useEffect, useRef } from 'react'
import { useWizard } from '@components/booking/WizardContext'
import type { TimeSlot } from '@providers/interfaces/booking'
import type { AddOn } from '@providers/interfaces/catalog'
import DateSelectionStep from './steps/DateSelectionStep'
import AvailableSlotsStep from './steps/AvailableSlotsStep'
import CustomizeStep from './steps/CustomizeStep'
import CheckoutStep from './steps/CheckoutStep'
import InquiryStep from './steps/InquiryStep'

interface BookingModalProps {
  onClose: () => void
}

const MODAL_STEP_LABELS = ['Date', 'Time Slot', 'Customize', 'Checkout']

export default function BookingModal({ onClose }: BookingModalProps) {
  const { state, dispatch } = useWizard()
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([])
  const [addOns, setAddOns] = useState<AddOn[]>([])
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(state.currentStep)
  const prevStep = useRef(state.currentStep)

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

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

  // Fetch add-ons when reaching Customize step
  useEffect(() => {
    if (state.currentStep === 3 && state.eventType) {
      fetch(`/api/catalog/add-ons.json?eventTypeId=${state.eventType.id}`)
        .then((res) => res.json())
        .then((json) => setAddOns(Array.isArray(json) ? json : json.data ?? []))
        .catch(() => setAddOns([]))
    }
  }, [state.currentStep, state.eventType])

  const finalStepLabel = state.eventType?.flow === 'quote' ? 'Inquiry' : 'Checkout'
  const stepLabels = MODAL_STEP_LABELS.map((label, i) =>
    i === 3 ? finalStepLabel : label,
  )

  // Modal step index (0-based within modal)
  const modalStep = state.currentStep - 1
  const isCompleted = state.paymentStatus === 'completed'
  const progress = isCompleted ? 100 : (modalStep / (stepLabels.length - 1)) * 100

  function renderStep() {
    switch (displayStep) {
      case 1:
        return <DateSelectionStep onSlotsLoaded={setAvailableSlots} />
      case 2:
        return <AvailableSlotsStep slots={availableSlots} />
      case 3:
        return <CustomizeStep addOns={addOns} />
      case 4:
        return state.eventType?.flow === 'quote' ? (
          <InquiryStep />
        ) : (
          <CheckoutStep />
        )
      default:
        return null
    }
  }

  function handleClose() {
    onClose()
  }

  function handleBack() {
    if (state.currentStep <= 1) {
      onClose()
    } else {
      dispatch({ type: 'GO_TO_STEP', payload: state.currentStep - 1 })
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
        if (e.target === e.currentTarget && !isCompleted) handleClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '40rem',
          minHeight: '85vh',
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
            {state.eventType?.name ?? 'Book'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
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
        {!isCompleted && (
          <nav aria-label="Booking progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {stepLabels[modalStep]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {modalStep + 1} / {stepLabels.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={modalStep + 1}
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
        {!isCompleted && (
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
        {isCompleted && (
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
