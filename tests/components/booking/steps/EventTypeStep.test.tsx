import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventTypeConfig } from '@config/site.config'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({ state: { currentStep: 0, eventType: null }, dispatch: mockDispatch }),
}))

import EventTypeStep from '@components/booking/steps/EventTypeStep'

const eventTypes: EventTypeConfig[] = [
  {
    id: 'birthday',
    name: 'Birthday Party',
    description: 'A creative birthday celebration',
    icon: 'cake',
    flow: 'booking',
    baseCapacity: 12,
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 1500,
  },
  {
    id: 'adult-workshop',
    name: 'Adult Workshop',
    description: 'Hands-on crafting workshops for adults',
    icon: 'palette',
    flow: 'booking',
    baseCapacity: 16,
    duration: 90,
    allowAddOns: true,
    allowExtraGuests: false,
  },
  {
    id: 'corporate',
    name: 'Corporate Event',
    description: 'Team-building and corporate crafting experiences',
    icon: 'briefcase',
    flow: 'quote',
    baseCapacity: 30,
    duration: 180,
    allowAddOns: true,
    allowExtraGuests: true,
  },
]

describe('EventTypeStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
  })

  it('renders all event type cards with name and description', () => {
    render(<EventTypeStep eventTypes={eventTypes} />)

    for (const et of eventTypes) {
      expect(screen.getByText(et.name)).toBeInTheDocument()
      expect(screen.getByText(et.description)).toBeInTheDocument()
    }
  })

  it('clicking a card dispatches SET_EVENT_TYPE with correct event type', () => {
    render(<EventTypeStep eventTypes={eventTypes} />)

    fireEvent.click(screen.getByText('Birthday Party'))

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_EVENT_TYPE',
      payload: eventTypes[0],
    })
  })

  it('shows duration on each card', () => {
    render(<EventTypeStep eventTypes={eventTypes} />)

    expect(screen.getByText('2 hours')).toBeInTheDocument()
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument()
    expect(screen.getByText('3 hours')).toBeInTheDocument()
  })
})
