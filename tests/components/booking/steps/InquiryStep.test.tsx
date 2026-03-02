import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({
    state: {
      eventType: { id: 'corporate', name: 'Corporate Event', flow: 'quote' },
      selectedDates: { start: '2026-04-01', end: '2026-04-01' },
      specialRequests: 'Need projector',
      customerInfo: null,
      paymentStatus: 'idle',
      guestCount: 10,
      error: null,
    },
    dispatch: mockDispatch,
  }),
}))

import InquiryStep from '@components/booking/steps/InquiryStep'

describe('InquiryStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
  })

  it('renders customer info form with name, email, phone fields', () => {
    render(<InquiryStep />)

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
  })

  it('shows review section with event type and dates', () => {
    render(<InquiryStep />)

    expect(screen.getByText(/Corporate Event/)).toBeInTheDocument()
    expect(screen.getByText(/April 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Need projector/)).toBeInTheDocument()
  })

  it('submit button is present with "Submit Inquiry" text', () => {
    render(<InquiryStep />)

    expect(screen.getByRole('button', { name: /submit inquiry/i })).toBeInTheDocument()
  })

  it('validates required fields (name and email)', () => {
    render(<InquiryStep />)

    fireEvent.click(screen.getByRole('button', { name: /submit inquiry/i }))

    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Email is required')).toBeInTheDocument()
  })
})
