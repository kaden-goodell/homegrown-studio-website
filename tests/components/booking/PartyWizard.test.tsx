import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PartyWizard from '@components/booking/PartyWizard'
import type { EventTypeConfig } from '@config/site.config'

vi.mock('@components/booking/steps/EventTypeStep', () => ({
  default: () => <div data-testid="event-type-step">EventTypeStep</div>,
}))
vi.mock('@components/booking/steps/DateSelectionStep', () => ({
  default: () => <div data-testid="date-step">DateSelectionStep</div>,
}))
vi.mock('@components/booking/steps/AvailableSlotsStep', () => ({
  default: () => <div data-testid="slots-step">AvailableSlotsStep</div>,
}))
vi.mock('@components/booking/steps/CustomizeStep', () => ({
  default: () => <div data-testid="customize-step">CustomizeStep</div>,
}))
vi.mock('@components/booking/steps/CheckoutStep', () => ({
  default: () => <div data-testid="checkout-step">CheckoutStep</div>,
}))
vi.mock('@components/booking/steps/InquiryStep', () => ({
  default: () => <div data-testid="inquiry-step">InquiryStep</div>,
}))

const mockEventTypes: EventTypeConfig[] = [
  {
    id: 'birthday',
    name: 'Birthday Party',
    description: 'A birthday celebration',
    flow: 'booking',
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
  },
  {
    id: 'corporate',
    name: 'Corporate Event',
    description: 'Team-building event',
    flow: 'quote',
    duration: 180,
    allowAddOns: false,
    allowExtraGuests: false,
  },
]

describe('PartyWizard', () => {
  it('renders EventTypeStep on step 0 by default', () => {
    render(<PartyWizard eventTypes={mockEventTypes} />)
    expect(screen.getByTestId('event-type-step')).toBeInTheDocument()
  })

  it('shows step indicator with all step names', () => {
    render(<PartyWizard eventTypes={mockEventTypes} />)
    expect(screen.getByText('Event Type')).toBeInTheDocument()
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Time Slot')).toBeInTheDocument()
    expect(screen.getByText('Customize')).toBeInTheDocument()
    expect(screen.getByText('Checkout')).toBeInTheDocument()
  })

  it('does not show back button on step 0', () => {
    render(<PartyWizard eventTypes={mockEventTypes} />)
    expect(screen.queryByText('← Back')).not.toBeInTheDocument()
  })
})
