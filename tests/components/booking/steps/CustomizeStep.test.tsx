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
    maxCapacity: 20,
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
        maxCapacity: 20,
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

  it('booking mode shows guest count input and price breakdown', () => {
    render(<CustomizeStep addOns={addOns} basePrice={40000} />)

    expect(screen.getByLabelText('Number of Guests')).toBeInTheDocument()
    expect(screen.getByText(/12 included in base package/)).toBeInTheDocument()
    expect(screen.getByText(/\$15\.00\/extra guest/)).toBeInTheDocument()
    expect(screen.getByText(/20 max/)).toBeInTheDocument()
    expect(screen.getByText('Base package (12 guests)')).toBeInTheDocument()
    expect(screen.getByText('Estimated Total')).toBeInTheDocument()
    // $400.00 appears in both the line item and total
    expect(screen.getAllByText('$400.00')).toHaveLength(2)
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

    render(<CustomizeStep addOns={addOns} basePrice={0} />)

    expect(screen.getByLabelText('Special Requests')).toBeInTheDocument()
    expect(screen.queryByLabelText('Number of Guests')).not.toBeInTheDocument()
    expect(screen.queryByText(/Goodie Bags/)).not.toBeInTheDocument()
  })

  it('renders add-on checkboxes with formatted prices', () => {
    render(<CustomizeStep addOns={addOns} basePrice={40000} />)

    expect(screen.getByText('Goodie Bags')).toBeInTheDocument()
    expect(screen.getByText('$8.00')).toBeInTheDocument()
    expect(screen.getByText('Extra Paint Set')).toBeInTheDocument()
    expect(screen.getByText('$5.00')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('continue button dispatches GO_TO_STEP(5)', () => {
    render(<CustomizeStep addOns={addOns} basePrice={40000} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Checkout' }))

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'GO_TO_STEP',
      payload: 5,
    })
  })
})
