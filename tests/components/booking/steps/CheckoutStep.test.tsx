import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({
    state: {
      currentStep: 4,
      eventType: { id: 'birthday', name: 'Birthday Party' },
      selectedDates: null,
      desiredDuration: null,
      selectedSlot: null,
      guestCount: 10,
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

vi.mock('@components/checkout/PaymentForm', () => {
  const { forwardRef, useImperativeHandle } = require('react')
  return {
    default: forwardRef(function MockPaymentForm(_props: unknown, ref: React.Ref<unknown>) {
      useImperativeHandle(ref, () => ({
        tokenize: () => Promise.resolve('mock-token'),
      }))
      return <div data-testid="payment-form">Mock Payment Form</div>
    }),
  }
})

import CheckoutStep from '@components/booking/steps/CheckoutStep'

describe('CheckoutStep', () => {
  it('renders customer info form fields', () => {
    render(<CheckoutStep />)

    expect(screen.getByLabelText('Name *')).toBeInTheDocument()
    expect(screen.getByLabelText('Email *')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone')).toBeInTheDocument()
  })

  it('shows OrderSummary component', () => {
    render(<CheckoutStep />)

    expect(screen.getByText('Order Summary')).toBeInTheDocument()
  })

  it('has Book & Pay button', () => {
    render(<CheckoutStep />)

    expect(screen.getByRole('button', { name: 'Book & Pay' })).toBeInTheDocument()
  })
})
