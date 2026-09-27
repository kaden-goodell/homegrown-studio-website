import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkshopBookingModal from '@components/workshops/WorkshopBookingModal'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes
// and reports itself ready (or not, when a test says so).
let paymentFormReady = true
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: { onReadyChange?: (ready: boolean) => void }, ref: any) => {
      useImperativeHandle(ref, () => ({
        tokenize: async () => 'cnon:test-token',
        tokenizeAndVerify: async () => ({ token: 'cnon:test-token' }),
      }))
      useEffect(() => {
        props.onReadyChange?.(paymentFormReady)
      }, [])
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
  const [firstName, lastName, email, phone] = screen.getAllByRole('textbox')
  fireEvent.change(firstName, { target: { value: 'Alice' } })
  fireEvent.change(lastName, { target: { value: 'Smith' } })
  fireEvent.change(email, { target: { value: 'alice@test.com' } })
  fireEvent.change(phone, { target: { value: '(256) 555-0123' } })

  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }))
  await screen.findByTestId('payment-form')
}

afterEach(() => {
  paymentFormReady = true
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function serverSays(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('WorkshopBookingModal — payment step', () => {
  it.each([
    { seats: 1, price: 4500, expected: '$45.00' },
    { seats: 2, price: 4500, expected: '$90.00' },
    { seats: 3, price: 2000, expected: '$60.00' },
  ])('pay button shows seats × price ($seats × $price cents = $expected)', async ({ seats, price, expected }) => {
    await goToPayment(makeWorkshop({ price }), seats)

    // The button reads "Loading payment form…" until the card field reports ready.
    expect(await screen.findByRole('button', { name: `Pay ${expected}` })).toBeInTheDocument()
  })

  it('offers no coupon field', async () => {
    await goToPayment(makeWorkshop(), 1)

    expect(screen.queryByPlaceholderText('Coupon code')).not.toBeInTheDocument()
    expect(screen.queryByText(/coupon/i)).not.toBeInTheDocument()
  })

  it('books the same seats the pay button priced, with no discount in the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serverSays(200, { data: { bookingId: 'wkbk-1', receiptUrl: null, emailSent: true } }))
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment(makeWorkshop(), 2)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $90.00' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workshops/book.json')
    const body = JSON.parse(init.body)
    expect(body.seats).toBe(2)
    expect(Object.keys(body).sort()).toEqual(
      ['attemptId', 'classScheduleId', 'customer', 'paymentToken', 'seats', 'startAt', 'workshopId'],
    )
    expect(body.customer).toEqual({ givenName: 'Alice', familyName: 'Smith', email: 'alice@test.com', phone: '(256) 555-0123' })
    expect(body.workshopId).toBe('1')
    expect(await screen.findByText('Booking Confirmed')).toBeInTheDocument()
  })
})

describe('WorkshopBookingModal — retries and honest outcomes', () => {
  async function pay(amount = '$45.00') {
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(await screen.findByRole('button', { name: `Pay ${amount}` }))
  }

  async function attemptIdsOfTwoTries(firstAnswer: () => Promise<unknown>) {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(firstAnswer)
      .mockResolvedValueOnce(serverSays(200, { data: { bookingId: 'wkbk-1', receiptUrl: null, emailSent: true } }))
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment(makeWorkshop(), 1)

    await pay()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Pay $45.00' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    return [0, 1].map((i) => JSON.parse(fetchMock.mock.calls[i][1].body).attemptId)
  }

  it('sends the same attempt ID again while it does not know how the first try ended', async () => {
    const [first, second] = await attemptIdsOfTwoTries(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(first).toMatch(UUID)
    expect(second).toBe(first)
  })

  it('keeps the attempt ID when the server itself is not sure', async () => {
    const [first, second] = await attemptIdsOfTwoTries(async () => serverSays(502, { code: 'unknown_outcome', detail: 'not sure' }))
    expect(second).toBe(first)
  })

  it('starts a new attempt after a declined card, so a second card is a fresh try', async () => {
    const [first, second] = await attemptIdsOfTwoTries(async () =>
      serverSays(402, { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' }),
    )
    expect(first).toMatch(UUID)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
  })

  it('shows the sentence the server chose for a declined card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(402, { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' })))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined. Nothing was charged. Try another card.')
  })

  it('says it is not sure, never "not charged", when the connection drops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We’re not sure that went through.')
    expect(alert).toHaveTextContent('(256) 464-1710')
    expect(alert).not.toHaveTextContent(/not charged|Failed to fetch/i)
  })

  it('says it is not sure when the answer is a gateway error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We’re not sure that went through.')
    expect(alert).not.toHaveTextContent(/Unexpected token/)
  })

  it('says it is not sure when the server says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(502, { code: 'unknown_outcome', detail: 'We’re not sure that went through. Please don’t pay again yet.' })))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Please don’t pay again yet.')
  })

  it('keeps what was typed after a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(402, { code: 'card_declined' })))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    await screen.findByText('First Name *')
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Alice')
  })

  it('explains an unticked policy box on tap instead of greying the button out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment(makeWorkshop(), 1)

    const button = await screen.findByRole('button', { name: 'Pay $45.00' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent(/agree to the booking & cancellation policy/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for the card field, and says that is what it is doing', async () => {
    paymentFormReady = false
    await goToPayment(makeWorkshop(), 1)
    const button = screen.getByRole('button', { name: 'Loading payment form…' })
    expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Pay $45.00' })).not.toBeInTheDocument()
  })

  it('only says a confirmation email is coming when one was sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(200, { data: { bookingId: 'wkbk-1', receiptUrl: null, emailSent: false } })))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    await screen.findByText('Booking Confirmed')
    expect(screen.getByText(/couldn’t send your confirmation email/)).toBeInTheDocument()
    expect(screen.queryByText(/on its way/)).not.toBeInTheDocument()
  })

  it('says the email is on its way when it was sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(200, { data: { bookingId: 'wkbk-1', receiptUrl: null, emailSent: true } })))
    await goToPayment(makeWorkshop(), 1)
    await pay()
    await screen.findByText('Booking Confirmed')
    expect(screen.getByText(/on its way/)).toBeInTheDocument()
  })

  it('will not go to payment without a last name or with a bad email', async () => {
    render(<WorkshopBookingModal workshop={makeWorkshop()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Number of Seats')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('First Name *')
    const [firstName, lastName, email] = screen.getAllByRole('textbox')
    fireEvent.change(firstName, { target: { value: 'Alice' } })
    fireEvent.change(email, { target: { value: 'alice@' } })
    expect(screen.getByRole('button', { name: 'Continue to Payment' })).toBeDisabled()
    fireEvent.change(email, { target: { value: 'alice@test.com' } })
    expect(screen.getByRole('button', { name: 'Continue to Payment' })).toBeDisabled()
    fireEvent.change(lastName, { target: { value: 'Smith' } })
    expect(screen.getByRole('button', { name: 'Continue to Payment' })).not.toBeDisabled()
  })

  it('never offers more seats than one booking can hold', async () => {
    render(<WorkshopBookingModal workshop={makeWorkshop({ remainingSeats: 35 })} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Number of Seats')
    const plus = screen.getByRole('button', { name: '+' })
    for (let i = 0; i < 30; i++) fireEvent.click(plus)
    expect(screen.getByText('$900.00')).toBeInTheDocument() // 20 × $45
  })
})
