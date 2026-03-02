import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AddOn } from '@providers/interfaces/catalog'

let mockState: any = {
  eventType: {
    id: 'birthday',
    name: 'Birthday Party',
    description: 'A creative birthday celebration',
    flow: 'booking',
    baseCapacity: 12,
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 1500,
  },
  guestCount: 12,
  selectedAddOns: [],
  specialRequests: '',
}

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({ state: mockState, dispatch: mockDispatch }),
}))

import CustomizeStep from '@components/booking/steps/CustomizeStep'

const addOns: AddOn[] = [
  { id: 'goodie-bags', name: 'Goodie Bags', priceAmount: 800, priceCurrency: 'USD' },
  { id: 'extra-paint', name: 'Extra Paint Set', priceAmount: 500, priceCurrency: 'USD' },
]

describe('CustomizeStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    mockState = {
      eventType: {
        id: 'birthday',
        name: 'Birthday Party',
        description: 'A creative birthday celebration',
        flow: 'booking',
        baseCapacity: 12,
        duration: 120,
        allowAddOns: true,
        allowExtraGuests: true,
        extraGuestPrice: 1500,
      },
      guestCount: 12,
      selectedAddOns: [],
      specialRequests: '',
    }
  })

  it('booking mode shows guest count input and add-ons', () => {
    render(<CustomizeStep addOns={addOns} />)

    expect(screen.getByLabelText('Number of Guests')).toBeInTheDocument()
    expect(screen.getByText('Base: 12 guests')).toBeInTheDocument()
    expect(screen.getByText('+$15.00 per extra guest')).toBeInTheDocument()
    expect(screen.getByText(/Goodie Bags/)).toBeInTheDocument()
    expect(screen.getByText(/Extra Paint Set/)).toBeInTheDocument()
  })

  it('quote mode shows only textarea', () => {
    mockState = {
      ...mockState,
      eventType: {
        id: 'corporate',
        name: 'Corporate Event',
        description: 'Team-building',
        flow: 'quote',
        baseCapacity: 30,
        duration: 180,
        allowAddOns: true,
        allowExtraGuests: true,
      },
    }

    render(<CustomizeStep addOns={addOns} />)

    expect(screen.getByLabelText('Special Requests')).toBeInTheDocument()
    expect(screen.queryByLabelText('Number of Guests')).not.toBeInTheDocument()
    expect(screen.queryByText(/Goodie Bags/)).not.toBeInTheDocument()
  })

  it('renders add-on checkboxes with formatted prices', () => {
    render(<CustomizeStep addOns={addOns} />)

    expect(screen.getByText(/Goodie Bags - \$8\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Extra Paint Set - \$5\.00/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('continue button dispatches GO_TO_STEP(4)', () => {
    render(<CustomizeStep addOns={addOns} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'GO_TO_STEP',
      payload: 4,
    })
  })
})
