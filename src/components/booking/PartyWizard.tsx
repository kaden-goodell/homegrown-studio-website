import { useState, useEffect, useRef } from 'react'
import { WizardProvider, useWizard } from '@components/booking/WizardContext'
import type { EventTypeConfig } from '@config/site.config'
import type { TimeSlot } from '@providers/interfaces/booking'
import type { AddOn } from '@providers/interfaces/catalog'
import EventTypeStep from './steps/EventTypeStep'
import DateSelectionStep from './steps/DateSelectionStep'
import AvailableSlotsStep from './steps/AvailableSlotsStep'
import CustomizeStep from './steps/CustomizeStep'
import CheckoutStep from './steps/CheckoutStep'
import InquiryStep from './steps/InquiryStep'

const STEP_LABELS = ['Event Type', 'Date', 'Time Slot', 'Customize', 'Checkout']

interface PartyWizardProps {
  eventTypes: EventTypeConfig[]
}

function WizardContent({ eventTypes }: PartyWizardProps) {
  const { state, dispatch } = useWizard()
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([])
  const [addOns, setAddOns] = useState<AddOn[]>([])

  useEffect(() => {
    if (state.currentStep === 3 && state.eventType) {
      fetch(`/api/catalog/add-ons.json?eventTypeId=${state.eventType.id}`)
        .then((res) => res.json())
        .then((json) => setAddOns(Array.isArray(json) ? json : json.data ?? []))
        .catch(() => setAddOns([]))
    }
  }, [state.currentStep, state.eventType])

  const finalStepLabel =
    state.eventType?.flow === 'quote' ? 'Inquiry' : 'Checkout'
  const stepLabels = STEP_LABELS.map((label, i) =>
    i === 4 ? finalStepLabel : label,
  )

  function renderStep() {
    switch (state.currentStep) {
      case 0:
        return <EventTypeStep eventTypes={eventTypes} />
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

  const progress = ((state.currentStep) / (stepLabels.length - 1)) * 100

  return (
    <div className="max-w-3xl mx-auto">
      {/* Minimal step indicator */}
      <nav aria-label="Booking progress" style={{ marginBottom: '2.5rem' }}>
        {/* Step label + count */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.75rem',
        }}>
          <span style={{
            fontSize: '0.8125rem',
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-dark)',
          }}>
            {stepLabels[state.currentStep]}
          </span>
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--color-muted)',
            letterSpacing: '0.04em',
          }}>
            {state.currentStep + 1} / {stepLabels.length}
          </span>
        </div>

        {/* Progress track */}
        <div style={{
          height: '2px',
          background: 'rgba(150, 112, 91, 0.1)',
          borderRadius: '1px',
          overflow: 'hidden',
        }}>
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

      {/* Back button */}
      {state.currentStep > 0 && (
        <button
          type="button"
          onClick={() =>
            dispatch({ type: 'GO_TO_STEP', payload: state.currentStep - 1 })
          }
          style={{
            marginBottom: '1.5rem',
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

      {/* Current step with transition */}
      <StepTransition stepKey={state.currentStep}>
        {renderStep()}
      </StepTransition>
    </div>
  )
}

function StepTransition({ stepKey, children }: { stepKey: number; children: React.ReactNode }) {
  const [visible, setVisible] = useState(true)
  const [content, setContent] = useState(children)
  const prevKey = useRef(stepKey)

  useEffect(() => {
    if (stepKey !== prevKey.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setContent(children)
        prevKey.current = stepKey
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    } else {
      setContent(children)
    }
  }, [stepKey, children])

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {content}
    </div>
  )
}

export default function PartyWizard({ eventTypes }: PartyWizardProps) {
  return (
    <WizardProvider>
      <WizardContent eventTypes={eventTypes} />
    </WizardProvider>
  )
}
