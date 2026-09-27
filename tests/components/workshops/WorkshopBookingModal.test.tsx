import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkshopBookingModal from '@components/workshops/WorkshopBookingModal'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes.
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props: unknown, ref: any) => {
      useImperativeHandle(ref, () => ({
        tokenize: async () => 'cnon:test-token',
        tokenizeAndVerify: async () => ({ token: 'cnon:test-token' }),
      }))
      return <div data-testid="payment-form" />
    }),
  }
})

function makeWorkshop(overrides: Partial<WorkshopData> = {}): WorkshopData {
  return {
    id: '1',
    name: 'Candle Making',
    description: 'Make candles',
    category: 'workshop',
    date: '2026-03-15',
    startTime: '2026-03-15T10:00:00',
    endTime: '2026-03-15T11:30:00',
    duration: 90,
    price: 4500,
    currency: 'USD',
    remainingSeats: 5,
    classScheduleId: 'sched-1',
    ...overrides,
  }
}

/** Walk Details → Seats → Your Info → Payment, picking `seats` seats on the way. */
async function goToPayment(workshop: WorkshopData, seats: number) {
  render(<WorkshopBookingModal workshop={workshop} onClose={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Number of Seats')
  for (let i = 1; i < seats; i++) {
    fireEvent.click(screen.getByRole('button', { name: '+' }))
  }

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('First Name *')
  const [firstName, , email] = screen.getAllByRole('textbox')
  fireEvent.change(firstName, { target: { value: 'Alice' } })
  fireEvent.change(email, { target: { value: 'alice@test.com' } })

  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }))
  await screen.findByTestId('payment-form')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WorkshopBookingModal — payment step', () => {
  it.each([
    { seats: 1, price: 4500, expected: '$45.00' },
    { seats: 2, price: 4500, expected: '$90.00' },
    { seats: 3, price: 2000, expected: '$60.00' },
  ])('pay button shows seats × price ($seats × $price cents = $expected)', async ({ seats, price, expected }) => {
    await goToPayment(makeWorkshop({ price }), seats)

    expect(screen.getByRole('button', { name: `Pay ${expected}` })).toBeInTheDocument()
  })

  it('offers no coupon field', async () => {
    await goToPayment(makeWorkshop(), 1)

    expect(screen.queryByPlaceholderText('Coupon code')).not.toBeInTheDocument()
    expect(screen.queryByText(/coupon/i)).not.toBeInTheDocument()
  })

  it('books the same seats the pay button priced, with no discount in the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { bookingId: 'wkbk-1', receiptUrl: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment(makeWorkshop(), 2)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Pay $90.00' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workshops/book.json')
    const body = JSON.parse(init.body)
    expect(body.seats).toBe(2)
    expect(Object.keys(body).sort()).toEqual(
      ['classScheduleId', 'customer', 'paymentToken', 'seats', 'startAt'],
    )
    expect(await screen.findByText('Booking Confirmed')).toBeInTheDocument()
  })
})
