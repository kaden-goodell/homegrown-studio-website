import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import WorkshopBookingModal from '@components/workshops/WorkshopBookingModal'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { CONTACT_MESSAGES } from '@lib/contact-rules'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes
// and reports itself ready (or not, when a test says so).
let paymentFormReady = true
let paymentFormProps: Record<string, unknown> = {}
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: { onReadyChange?: (ready: boolean) => void }, ref: any) => {
      paymentFormProps = props
      useImperativeHandle(ref, () => ({
        tokenize: async () => ({ token: 'cnon:test-token', kind: 'card' }),
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
    id: 'inst-1',
    name: 'Candle Making',
    description: 'Make candles.\n\nEveryone pours two.\n\nEach guest goes home with two candles. Ages 12 and up.',
    category: 'workshop',
    date: '2026-10-16',
    // 7–9 PM Central on Fri 16 Oct 2026
    startTime: '2026-10-17T00:00:00.000Z',
    endTime: '2026-10-17T02:00:00.000Z',
    duration: 120,
    price: 4500,
    currency: 'USD',
    remainingSeats: 5,
    classScheduleId: 'sched-1',
    ...overrides,
  }
}

const dialog = () => screen.getByRole('dialog')

function open(workshop: WorkshopData = makeWorkshop(), props: Partial<Parameters<typeof WorkshopBookingModal>[0]> = {}) {
  const onClose = vi.fn()
  render(<WorkshopBookingModal workshop={workshop} onClose={onClose} {...props} />)
  return { onClose }
}

function addSeats(extra: number) {
  for (let i = 0; i < extra; i++) fireEvent.click(screen.getByRole('button', { name: 'More seats' }))
}

function fillContact(values: Partial<Record<'First name' | 'Last name' | 'Email' | 'Phone (optional)', string>> = {}) {
  const all = { 'First name': 'Alice', 'Last name': 'Smith', Email: 'alice@test.com', 'Phone (optional)': '(256) 555-0123', ...values }
  for (const [label, value] of Object.entries(all)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
}

/** Details → Your details and payment, with `seats` seats and the contact fields filled in. */
async function goToPayment(workshop: WorkshopData = makeWorkshop(), seats = 1) {
  const result = open(workshop)
  addSeats(seats - 1)
  fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
  await screen.findByTestId('payment-form')
  fillContact()
  return result
}

async function pay(amount = '$45') {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(await screen.findByRole('button', { name: `Pay ${amount}` }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function serverSays(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
const booked = (over: Record<string, unknown> = {}) =>
  serverSays(200, { data: { bookingId: 'wkbk-1', receiptUrl: 'https://squareup.com/receipt/1', emailSent: true, ...over } })

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  window.history.replaceState(null, '', '/workshops')
})

afterEach(() => {
  paymentFormReady = true
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WorkshopBookingModal — the panel', () => {
  it('is a dialog named after the workshop, not "Book Seat"', () => {
    open()
    expect(dialog()).toHaveAccessibleName('Candle Making')
    expect(screen.queryByText('Book Seat')).toBeNull()
  })

  it('takes two steps', async () => {
    open()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('Your details and payment')).toBeInTheDocument()
  })

  it('keeps the date, time, seats and total in view on both steps, in studio time', async () => {
    open()
    addSeats(1)
    expect(screen.getByText(/Fri, Oct 16 · 7–9 PM · 2 seats ·/)).toHaveTextContent('Fri, Oct 16 · 7–9 PM · 2 seats · $90')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    expect(screen.getByText(/Fri, Oct 16 · 7–9 PM · 2 seats ·/)).toHaveTextContent('$90')
  })

  it('shows the whole description on the first step', () => {
    open()
    expect(screen.getByText('Make candles.')).toBeInTheDocument()
    expect(screen.getByText('Each guest goes home with two candles. Ages 12 and up.')).toBeInTheDocument()
  })

  it('has no Back button on the first step', async () => {
    open()
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument()
  })

  it('puts the workshop in the address while open and takes it out on close', () => {
    const { unmount } = render(<WorkshopBookingModal workshop={makeWorkshop()} onClose={vi.fn()} />)
    expect(window.location.search).toBe('?w=inst-1')
    unmount()
    expect(window.location.search).toBe('')
  })
})

describe('WorkshopBookingModal — seats', () => {
  it('labels the counter buttons and announces the count', () => {
    open()
    const group = screen.getByRole('group', { name: 'Seats' })
    expect(within(group).getByRole('button', { name: 'Fewer seats' })).toBeDisabled()
    fireEvent.click(within(group).getByRole('button', { name: 'More seats' }))
    expect(within(group).getByText('2 seats')).toBeInTheDocument()
  })

  it('prices per seat in whole dollars, and keeps the cents when there are any', () => {
    open(makeWorkshop({ price: 3250 }))
    expect(screen.getByText(/\$32\.50 per seat/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue · $32.50' })).toBeInTheDocument()
  })

  it('mentions seats left only when 8 or fewer remain', () => {
    open(makeWorkshop({ remainingSeats: 35 }))
    expect(screen.queryByText(/seats left/)).toBeNull()
  })

  it('says "5 seats left" when that is true', () => {
    open(makeWorkshop({ remainingSeats: 5 }))
    expect(screen.getByText(/\$45 per seat · 5 seats left/)).toBeInTheDocument()
  })

  it('never offers more seats than are left, and says why it stopped', () => {
    open(makeWorkshop({ remainingSeats: 3 }))
    addSeats(10)
    expect(screen.getByRole('button', { name: 'Continue · $135' })).toBeInTheDocument() // 3 × $45
    expect(screen.getByRole('button', { name: 'More seats' })).toBeDisabled()
    expect(screen.getByText('That’s every seat left in this workshop.')).toBeInTheDocument()
  })

  it('never offers more seats than one booking can hold, and points to a private party', () => {
    open(makeWorkshop({ remainingSeats: 35 }))
    addSeats(30)
    expect(screen.getByRole('button', { name: 'Continue · $900' })).toBeInTheDocument() // 20 × $45
    expect(screen.getByText(/One booking holds up to 20 seats/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'book a private party' })).toHaveAttribute('href', '/book')
  })
})

describe('WorkshopBookingModal — payment step', () => {
  it.each([
    { seats: 1, price: 4500, expected: '$45' },
    { seats: 2, price: 4500, expected: '$90' },
    { seats: 3, price: 2000, expected: '$60' },
    { seats: 2, price: 3250, expected: '$65' },
  ])('pay button shows seats × price ($seats × $price cents = $expected)', async ({ seats, price, expected }) => {
    await goToPayment(makeWorkshop({ price }), seats)
    // The button reads "Loading payment form…" until the card field reports ready.
    expect(await screen.findByRole('button', { name: `Pay ${expected}` })).toBeInTheDocument()
  })

  it('offers no coupon field', async () => {
    await goToPayment()
    expect(screen.queryByText(/coupon/i)).not.toBeInTheDocument()
  })

  it('states the refund terms beside the button', async () => {
    await goToPayment()
    expect(screen.getByText('Full refund up to 48 hours before. After that, studio credit or a free seat transfer.')).toBeInTheDocument()
  })

  it('books the same seats the pay button priced, with no discount in the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(booked())
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment(makeWorkshop(), 2)

    await pay('$90')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workshops/book.json')
    const body = JSON.parse(init.body)
    expect(body.seats).toBe(2)
    expect(Object.keys(body).sort()).toEqual(
      ['attemptId', 'classScheduleId', 'customer', 'paymentToken', 'seats', 'sourceKind', 'startAt', 'workshopId'],
    )
    expect(body.customer).toEqual({ givenName: 'Alice', familyName: 'Smith', email: 'alice@test.com', phone: '(256) 555-0123' })
    expect(body.workshopId).toBe('inst-1')
    expect(body.sourceKind).toBe('card')
    expect(paymentFormProps.giftCards).toBe('cards-only')
    expect(await screen.findByText('You’re booked')).toBeInTheDocument()
  })

  it('leaves the phone out of the request when none was given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(booked())
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment()
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '' } })
    await pay()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).customer).toEqual({ givenName: 'Alice', familyName: 'Smith', email: 'alice@test.com' })
  })

  it('submits when Enter is pressed in a field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(booked())
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment()
    fireEvent.click(screen.getByRole('checkbox'))
    await screen.findByRole('button', { name: 'Pay $45' })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})

describe('WorkshopBookingModal — what is missing is said, not hidden', () => {
  it('never greys out Pay for missing details: it says what is missing under each field', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    const button = await screen.findByRole('button', { name: 'Pay $45' })
    expect(button).not.toBeDisabled()

    fireEvent.click(button)

    const messages = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(messages).toEqual([
      CONTACT_MESSAGES.firstName,
      CONTACT_MESSAGES.lastName,
      CONTACT_MESSAGES.emailMissing,
      'Tick the box to agree to the booking and cancellation policy.',
    ])
    expect(screen.getByLabelText('First name')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('goes to the policy box when that is all that is missing, and clears the message once ticked', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment()
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $45' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Tick the box to agree to the booking and cancellation policy.')
    expect(screen.getByRole('checkbox')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('will not pay with a first name standing in for a last name', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment()
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: '' } })
    await pay()
    expect(screen.getByRole('alert')).toHaveTextContent(CONTACT_MESSAGES.lastName)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for the card field, and says that is what it is doing', async () => {
    paymentFormReady = false
    await goToPayment()
    expect(screen.getByRole('button', { name: 'Loading payment form…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Pay $45' })).not.toBeInTheDocument()
  })
})

describe('WorkshopBookingModal — retries and honest outcomes', () => {
  async function attemptIdsOfTwoTries(firstAnswer: () => Promise<unknown>) {
    const fetchMock = vi.fn().mockImplementationOnce(firstAnswer).mockResolvedValueOnce(booked())
    vi.stubGlobal('fetch', fetchMock)
    await goToPayment()

    await pay()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Pay $45' }))
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
    await goToPayment()
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined. Nothing was charged. Try another card.')
  })

  it('says it is not sure, never "not charged", when the connection drops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await goToPayment()
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We’re not sure that went through.')
    expect(alert).toHaveTextContent('(256) 464-1710')
    expect(alert).not.toHaveTextContent(/not charged|Failed to fetch/i)
  })

  it('says it is not sure when the answer is a gateway error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    await goToPayment()
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We’re not sure that went through.')
    expect(alert).not.toHaveTextContent(/Unexpected token/)
  })

  it('says it is not sure when the server says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(502, { code: 'unknown_outcome', detail: 'We’re not sure that went through. Please don’t pay again yet.' })))
    await goToPayment()
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Please don’t pay again yet.')
  })

  it('keeps what was typed after a failure, and through Back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverSays(402, { code: 'card_declined' })))
    await goToPayment()
    await pay()
    await screen.findByRole('alert')
    expect(screen.getByLabelText('First name')).toHaveValue('Alice')

    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    expect(screen.getByLabelText('First name')).toHaveValue('Alice')
    expect(screen.getByLabelText('Email')).toHaveValue('alice@test.com')
  })
})

describe('WorkshopBookingModal — confirmation', () => {
  async function bookedScreen(seats = 1, answer = booked()) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer))
    const result = await goToPayment(makeWorkshop(), seats)
    await pay(seats === 1 ? '$45' : `$${45 * seats}`)
    await screen.findByText('You’re booked')
    return result
  }

  it('says what was bought, when and where', async () => {
    await bookedScreen(2)
    expect(screen.getByText(/2 seats for/)).toHaveTextContent('2 seats for Candle Making, $90 paid.')
    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByText(/525 Hughes Rd, Suite F, Madison, AL 35758/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', expect.stringContaining('maps.google.com'))
  })

  it('offers a calendar entry with the right start and end', async () => {
    await bookedScreen()
    const google = screen.getByRole('link', { name: 'Add to Google Calendar' })
    expect(google.getAttribute('href')).toContain('dates=20261017T000000Z%2F20261017T020000Z')
    const ics = decodeURIComponent(screen.getByRole('link', { name: 'Apple or Outlook' }).getAttribute('href')!)
    expect(ics).toContain('DTSTART:20261017T000000Z')
    expect(ics).toContain('DTEND:20261017T020000Z')
  })

  it('links the agreement to this booking', async () => {
    await bookedScreen()
    expect(screen.getByRole('link', { name: 'Sign the agreement' })).toHaveAttribute('href', expect.stringMatching(/\/waiver\?workshop=sched-1&booking=wkbk-1$/))
  })

  it('gives someone who bought several seats a link to send their friends', async () => {
    await bookedScreen(3)
    expect(screen.getByText(/Coming with friends\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument()
  })

  it('does not talk about friends to someone who bought one seat', async () => {
    await bookedScreen(1)
    expect(screen.queryByText(/Coming with friends\?/)).toBeNull()
  })

  it('copies the friends link and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await bookedScreen(2)
    fireEvent.click(screen.getByRole('button', { name: 'Send the link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/waiver\?workshop=sched-1&booking=wkbk-1$/)))
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
  })

  it('states the refund window and links the receipt', async () => {
    await bookedScreen()
    expect(screen.getAllByText(/Full refund up to 48 hours before/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'View your receipt' })).toHaveAttribute('href', 'https://squareup.com/receipt/1')
  })

  it('only says a confirmation email is coming when one was sent', async () => {
    await bookedScreen(1, booked({ emailSent: false }))
    expect(screen.getByText(/couldn’t send your confirmation email/)).toBeInTheDocument()
    expect(screen.queryByText(/on its way/)).not.toBeInTheDocument()
  })

  it('says the email is on its way when it was sent', async () => {
    await bookedScreen()
    expect(screen.getByText(/on its way/)).toHaveTextContent('alice@test.com')
  })

  it('asks for one burst of glitter', async () => {
    const heard = vi.fn()
    window.addEventListener('hometown:celebrate', heard)
    await bookedScreen()
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('hometown:celebrate', heard)
  })

  it('Done closes the panel and tells the list to refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(booked()))
    const onBooked = vi.fn()
    const onClose = vi.fn()
    render(<WorkshopBookingModal workshop={makeWorkshop()} onClose={onClose} onBooked={onBooked} />)
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fillContact()
    await pay()
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(onBooked).toHaveBeenCalledTimes(1)
    expect(onBooked).toHaveBeenCalledWith(1) // the seats bought
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('WorkshopBookingModal — leaving', () => {
  it('closes without asking when nothing has been entered, even on step two', async () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks first once the seat count was changed', () => {
    const { onClose } = open()
    addSeats(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Leave without booking?')
  })

  it('asks first once something was typed, and offers "Keep booking" and "Close"', async () => {
    const { onClose } = await goToPayment()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const prompt = screen.getByRole('alertdialog')
    expect(within(prompt).getByText(/5 seats left in Candle Making\. Nothing is saved until you pay\./)).toBeInTheDocument()
    expect(within(prompt).queryByText(/Keep my seat/)).toBeNull()

    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep booking' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not claim seats are running out when plenty are left', () => {
    open(makeWorkshop({ remainingSeats: 35 }))
    addSeats(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Nothing is saved until you pay.')
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(/seats left/)
  })
})

describe('WorkshopBookingModal — a question for each seat', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const pails = () => makeWorkshop({ name: 'Bedazzled Pumpkin Pails', price: 2500, options: [PAILS] })
  const pick = (seat: number, choice: string) =>
    fireEvent.change(screen.getByLabelText(`Seat ${seat} · Pumpkin color`), { target: { value: choice } })

  it('asks once per seat, and again for each seat added', () => {
    open(pails())
    expect(screen.getByLabelText('Seat 1 · Pumpkin color')).toBeInTheDocument()
    expect(screen.queryByLabelText('Seat 2 · Pumpkin color')).toBeNull()
    addSeats(1)
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toBeInTheDocument()
  })

  it('offers only the class’s choices, and says picks are final', () => {
    open(pails())
    const options = within(screen.getByLabelText('Seat 1 · Pumpkin color')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Choose…', 'Light Pink', 'Light Blue', 'Black', 'Lavender'])
    expect(screen.getByText('Picks are made ahead for you, so they can’t be changed after you book.')).toBeInTheDocument()
  })

  it('will not go on until every seat has picked, and says which seat', () => {
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(screen.getByText('Pick a pumpkin color for seat 2.')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toHaveFocus()
  })

  it('keeps earlier picks through seat changes, and sends picks only for the seats booked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(booked())
    vi.stubGlobal('fetch', fetchMock)
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    pick(2, 'Black')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer seats' }))
    expect(screen.queryByLabelText('Seat 2 · Pumpkin color')).toBeNull()
    addSeats(1)
    expect(screen.getByLabelText('Seat 1 · Pumpkin color')).toHaveValue('Lavender')
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toHaveValue('Black')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer seats' }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fillContact()
    await pay('$25')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).picks).toEqual([{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }])
  })

  it('starts a new attempt when a pick changes after an unsure try, and keeps it when nothing changed', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch')
      })
      .mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch')
      })
      .mockResolvedValueOnce(booked())
    vi.stubGlobal('fetch', fetchMock)
    open(pails())
    pick(1, 'Lavender')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fillContact()
    await pay('$25')
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Pay $25' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    pick(1, 'Black')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $25' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const ids = [0, 1, 2].map((i) => JSON.parse(fetchMock.mock.calls[i][1].body).attemptId)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[1])
  })

  it('shows each seat’s pick on the confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(booked()))
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    pick(2, 'Black')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fillContact()
    await pay('$50')
    await screen.findByText('Your picks')
    expect(screen.getByText(/Pumpkin color: Black ×1, Lavender ×1/)).toBeInTheDocument()
    expect(screen.getByText('Picks are made ahead for you, so they can’t be changed after you book.')).toBeInTheDocument()
  })

  it('shows the picks beside the total on the payment step', async () => {
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    pick(2, 'Lavender')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    expect(screen.getByText('Pumpkin color: Lavender ×2')).toBeInTheDocument()
  })
})
