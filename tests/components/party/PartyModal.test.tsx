import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import PartyModal from '@components/party/PartyModal'
import { CONTACT_MESSAGES } from '@lib/contact-rules'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes and reports itself ready.
let paymentFormReady = true
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: { onReadyChange?: (ready: boolean) => void }, ref: any) => {
      useImperativeHandle(ref, () => ({ tokenize: async () => 'cnon:test-token' }))
      useEffect(() => {
        props.onReadyChange?.(paymentFormReady)
      }, [])
      return <div data-testid="payment-form" />
    }),
  }
})

// Noon Central on Sunday 27 Sep 2026. Parties start Sat 7 Nov, so dates run 7 Nov to 11 Nov.
const NOW = new Date('2026-09-27T17:00:00.000Z')
// Saturday 7 Nov 2026, Central (CST, UTC-6) — the first party weekend. Saturday has one
// party time (1:30 PM); Sunday 8 Nov has two (1:00 and 3:30 PM).
const SAT = '2026-11-07'
const SUN = '2026-11-08'
const slot = (iso: string) => ({ startAt: iso, endAt: new Date(Date.parse(iso) + 90 * 60_000).toISOString(), durationMinutes: 90 })
const SAT_1 = slot('2026-11-07T19:30:00.000Z')
const SUN_1 = slot('2026-11-08T19:00:00.000Z')
const SUN_3 = slot('2026-11-08T21:30:00.000Z')

const crafts = [
  { id: 'c-bling', name: 'Bedazzle & Bling', perHeadCents: 1500, description: 'Line one.\n\nEveryone picks their own.\n\nEach guest goes home with it. Ages 8 and up.', imageUrl: 'https://img.example/bling.jpg' },
  { id: 'c-keys', name: 'Bubble Letter Keychains', perHeadCents: 2000, description: 'Spell any word in chunky bubble letters.', imageUrl: 'https://img.example/keys.jpg', popular: true },
  { id: 'c-patch', name: 'Patch & Personalize', perHeadCents: 2500, description: 'Made for your group.', personalized: true },
]
const serviceInfo = {
  service: { id: 'svc', name: 'Whole Studio Party' },
  variationId: 'var-party',
  variationVersion: 7,
  durationMinutes: 90,
  basePriceCents: 30000,
  teamMemberId: 'tm',
  crafts,
}

type Answer = { status?: number; body: unknown } | (() => never)
let answers: Record<string, Answer>
let fetchMock: ReturnType<typeof vi.fn>

function respond(answer: Answer) {
  if (typeof answer === 'function') return answer()
  const status = answer.status ?? 200
  return { ok: status >= 200 && status < 300, status, json: async () => answer.body }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  answers = {
    'service-info': { body: { data: serviceInfo } },
    'available-dates': { body: { data: { dates: [SAT, SUN], bookedDates: [], times: { [SAT]: [SAT_1], [SUN]: [SUN_1] }, windowDays: 90 } } },
    availability: { body: { data: { slots: [SAT_1] } } },
    book: { body: { data: { bookingId: 'bk-1', hostToken: 'host-key', receiptUrl: 'https://squareup.com/receipt/9', totalCharged: 30000, emailSent: true } } },
  }
  fetchMock = vi.fn(async (url: string) => {
    const key = Object.keys(answers).find((k) => String(url).includes(`/${k}.json`))
    if (!key) throw new Error(`unexpected request: ${url}`)
    return respond(answers[key])
  })
  vi.stubGlobal('fetch', fetchMock)
  // A small stand-in: the test environment's own storage is not complete.
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, String(v)),
    removeItem: (k: string) => void kept.delete(k),
    clear: () => kept.clear(),
  })
})

afterEach(() => {
  paymentFormReady = true
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const requestsTo = (name: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(`/${name}.json`))
const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Continue|Book this craft)$/ }))

function open(props: Partial<Parameters<typeof PartyModal>[0]> = {}) {
  const onClose = vi.fn()
  render(<PartyModal onClose={onClose} {...props} />)
  return { onClose }
}

async function pickCraft(name = 'Bubble Letter Keychains') {
  const title = await screen.findByText(name)
  fireEvent.click(title.closest('button')!)
}

async function toWhen() {
  await pickCraft()
  next()
  await screen.findByRole('button', { name: 'Sat, Nov 7' })
}

async function toGuests(day = 'Sat, Nov 7', time = '1:30 PM') {
  await toWhen()
  fireEvent.click(screen.getByRole('button', { name: day }))
  fireEvent.click(await screen.findByRole('button', { name: time }))
  next()
  await screen.findByText('About how many guests?')
}

async function toPay(day?: string, time?: string) {
  await toGuests(day, time)
  next()
  await screen.findByTestId('payment-form')
}

function fillContact() {
  for (const [label, value] of [['First name', 'Ada'], ['Last name', 'Lovelace'], ['Email', 'ada@example.com'], ['Phone', '(256) 555-0123']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
}

async function pay(date = 'Nov 7') {
  fillContact()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(await screen.findByRole('button', { name: `Pay $300 and reserve ${date}` }))
}

describe('PartyModal — the craft step', () => {
  it('opens in the shared panel, named "Book a party"', async () => {
    open()
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Book a party')
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
  })

  it('shows every craft with its price per person, whole dollars without ".00"', async () => {
    open()
    expect(await screen.findByText('$20 a person')).toBeInTheDocument()
    expect(screen.getByText('$15 a person')).toBeInTheDocument()
    expect(screen.queryByText(/\.00/)).toBeNull()
  })

  it('says what is missing when Continue is tapped with no craft chosen', async () => {
    open()
    await screen.findByText('Bubble Letter Keychains')
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a craft to continue.')
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
  })

  it('has no Back button on the first step', async () => {
    open()
    await screen.findByText('Bubble Letter Keychains')
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
  })

  it('keeps a made-to-order craft from moving on until it is acknowledged', async () => {
    open()
    await pickCraft('Patch & Personalize')
    next()
    expect(screen.getByRole('alert')).toHaveTextContent(/made to order/)
    fireEvent.click(screen.getByRole('checkbox'))
    next()
    expect(await screen.findByText('Choose a date')).toBeInTheDocument()
  })

  describe('a craft that arrives from a craft card or a shared link', () => {
    it('still opens on the craft step, with that craft first, selected and fully described', async () => {
      open({ initialCraftId: 'c-bling' })
      const pressed = await screen.findByRole('button', { pressed: true })
      expect(pressed).toHaveTextContent('Bedazzle & Bling')
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Read less' })).toHaveAttribute('aria-expanded', 'true')
      // First in the list, ahead of the craft that is first in the catalogue order.
      const names = screen.getAllByRole('button', { pressed: undefined }).map((b) => b.textContent)
      expect(names.findIndex((n) => n?.includes('Bedazzle & Bling'))).toBeLessThan(names.findIndex((n) => n?.includes('Bubble Letter Keychains')))
    })

    it('offers "Book this craft", and lets the choice be changed', async () => {
      open({ initialCraftId: 'c-bling' })
      expect(await screen.findByRole('button', { name: 'Book this craft' })).toBeInTheDocument()
      await pickCraft('Bubble Letter Keychains')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    })

    it('closes without asking when nothing else has been chosen', async () => {
      const { onClose } = open({ initialCraftId: 'c-bling' })
      await screen.findByRole('button', { name: 'Book this craft' })
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
  })
})

describe('PartyModal — dates and times', () => {
  it('shows the times for a date at once, from what came with the dates', async () => {
    open()
    await toWhen()
    fireEvent.click(screen.getByRole('button', { name: 'Sat, Nov 7' }))
    expect(screen.getByRole('button', { name: '1:30 PM' })).toBeInTheDocument()
    expect(requestsTo('availability')).toHaveLength(0)
  })

  it('shows a fully booked date as "Booked", not as missing', async () => {
    // Saturday's one time (1:30 PM) is taken, so the whole date is booked.
    answers['available-dates'] = { body: { data: { dates: [SUN], bookedDates: [SAT], times: { [SUN]: [SUN_1] }, windowDays: 90 } } }
    open()
    await pickCraft()
    next()
    expect(await screen.findByRole('button', { name: 'Sat, Nov 7 · Booked' })).toBeDisabled()
  })

  it('counts only booked times: "1 of 2 times still open"', async () => {
    // Sunday offers 1:00 and 3:30; only 1:00 is left.
    open()
    await toWhen()
    fireEvent.click(screen.getByRole('button', { name: 'Sun, Nov 8' }))
    expect(screen.getByText('1 of 2 times still open')).toBeInTheDocument()
  })

  it('says nothing about scarcity when every time is open', async () => {
    // Sunday offers 1:00 and 3:30, and both are open.
    answers['available-dates'] = { body: { data: { dates: [SUN], bookedDates: [], times: { [SUN]: [SUN_1, SUN_3] } } } }
    open()
    await pickCraft()
    next()
    fireEvent.click(await screen.findByRole('button', { name: 'Sun, Nov 8' }))
    expect(screen.getByRole('button', { name: '1:00 PM' })).toBeInTheDocument()
    expect(screen.queryByText(/times still open/)).toBeNull()
  })

  it('says what is missing when Continue is tapped without a date or a time', async () => {
    open()
    await toWhen()
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a date to continue.')
    fireEvent.click(screen.getByRole('button', { name: 'Sun, Nov 8' }))
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a start time to continue.')
  })

  it('states the booking window', async () => {
    open()
    await toWhen()
    expect(screen.getByText('We open dates 90 days ahead.')).toBeInTheDocument()
  })

  describe('planning something later', () => {
    async function toLater() {
      await toWhen()
      fireEvent.click(screen.getByRole('button', { name: 'Planning something later?' }))
    }

    it('is its own view: the date picker is not on screen with it', async () => {
      open()
      await toLater()
      expect(screen.getByLabelText('Email address')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Dates' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Sat, Nov 7' })).toBeNull()
      expect(screen.queryByText('Choose a date')).toBeNull()
    })

    it('offers no Continue: there is nothing to continue to', async () => {
      open()
      await toLater()
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Back to open dates' })).toBeInTheDocument()
    })

    it('offers the months with dates past the booking window, starting with the one the window ends in', async () => {
      open()
      await toLater()
      const month = screen.getByLabelText('Month you have in mind') as HTMLSelectElement
      // The window ends 26 Dec 2026: the rest of December is still to come.
      expect(Array.from(month.options).map((o) => o.value).slice(0, 3)).toEqual(['2026-12', '2027-01', '2027-02'])
    })

    it('always names a month: there is no "not sure", because the month is what triggers the email', async () => {
      open()
      await toLater()
      const month = screen.getByLabelText('Month you have in mind') as HTMLSelectElement
      expect(month.value).toBe('2026-12')
      expect(Array.from(month.options).map((o) => o.value)).not.toContain('')
      expect(screen.queryByText('Not sure yet')).toBeNull()
    })

    it('goes back to the open dates, with a date chosen earlier still chosen', async () => {
      open()
      await toWhen()
      fireEvent.click(screen.getByRole('button', { name: 'Sat, Nov 7' }))
      fireEvent.click(screen.getByRole('button', { name: '1:30 PM' }))
      fireEvent.click(screen.getByRole('button', { name: 'Planning something later?' }))

      // While asking about a later date, no time is shown as chosen.
      expect(screen.queryByText('Sat, Nov 7 · 1:30 PM CT')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Back to open dates' }))
      expect(screen.getByRole('button', { name: '1:30 PM' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Sat, Nov 7 · 1:30 PM CT')).toBeInTheDocument()
      expect(screen.queryByLabelText('Email address')).toBeNull()
    })

    it('Back returns to the open dates, not to the craft step', async () => {
      open()
      await toLater()
      fireEvent.click(screen.getByRole('button', { name: /^←?\s*Back$/ }))
      expect(screen.getByRole('group', { name: 'Dates' })).toBeInTheDocument()
      expect(screen.getByText('Date and time')).toBeInTheDocument()
    })

    it('is not offered twice: when every date is booked, that sign-up is the only one', async () => {
      answers['available-dates'] = { body: { data: { dates: [], bookedDates: [SAT], times: {} } } }
      open()
      await pickCraft()
      next()
      await screen.findByText(/Every party date in the next 90 days is booked/)
      expect(screen.queryByRole('button', { name: 'Planning something later?' })).toBeNull()
      expect(screen.getAllByLabelText('Email address')).toHaveLength(1)
    })
  })

  it('offers an email sign-up when every date is booked', async () => {
    answers['available-dates'] = { body: { data: { dates: [], bookedDates: [SAT], times: {} } } }
    open()
    await pickCraft()
    next()
    expect(await screen.findByText(/Every party date in the next 90 days is booked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tell me when dates open' })).toBeInTheDocument()
  })

  it('says so plainly, with a way to try again, when the dates cannot be loaded', async () => {
    answers['available-dates'] = { status: 500, body: {} }
    open()
    await pickCraft()
    next()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t load this. Try again, or text us at (256) 464-1710.')
    answers['available-dates'] = { body: { data: { dates: [SAT], bookedDates: [], times: { [SAT]: [SAT_1] } } } }
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Sat, Nov 7' })).toBeInTheDocument()
  })

  it('skips the date step when a calendar link carried a time that is still open', async () => {
    open({ initialStart: SAT_1.startAt })
    await pickCraft()
    expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument()
    next()
    expect(await screen.findByText('About how many guests?')).toBeInTheDocument()
  })

  it('keeps the date step, and explains, when the linked time has gone', async () => {
    // The linked 1:00 PM Sunday time has gone; 3:30 PM is what is left.
    answers.availability = { body: { data: { slots: [SUN_3] } } }
    open({ initialStart: SUN_1.startAt })
    await pickCraft()
    next()
    expect(await screen.findByText('That time was just booked. Nothing was charged. These are still open.')).toBeInTheDocument()
  })
})

describe('PartyModal — the price', () => {
  it('splits it into pay today, pay at the studio, and one estimated total', async () => {
    open()
    await toGuests()
    const summary = screen.getByRole('region', { name: 'Price summary' })
    expect(summary).toHaveTextContent('Pay today')
    expect(summary).toHaveTextContent('Studio fee, holds Sat, Nov 7 at 1:30 PM$300')
    expect(summary).toHaveTextContent('Pay at the studio')
    expect(summary).toHaveTextContent('Bubble Letter Keychains, about 10 guests × $20about $200')
    expect(summary).toHaveTextContent('Only for guests who come. Minimum 10 crafts.')
    expect(summary).toHaveTextContent('Estimated party total' + 'about $500')
  })

  it('follows the guest count', async () => {
    open()
    await toGuests()
    fireEvent.click(screen.getByRole('button', { name: '15' }))
    expect(screen.getByRole('region', { name: 'Price summary' })).toHaveTextContent('about $600')
    fireEvent.click(screen.getByRole('button', { name: 'More guests' }))
    expect(screen.getByRole('region', { name: 'Price summary' })).toHaveTextContent('about 16 guests × $20about $320')
  })

  it('never goes below 10 or above 30 guests', async () => {
    open()
    await toGuests()
    expect(screen.getByRole('button', { name: 'Fewer guests' })).toBeDisabled()
    for (let i = 0; i < 25; i++) fireEvent.click(screen.getByRole('button', { name: 'More guests' }))
    expect(screen.getByRole('button', { name: 'More guests' })).toBeDisabled()
    expect(screen.getByText('30 guests is the most the studio holds.')).toBeInTheDocument()
  })

  it('shows the same summary on the payment step, names the date on the button, and states the refund terms', async () => {
    open()
    await toPay()
    expect(screen.getByRole('region', { name: 'Price summary' })).toHaveTextContent('Estimated party total' + 'about $500')
    expect(await screen.findByRole('button', { name: 'Pay $300 and reserve Nov 7' })).toBeInTheDocument()
    // 7 Nov is 41 days away on 27 Sep: cash refund until 14 days before, 24 Oct.
    expect(screen.getByText('Full refund until Oct 24. After that, studio credit.')).toBeInTheDocument()
  })

  it('tells someone booking inside 14 days that the fee is credit only, before they pay', async () => {
    vi.setSystemTime(new Date('2026-10-30T17:00:00.000Z'))
    open()
    await toPay()
    expect(screen.getByText(/This date is less than 14 days away, so the \$300 is refundable as studio credit, not cash/)).toBeInTheDocument()
  })
})

describe('PartyModal — paying', () => {
  it('never greys out Pay for missing details: it marks each one and goes to the first', async () => {
    open()
    await toPay()
    const button = await screen.findByRole('button', { name: 'Pay $300 and reserve Nov 7' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      CONTACT_MESSAGES.firstName,
      CONTACT_MESSAGES.lastName,
      CONTACT_MESSAGES.emailMissing,
      CONTACT_MESSAGES.phone,
      'Tick the box to agree to the booking and cancellation policy.',
    ])
    expect(screen.getByLabelText('First name')).toHaveFocus()
    expect(requestsTo('book')).toHaveLength(0)
  })

  it('needs a phone number for a party', async () => {
    open()
    await toPay()
    expect(screen.getByLabelText('Phone')).toBeRequired()
    expect(screen.queryByLabelText('Phone (optional)')).toBeNull()
  })

  it('waits for the card field, and says that is what it is doing', async () => {
    paymentFormReady = false
    open()
    await toPay()
    expect(screen.getByRole('button', { name: 'Loading payment form…' })).toBeDisabled()
  })

  it('sends what was chosen, under one attempt ID', async () => {
    open()
    await toPay()
    await pay()
    await waitFor(() => expect(requestsTo('book')).toHaveLength(1))
    const body = JSON.parse(requestsTo('book')[0][1].body)
    expect(body).toMatchObject({
      startTime: SAT_1.startAt,
      serviceVariationId: 'var-party',
      serviceVariationVersion: 7,
      people: 10,
      craft: { id: 'c-keys', name: 'Bubble Letter Keychains', perHeadCents: 2000 },
      customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' },
      paymentToken: 'cnon:test-token',
    })
    expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('shows the sentence the server chose for a declined card, and keeps what was typed', async () => {
    answers.book = { status: 402, body: { code: 'card_declined', detail: 'Your card was declined, so we released the date. Nothing was charged. Try another card.' } }
    open()
    await toPay()
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined, so we released the date.')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
  })

  it('starts a new attempt after a declined card, and keeps the attempt while the outcome is unknown', async () => {
    answers.book = { status: 402, body: { code: 'card_declined', detail: 'declined' } }
    open()
    await toPay()
    await pay()
    await screen.findByRole('alert')
    answers.book = () => {
      throw new TypeError('Failed to fetch')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Pay $300 and reserve Nov 7' }))
    await waitFor(() => expect(requestsTo('book')).toHaveLength(2))
    expect(await screen.findByRole('alert')).toHaveTextContent('We’re not sure that went through.')
    fireEvent.click(screen.getByRole('button', { name: 'Pay $300 and reserve Nov 7' }))
    await waitFor(() => expect(requestsTo('book')).toHaveLength(3))

    const ids = requestsTo('book').map(([, init]) => JSON.parse(init.body).attemptId)
    expect(ids[1]).not.toBe(ids[0]) // declined: that attempt is over
    expect(ids[2]).toBe(ids[1]) // unknown: same attempt, so the server can recognise it
  })

  it('never shows a technical message', async () => {
    answers.book = { status: 504, body: null }
    open()
    await toPay()
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We’re not sure that went through.')
    expect(alert).not.toHaveTextContent(/not charged|504|fetch|JSON/i)
  })

  it('takes them back to pick another time when theirs was just taken, with their details kept', async () => {
    answers.book = { status: 409, body: { code: 'slot_taken', detail: 'That time was just booked by someone else.' } }
    answers.availability = { body: { data: { slots: [SUN_3] } } }
    open()
    await toPay('Sun, Nov 8', '1:00 PM')
    await pay('Nov 8')

    expect(await screen.findByText('That time was just booked. Nothing was charged. These are still open.')).toBeInTheDocument()
    expect(screen.getByText('Date and time')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1:00 PM' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '3:30 PM' }))
    next()
    await screen.findByText('About how many guests?')
    next()
    await screen.findByTestId('payment-form')
    expect(screen.getByLabelText('First name')).toHaveValue('Ada')
    expect(screen.getByLabelText('Phone')).toHaveValue('(256) 555-0123')
  })

  it('brings the date step back when a calendar link had removed it', async () => {
    answers.book = { status: 409, body: { code: 'slot_taken', detail: 'taken' } }
    answers.availability = { body: { data: { slots: [SUN_1, SUN_3] } } }
    open({ initialStart: SUN_1.startAt })
    await pickCraft()
    await screen.findByText('Step 1 of 3')
    next()
    await screen.findByText('About how many guests?')
    next()
    await screen.findByTestId('payment-form')
    answers.availability = { body: { data: { slots: [SUN_3] } } }
    await pay('Nov 8')
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('Date and time')).toBeInTheDocument()
  })
})

describe('PartyModal — confirmation', () => {
  async function bookedScreen() {
    const result = open()
    await toPay()
    await pay()
    await screen.findByText('You’re booked')
    return result
  }

  it('says what was booked and what was paid', async () => {
    await bookedScreen()
    expect(screen.getByText(/party, \$300 studio fee paid/)).toHaveTextContent('Bubble Letter Keychains party, $300 studio fee paid.')
    expect(screen.getByText(/on its way/)).toHaveTextContent('ada@example.com')
  })

  it('tells the host what they need to turn up', async () => {
    await bookedScreen()
    expect(screen.getByText('Sat, Nov 7 · 1:30–3 PM')).toBeInTheDocument()
    expect(screen.getByText('Arrive up to 30 minutes early to set up.')).toBeInTheDocument()
    expect(screen.getByText(/525 Hughes Rd, Suite F, Madison, AL 35758/)).toBeInTheDocument()
    expect(screen.getByText(/About a week before, we’ll text you to check your headcount/)).toHaveTextContent('you pay for who comes, minimum 10.')
    expect(screen.getByText('Full refund until Oct 24. After that, studio credit.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '(256) 464-1710' })).toHaveAttribute('href', 'sms:2564641710')
  })

  it('links the party page, the agreement and the receipt', async () => {
    await bookedScreen()
    expect(screen.getByRole('link', { name: 'Open your party page' })).toHaveAttribute('href', expect.stringMatching(/\/party\/bk-1\?key=host-key$/))
    expect(screen.getByRole('link', { name: 'Sign your participation agreement' })).toHaveAttribute('href', expect.stringContaining('bk-1'))
    expect(screen.getByRole('link', { name: 'View your receipt' })).toHaveAttribute('href', 'https://squareup.com/receipt/9')
  })

  it('never puts the host’s private link in the calendar entry', async () => {
    await bookedScreen()
    const google = decodeURIComponent(screen.getByRole('link', { name: 'Add to Google Calendar' }).getAttribute('href')!)
    expect(google).not.toContain('host-key')
    expect(google).toContain('20261107T193000Z/20261107T210000Z')
  })

  it('says the party page is being set up, never links to /book, when it could not be saved', async () => {
    answers.book = { body: { data: { bookingId: 'bk-1', hostToken: null, receiptUrl: null, totalCharged: 30000, emailSent: false } } }
    await bookedScreen()
    expect(screen.getByText(/Your party page is being set up\./)).toHaveTextContent('Text us at (256) 464-1710 and we’ll send you the link.')
    expect(screen.queryByRole('link', { name: 'Open your party page' })).toBeNull()
    expect(screen.getByText(/couldn’t send your confirmation email/)).toBeInTheDocument()
  })

  it('remembers the booking and tells the banner at once', async () => {
    const heard = vi.fn()
    window.addEventListener('hometown:recent-party', heard)
    await bookedScreen()
    expect(heard).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('hg:recent-party')!)).toMatchObject({ bookingId: 'bk-1', craftName: 'Bubble Letter Keychains' })
    window.removeEventListener('hometown:recent-party', heard)
  })

  it('carries the party name into the invitation', async () => {
    await bookedScreen()
    fireEvent.change(screen.getByLabelText('Party name for the invitation (optional)'), { target: { value: 'Team night' } })
    expect(JSON.parse(localStorage.getItem('hg:recent-party')!).title).toBe('Team night')
  })

  it('closes without asking once booked', async () => {
    const { onClose } = await bookedScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PartyModal — leaving', () => {
  it('closes without asking when only a craft has been picked', async () => {
    const { onClose } = open()
    await pickCraft()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks first once a date has been chosen', async () => {
    const { onClose } = open()
    await toWhen()
    fireEvent.click(screen.getByRole('button', { name: 'Sat, Nov 7' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    const prompt = screen.getByRole('alertdialog')
    expect(prompt).toHaveAccessibleName('Leave without booking?')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep booking' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not count a date that arrived in a link as progress', async () => {
    const { onClose } = open({ initialDate: SAT })
    await pickCraft()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PartyModal — when the panel cannot load', () => {
  it('says so plainly and offers to try again', async () => {
    answers['service-info'] = { status: 500, body: {} }
    open()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t load this. Try again, or text us at (256) 464-1710.')
    answers['service-info'] = { body: { data: serviceInfo } }
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Bubble Letter Keychains')).toBeInTheDocument()
  })
})
