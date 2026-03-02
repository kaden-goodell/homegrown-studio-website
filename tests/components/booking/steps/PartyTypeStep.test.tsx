import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({
    state: {
      eventType: { id: 'birthday', name: 'Kids Party', catalogCategory: 'kids-party', flow: 'booking', duration: 120, allowAddOns: true, allowExtraGuests: true },
      selectedPartyType: null,
      currentStep: 3,
      selectedDates: null,
      desiredDuration: null,
      selectedSlot: null,
      guestCount: 12,
      selectedAddOns: [],
      specialRequests: '',
      customerInfo: null,
      couponCode: null,
      appliedDiscount: null,
      orderId: null,
      bookingId: null,
      paymentStatus: 'idle',
      error: null,
    },
    dispatch: mockDispatch,
  }),
}))

// Mock fetch to return party types
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    data: [
      {
        id: 'kids-slime',
        name: 'Slime Party',
        description: 'Gooey, glittery, totally messy fun!',
        category: 'kids-party',
        variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
        modifiers: [],
        flow: 'booking',
        duration: 120,
      },
      {
        id: 'kids-painting',
        name: 'Painting Party',
        description: 'Canvas painting with guided instruction.',
        category: 'kids-party',
        variations: [{ id: 'kids-painting-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
        modifiers: [],
        flow: 'booking',
        duration: 120,
      },
    ],
  }),
}) as any

import PartyTypeStep from '@components/booking/steps/PartyTypeStep'

describe('PartyTypeStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    ;(global.fetch as any).mockClear()
  })

  it('fetches party types by catalog category and renders cards', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText('Slime Party')).toBeInTheDocument()
      expect(screen.getByText('Painting Party')).toBeInTheDocument()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/catalog/event-types.json?category=kids-party')
  })

  it('dispatches SET_PARTY_TYPE and GO_TO_STEP on card click', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText('Slime Party')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Slime Party'))

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_PARTY_TYPE',
      payload: expect.objectContaining({ id: 'kids-slime', name: 'Slime Party' }),
    })
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_TO_STEP', payload: 4 })
  })

  it('shows short descriptions on each card', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText(/Gooey, glittery/)).toBeInTheDocument()
      expect(screen.getByText(/Canvas painting/)).toBeInTheDocument()
    })
  })
})
