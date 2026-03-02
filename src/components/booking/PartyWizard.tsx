import { useState, useEffect } from 'react'
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
        .then((data) => setAddOns(data))
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

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step indicator */}
      <nav aria-label="Booking progress" className="mb-8">
        <ol className="flex items-center gap-2">
          {stepLabels.map((label, i) => {
            const isActive = i === state.currentStep
            const isCompleted = i < state.currentStep
            return (
              <li key={label} className="flex items-center gap-2 flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isActive
                        ? 'bg-primary text-white'
                        : isCompleted
                          ? 'bg-primary/20 text-primary'
                          : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {isCompleted ? '✓' : i + 1}
                  </div>
                  <span
                    className={`text-xs mt-1 text-center ${
                      isActive ? 'font-semibold text-primary' : 'text-gray-500'
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 ${
                      isCompleted ? 'bg-primary/40' : 'bg-gray-200'
                    }`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Back button */}
      {state.currentStep > 0 && (
        <button
          type="button"
          onClick={() =>
            dispatch({ type: 'GO_TO_STEP', payload: state.currentStep - 1 })
          }
          className="mb-4 text-sm text-primary hover:underline flex items-center gap-1"
        >
          ← Back
        </button>
      )}

      {/* Current step */}
      {renderStep()}
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
