import { WizardProvider, useWizard } from '@components/booking/WizardContext'
import type { EventTypeConfig } from '@config/site.config'
import EventTypeStep from './steps/EventTypeStep'
import BookingModal from './BookingModal'

interface BookingLandingProps {
  eventTypes: EventTypeConfig[]
}

function LandingContent({ eventTypes }: BookingLandingProps) {
  const { state, dispatch } = useWizard()
  const modalOpen = state.currentStep >= 1 && state.eventType !== null

  function handleModalClose() {
    dispatch({ type: 'RESET' })
  }

  return (
    <>
      <EventTypeStep eventTypes={eventTypes} />
      {modalOpen && <BookingModal onClose={handleModalClose} />}
    </>
  )
}

export default function BookingLanding({ eventTypes }: BookingLandingProps) {
  return (
    <WizardProvider>
      <LandingContent eventTypes={eventTypes} />
    </WizardProvider>
  )
}
