import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ClassBookingPanel from '@components/classes/ClassBookingPanel'
import { toPublicClass } from '@lib/classes/public-view'
import { defaultRules } from '@lib/classes/validate'
import { quote as quoteOf } from '@lib/classes/pricing'
import type { Ledger, LedgerLine } from '@lib/classes/seat-ledger'
import type { ClassContent, ScheduledClass } from '@lib/classes/types'
import { _forgetContact } from '@lib/remembered-contact'

let paymentFormProps: Record<string, any> = {}
let tokenCalls = 0
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: { onReadyChange?: (ready: boolean) => void }, ref: any) => {
      paymentFormProps = props
      useImperativeHandle(ref, () => ({
        tokenize: async () => ({ token: `cnon:test-token-${++tokenCalls}`, kind: 'card' }),
        tokenizeAndVerify: async () => ({ token: 'cnon:test-token' }),
      }))
      useEffect(() => {
        props.onReadyChange?.(true)
      }, [])
      return <div data-testid="payment-form" />
    }),
  }
})

const NOW = new Date('2026-10-20T12:00:00Z')
const sess = (id: string, day: number, capacity = 8) => ({ id, startIso: `2026-10-${day}T18:00:00Z`, endIso: `2026-10-${day}T20:00:00Z`, capacity })

function make(over: Partial<ClassContent> = {}, sessions = [sess('ses_a', 24), sess('ses_b', 25), sess('ses_c', 26)]): ScheduledClass {
  const content: ClassContent = {
    name: 'Clay Camp', description: 'Make a pot.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [
      { id: 'all', label: 'Full series', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
    ],
    prices: { all: { person: 4000 }, day: { person: 1500 } },
    questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120, ...over,
  }
  return {
    id: 'cls_1', libraryId: null, libraryVersion: null, content, sessions, status: 'open',
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
  }
}
const taken = (n: number, sessionIds: string[]): LedgerLine[] => Array.from({ length: n }, () => ({
  id: 'led_x', bookingId: 'bkg_x', sessionIds, ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 0, taxCents: 0,
  addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null, customer: null,
  square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: '',
}) as LedgerLine)

function open(cls: ScheduledClass = make(), lines: LedgerLine[] = []) {
  const ledger: Ledger = { classId: cls.id, lines }
  const workshop = toPublicClass(cls, ledger, NOW)
  const onClose = vi.fn()
  const onBooked = vi.fn()
  render(<ClassBookingPanel workshop={workshop} onClose={onClose} onBooked={onBooked} syncUrl={false} />)
  return { onClose, onBooked, workshop }
}

const pressed = (name: RegExp | string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
const more = (label = 'seats') => fireEvent.click(screen.getByRole('button', { name: `More ${label}` }))
const cont = () => fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))

function fillContact() {
  const all = { 'First name': 'Alice', 'Last name': 'Smith', Email: 'alice@test.com', Phone: '(256) 555-0123' }
  for (const [label, value] of Object.entries(all)) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('checkbox'))
}

function serverSays(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
const bookedReply = (over: Record<string, unknown> = {}) =>
  serverSays(200, { data: { bookingId: 'bkg_1', receiptUrl: null, emailSent: true, totalChargedCents: 8720, seatsBooked: 2, ticketsLabel: '2 seats', sessionIds: ['ses_a', 'ses_b', 'ses_c'], ...over } })

beforeEach(() => {
  tokenCalls = 0
  paymentFormProps = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => {
  _forgetContact()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ClassBookingPanel — passes and days', () => {
  it('switching pass clears the days picked', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /One day/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sat, Oct 24/ }))
    expect(pressed(/Sat, Oct 24/)).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Full series/ }))
    fireEvent.click(screen.getByRole('button', { name: /One day/ }))
    expect(pressed(/Sat, Oct 24/)).toBe('false')
  })

  it('a pick-N pass needs exactly N days', () => {
    const cls = make({ passes: [{ id: 'two', label: 'Two days', covers: { kind: 'choose', count: 2 } }], prices: { two: { person: 2500 } } })
    open(cls)
    // One pass: no pass picker, straight to the days.
    expect(screen.queryByRole('button', { name: /Two days/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sat, Oct 24/ }))
    cont()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick 2 days.')
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sun, Oct 25/ }))
    cont()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
  })

  it('a pass whose session is full is shown sold out and can’t be picked', () => {
    open(make(), taken(8, ['ses_b']))
    expect(screen.getByRole('button', { name: /Full series/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Full series/ })).toHaveTextContent('Sold out')
    // The open pass is chosen to start with.
    expect(pressed(/One day/)).toBe('true')
    expect(screen.getByRole('button', { name: /Sun, Oct 25/ })).toBeDisabled()
  })
})

describe('ClassBookingPanel — small rules', () => {
  it('the first step shows the seats’ price before tax, once, on Continue; tax only on the payment step (Kaden, 1 Nov 2026)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const cls = make({ passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }], prices: { all: { person: 4000 } } })
      const ledger: Ledger = { classId: cls.id, lines: [] }
      render(<ClassBookingPanel workshop={{ ...toPublicClass(cls, ledger, NOW), own: { ...toPublicClass(cls, ledger, NOW).own!, taxPercent: 10 } } as any} onClose={vi.fn()} syncUrl={false} />)
      const button = screen.getByRole('button', { name: /^Continue/ })
      expect(button).toHaveTextContent(/^Continue · \$40(\.00)?$/)
      expect(document.body.textContent).not.toMatch(/incl\. tax/)
      expect(screen.getAllByText(/\$40(\.00)?$/).length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('a tap past N days says how to change, and keeps the picks', () => {
    open(make({ passes: [{ id: 'two', label: 'Two days', covers: { kind: 'choose', count: 2 } }], prices: { two: { person: 2500 } } }))
    fireEvent.click(screen.getByRole('button', { name: /Sat, Oct 24/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sun, Oct 25/ }))
    fireEvent.click(screen.getByRole('button', { name: /Mon, Oct 26/ }))
    expect(screen.getByText('You’ve picked 2 days. Tap one to change it.')).toHaveAttribute('aria-live', 'polite')
    expect(pressed(/Mon, Oct 26/)).toBe('false')
    expect(pressed(/Sat, Oct 24/)).toBe('true')
  })
})

describe('ClassBookingPanel — counters', () => {
  it('stop at the seats left on every session the pass needs', () => {
    open(make(), taken(6, ['ses_c']))
    more()
    more()
    expect(screen.getByRole('button', { name: 'More seats' })).toBeDisabled()
    expect(screen.getByText('2 seats left')).toBeInTheDocument()
    expect(screen.getByText('That’s every seat left.')).toBeInTheDocument()
  })

  it('stop at the most one booking can hold', () => {
    open(make({ rules: { ...defaultRules(), maxPerBooking: 3 } }))
    for (let i = 0; i < 5; i++) more()
    expect(screen.getByRole('button', { name: 'More seats' })).toBeDisabled()
    expect(screen.getByText('One booking holds up to 3 seats.')).toBeInTheDocument()
  })

  it('each ticket type has its own counter, from zero, and at least one person is needed', () => {
    open(make({
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
      prices: { all: { adult: 2000, kid: 1500 } },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Fewer adults' }))
    expect(screen.getByRole('button', { name: 'Fewer kids' })).toBeDisabled()
    cont()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one person.')
  })
})

describe('ClassBookingPanel — paying', () => {
  it('the Pay button carries the quoted total, tax per seat; the summary has no total line', async () => {
    open()
    more()
    cont()
    await screen.findByTestId('payment-form')
    // 2 × $40 + 9% per seat ($3.60 each) = $87.20
    expect(screen.getByRole('button', { name: 'Pay $87.20' })).toBeInTheDocument()
    expect(screen.getByText('Tax')).toBeInTheDocument()
    expect(screen.getByText('$7.20')).toBeInTheDocument()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('uses the merchant app id, offers wallets for any seat count, and allows gift cards', async () => {
    open()
    more()
    more()
    cont()
    await screen.findByTestId('payment-form')
    expect(paymentFormProps.applicationIdOverride).toBeUndefined()
    expect(paymentFormProps.environmentOverride).toBeUndefined()
    expect(paymentFormProps.giftCards).not.toBe('cards-only')
    expect(paymentFormProps.wallet).toMatchObject({ amount: '130.80' })
  })

  it('sends one token and the booking, and shows what the server charged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bookedReply({ totalChargedCents: 8800 }))
    vi.stubGlobal('fetch', fetchMock)
    const { onBooked } = open()
    more()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $87.20' }))
    await screen.findByText('You’re booked')
    expect(tokenCalls).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/classes/book.json')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      classId: 'cls_1', passId: 'all', sessionIds: [], tickets: { person: 2 },
      paymentToken: 'cnon:test-token-1',
      customer: { givenName: 'Alice', familyName: 'Smith', email: 'alice@test.com', phone: '(256) 555-0123' },
    })
    expect(body.seats).toHaveLength(2)
    expect(typeof body.attemptId).toBe('string')
    expect(screen.getByText(/\$88 paid/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onBooked).toHaveBeenCalledWith(['ses_a', 'ses_b', 'ses_c'], 2)
  })

  it('sends the days picked on a pick-a-day pass', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bookedReply({ sessionIds: ['ses_b'] }))
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByRole('button', { name: /One day/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sun, Oct 25/ }))
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $16.35' }))
    await screen.findByText('You’re booked')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ passId: 'day', sessionIds: ['ses_b'] })
  })

  it.each([
    ['unknown_outcome', 502, 'We’re not sure that went through. Check your email before trying again.'],
    ['in_progress', 409, 'We’re still finishing your last try. Give it a minute, then check your email before trying again.'],
  ])('after %s it says the server’s words and offers Check again and Close, no paying again', async (code, status, detail) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(serverSays(status as number, { code, detail })))
    const { onClose } = open()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(detail as string)
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /More seats/ })).toBeNull()
    const closes = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closes[closes.length - 1])
    expect(onClose).toHaveBeenCalled()
  })

  it('a dropped connection is treated the same way', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('network')))
    open()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We’re not sure that went through')
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it('a decline starts a new attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(402, { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' }))
      .mockResolvedValueOnce(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    open()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText(/Your card was declined/)
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText('You’re booked')
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).attemptId)
    expect(ids[1]).not.toBe(ids[0])
  })

  it('a sold-out answer says so, starts a new attempt and asks for fresh seat counts', async () => {
    const soldOut = serverSays(409, { code: 'sold_out', detail: 'That class is full on Sat, Oct 24. Nothing was charged.' })
    const fetchMock = vi.fn(async (url: string) => (url === '/api/classes/cls_1.json' ? serverSays(404, {}) : soldOut))
    vi.stubGlobal('fetch', fetchMock)
    open()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText('That class is full on Sat, Oct 24. Nothing was charged.')
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/classes/cls_1.json')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    const books = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/classes/book.json')
    await waitFor(() => expect(books()).toHaveLength(2))
    const ids = books().map((c) => JSON.parse((c as any)[1].body).attemptId)
    expect(ids[1]).not.toBe(ids[0])
  })

  it('after sold out, fresh counts lower the counter cap and a full day can’t be picked', async () => {
    const cls = make()
    const fresh = toPublicClass(cls, { classId: 'cls_1', lines: [...taken(6, ['ses_a']), ...taken(8, ['ses_b'])] }, NOW).own!
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/classes/cls_1.json'
        ? serverSays(200, { workshop: { own: fresh } })
        : serverSays(409, { code: 'sold_out', detail: 'Only 2 seats are left on Sat, Oct 24. Nothing was charged.' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    // The parent swaps the fresh counts in, as the list and the class page do.
    function Host() {
      const [w, setW] = useState(() => toPublicClass(cls, { classId: 'cls_1', lines: [] }, NOW))
      return <ClassBookingPanel workshop={w} onClose={() => {}} syncUrl={false} onAvailability={(own) => setW((x) => ({ ...x, own }))} />
    }
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /One day/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sat, Oct 24/ }))
    more(); more(); more()
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: /^Pay/ }))
    await screen.findByText(/Only 2 seats are left/)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Pay/ })).toHaveTextContent('Pay $32.70'))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('button', { name: 'More seats' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Sun, Oct 25/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Sun, Oct 25/ })).toHaveTextContent('Sold out')
  })
})

describe('ClassBookingPanel — each person’s picks and extras', () => {
  const withPicks = () => make({
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 2000 } },
    questions: [{ id: 'q_color', label: 'Glaze color', choices: ['Blue', 'Green'] }],
    addOns: [{ id: 'add_glitter', label: 'Glitter', priceCents: 300, maxPerSeat: 2 }],
  })

  it('answers stay with their person when another ticket type is added', () => {
    open(make({
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
      prices: { all: { adult: 2000, kid: 1500 } },
      questions: [{ id: 'q_color', label: 'Glaze color', choices: ['Blue', 'Green'] }],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'More kids' }))
    cont()
    let selects = screen.getAllByLabelText('Glaze color')
    fireEvent.change(selects[0], { target: { value: 'Blue' } }) // Adult 1
    fireEvent.change(selects[1], { target: { value: 'Green' } }) // Kid 1
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    fireEvent.click(screen.getByRole('button', { name: 'More adults' }))
    cont()
    selects = screen.getAllByLabelText('Glaze color')
    // Adult 1, Adult 2, Kid 1: the kid keeps Green, the new adult starts empty.
    expect(selects.map((s) => (s as HTMLSelectElement).value)).toEqual(['Blue', '', 'Green'])
  })

  it('asks every person, then prices the extras into the total', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    open(withPicks())
    more()
    cont()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    cont()
    expect(screen.getByRole('alert')).toHaveTextContent('Seat 1 needs a glaze color.')
    const selects = screen.getAllByLabelText('Glaze color')
    fireEvent.change(selects[0], { target: { value: 'Blue' } })
    fireEvent.change(selects[1], { target: { value: 'Green' } })
    fireEvent.click(screen.getByRole('button', { name: 'More glitter for person 2' }))
    cont()
    await screen.findByTestId('payment-form')
    // $20 + $20 + $3, each taxed 9%: 21.80 + 21.80 + 3.27 = $46.87
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $46.87' }))
    await screen.findByText('You’re booked')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).seats).toEqual([
      { answers: { q_color: 'Blue' }, addOns: {} },
      { answers: { q_color: 'Green' }, addOns: { add_glitter: 1 } },
    ])
  })
})

describe('ClassBookingPanel — Pay on the iPad (door mode)', () => {
  it('books through the door route, never remembers the customer on the shared iPad, and prices a running session', async () => {
    const { rememberContact, rememberedContact } = await import('@lib/remembered-contact')
    rememberContact({ firstName: 'Last', lastName: 'Customer', email: 'last@x.com', phone: '(256) 555-0000' })
    // ses_a is running (6–8 PM UTC on the 24th)
    vi.setSystemTime(new Date('2026-10-24T18:30:00Z'))
    const cls = make()
    const workshop = toPublicClass(cls, { classId: cls.id, lines: [] }, new Date(), { door: true })
    const fetchMock = vi.fn().mockResolvedValue(bookedReply({ totalChargedCents: 1635, sessionIds: ['ses_a'] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} door syncUrl={false} />)
    fireEvent.click(screen.getByRole('button', { name: /One day/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sat, Oct 24/ }))
    cont()
    await screen.findByTestId('payment-form')
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $16.35' }))
    await screen.findByText('You’re booked')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/classes/book.json?door=1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ passId: 'day', sessionIds: ['ses_a'] })
    expect(rememberedContact()?.email).toBe('last@x.com')
  })
})

describe('ClassBookingPanel — door mode on a full day', () => {
  it('pre-selects the roster’s day; a full day needs Add over capacity, then pays with overCapacity; Back leaves for the pay choice', async () => {
    vi.setSystemTime(new Date('2026-10-24T18:30:00Z'))
    const cls = make({}, [sess('ses_a', 24, 1), sess('ses_b', 25)])
    const workshop = toPublicClass(cls, { classId: cls.id, lines: taken(1, ['ses_a']) }, new Date(), { door: true })
    const fetchMock = vi.fn().mockResolvedValue(bookedReply({ totalChargedCents: 1635, sessionIds: ['ses_a'] }))
    vi.stubGlobal('fetch', fetchMock)
    const exit = vi.fn()
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} door initialSessionId="ses_a" onExit={exit} syncUrl={false} />)
    // the full series is full too, but at the door it can still be picked; the one-day option starts with the roster's day
    expect(pressed(/One day/)).toBe('true')
    expect(pressed(/Sat, Oct 24/)).toBe('true')
    expect(screen.getByRole('button', { name: /Sat, Oct 24/ })).toHaveTextContent('Full')
    // N6: the full line shows as soon as the full day is picked, before Continue
    expect(screen.getByTestId('door-full')).toHaveTextContent('That day is full.')
    cont()
    expect(await screen.findByRole('alert')).toHaveTextContent('That day is full. Tick Add over capacity to seat them anyway.')
    fireEvent.click(screen.getByLabelText('Add over capacity'))
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    await screen.findByText('You’re booked')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ sessionIds: ['ses_a'], overCapacity: true })
  })

  it('the roster’s day starts picked, and Back on the first step returns to the pay choice', () => {
    vi.setSystemTime(new Date('2026-10-24T18:30:00Z'))
    const cls = make({ passes: [{ id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }], prices: { day: { person: 1500 } } })
    const workshop = toPublicClass(cls, { classId: cls.id, lines: [] }, new Date(), { door: true })
    const exit = vi.fn()
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} door initialSessionId="ses_b" onExit={exit} syncUrl={false} />)
    expect(pressed(/Sun, Oct 25/)).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(exit).toHaveBeenCalled()
  })

  it('N5: the over-capacity tick clears when the day changes', () => {
    vi.setSystemTime(new Date('2026-10-24T18:30:00Z'))
    const cls = make({ passes: [{ id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }], prices: { day: { person: 1500 } } }, [sess('ses_a', 24, 1), sess('ses_b', 25, 1)])
    const workshop = toPublicClass(cls, { classId: cls.id, lines: [...taken(1, ['ses_a']), ...taken(1, ['ses_b'])] }, new Date(), { door: true })
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} door initialSessionId="ses_a" syncUrl={false} />)
    fireEvent.click(screen.getByLabelText('Add over capacity'))
    expect((screen.getByLabelText('Add over capacity') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Sun, Oct 25/ }))
    expect((screen.getByLabelText('Add over capacity') as HTMLInputElement).checked).toBe(false)
  })

  it('m6: "That day is full." only once a day is picked', () => {
    vi.setSystemTime(new Date('2026-10-24T18:30:00Z'))
    const cls = make({ passes: [{ id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }], prices: { day: { person: 1500 } } }, [sess('ses_a', 24, 1), sess('ses_b', 25, 1)])
    const workshop = toPublicClass(cls, { classId: cls.id, lines: [...taken(1, ['ses_a']), ...taken(1, ['ses_b'])] }, new Date(), { door: true })
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} door syncUrl={false} />)
    expect(screen.queryByTestId('door-full')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sun, Oct 25/ }))
    expect(screen.getByTestId('door-full')).toBeInTheDocument()
  })
})

describe('ClassBookingPanel — stage 4: early-bird, codes, free, the price changed', () => {
  const promo = (over: Record<string, any> = {}): any => ({
    code: 'FALLFRIENDS', label: '', off: { kind: 'percent', percent: 25 }, per: 'booking', appliesTo: { kind: 'all' }, includeExtras: false,
    endsYmd: null, maxUses: null, active: true, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [], ...over,
  })
  const onePass = { passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' as const } }], prices: { all: { person: 4000 } } }
  const codeReply = (cls: ScheduledClass, p: any, people = 1) => {
    const r = quoteOf(cls, { passId: 'all', tickets: { person: people } }, NOW, 9, { promo: p })
    if (!r.ok) throw new Error(r.error)
    return serverSays(200, { data: { code: p.code, quote: r.value } })
  }
  async function toPay(cls: ScheduledClass) {
    open(cls)
    cont()
    await screen.findByText('Have a code?')
    fillContact()
  }
  async function applyCode(text: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  }

  it('early-bird: the regular price struck through on step 1, the early-bird on Continue (before tax), a line for it on the pay step', async () => {
    const cls = make({ ...onePass, earlyBird: { untilYmd: '2026-10-22', prices: { all: { person: 3000 } } } })
    open(cls)
    expect(screen.getByText('$40', { selector: 's' })).toBeInTheDocument()
    expect(screen.getByText(/\$30 each, early-bird through Thu Oct 22/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Continue/ })).toHaveTextContent(/Continue · \$30(\.00)?$/)
    cont()
    await screen.findByTestId('payment-form')
    const rows = screen.getAllByTestId('discount-row')
    expect(rows.map((r) => r.textContent)).toEqual(['Early-bird−$10'])
    expect(screen.getByText(/1 seat × \$40/)).toBeInTheDocument()
    // $30 + 9% = $32.70: the same on the button and the wallet sheet.
    expect(screen.getByRole('button', { name: 'Pay $32.70' })).toBeInTheDocument()
    expect(paymentFormProps.wallet).toMatchObject({ amount: '32.70' })
  })

  it('a code: Apply asks the server, the summary shows the code, the Pay button and the booking carry its total', async () => {
    const cls = make(onePass)
    const fetchMock = vi.fn(async (url: string) => (url === '/api/classes/promo.json' ? codeReply(cls, promo()) : bookedReply({ totalChargedCents: 3270 })))
    vi.stubGlobal('fetch', fetchMock)
    await toPay(cls)
    await applyCode('fall-friends')
    await screen.findByTestId('discount-row')
    // VoiceOver hears what changed, and focus lands on the Pay button (final review I17).
    expect(screen.getByText('Code FALLFRIENDS applied. New total $32.70.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pay $32.70' })))
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toMatchObject({ classId: 'cls_1', code: 'fall-friends', request: { passId: 'all', tickets: { person: 1 } } })
    expect(screen.getAllByTestId('discount-row').map((r) => r.textContent)).toEqual(['Code FALLFRIENDS Remove−$10'])
    fireEvent.click(screen.getByRole('button', { name: 'Pay $32.70' }))
    await screen.findByText('You’re booked')
    const book = fetchMock.mock.calls.find((c) => c[0] === '/api/classes/book.json') as any
    expect(JSON.parse(book[1].body)).toMatchObject({ promoCode: 'FALLFRIENDS', expectedTotalCents: 3270 })
  })

  it('Remove takes the code off and the total goes back', async () => {
    const cls = make(onePass)
    vi.stubGlobal('fetch', vi.fn(async () => codeReply(cls, promo())))
    await toPay(cls)
    await applyCode('FALLFRIENDS')
    await screen.findByRole('button', { name: 'Pay $32.70' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Code FALLFRIENDS' }))
    expect(screen.getByRole('button', { name: 'Pay $43.60' })).toBeInTheDocument()
    expect(screen.queryByTestId('discount-row')).toBeNull()
    expect(screen.getByText('Code removed. New total $43.60.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Have a code?' })))
  })

  it('a code that doesn\'t work says so kindly and changes nothing; Enter in the field never pays', async () => {
    const cls = make(onePass)
    const fetchMock = vi.fn(async () => serverSays(409, { detail: 'That code has ended.' }))
    vi.stubGlobal('fetch', fetchMock)
    await toPay(cls)
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }))
    const field = screen.getByLabelText('Code')
    expect(field).toHaveAttribute('autocapitalize', 'characters')
    expect(field).toHaveAttribute('autocorrect', 'off')
    fireEvent.change(field, { target: { value: 'oldcode' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await screen.findByText('That code has ended.')
    expect((fetchMock.mock.calls as any[]).every((c) => c[0] === '/api/classes/promo.json')).toBe(true)
    expect(tokenCalls).toBe(0)
    expect(screen.getByRole('button', { name: 'Pay $43.60' })).toBeInTheDocument()
  })

  it('free with a code: no card form, "Free with your code", Book it sends no card and the $0', async () => {
    const cls = make(onePass)
    const fetchMock = vi.fn(async (url: string) => (url === '/api/classes/promo.json'
      ? codeReply(cls, promo({ off: { kind: 'percent', percent: 100 } }))
      : bookedReply({ totalChargedCents: 0, ticketsLabel: '1 seat' })))
    vi.stubGlobal('fetch', fetchMock)
    await toPay(cls)
    await applyCode('FREEDAY')
    await screen.findByText('Free with your code')
    expect(screen.queryByTestId('payment-form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }))
    await screen.findByText('You’re booked')
    expect(tokenCalls).toBe(0)
    const book = fetchMock.mock.calls.find((c) => c[0] === '/api/classes/book.json') as any
    expect(JSON.parse(book[1].body)).toMatchObject({ paymentToken: '', expectedTotalCents: 0, promoCode: 'FALLFRIENDS' })
    expect(document.body.textContent).toContain('1 seat for Clay Camp, free.')
  })

  it('the price changed (early-bird ended at midnight): the new total and why, nothing charged; the next tap pays it', async () => {
    const cls = make({ ...onePass, earlyBird: { untilYmd: '2026-10-22', prices: { all: { person: 3000 } } } })
    const regular = quoteOf(make(onePass), { passId: 'all', tickets: { person: 1 } }, NOW, 9)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(409, { code: 'price_changed', detail: 'The price changed to $43.60 because the early-bird ended. Nothing was charged.', quote: (regular as any).value }))
      .mockResolvedValueOnce(bookedReply({ totalChargedCents: 4360 }))
    vi.stubGlobal('fetch', fetchMock)
    await toPay(cls)
    fireEvent.click(screen.getByRole('button', { name: 'Pay $32.70' }))
    await screen.findByText('The price changed to $43.60 because the early-bird ended. Nothing was charged.')
    expect(screen.queryByTestId('discount-row')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText('You’re booked')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expectedTotalCents).toBe(3270)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expectedTotalCents).toBe(4360)
  })

  it('M7: the early-bird ends at midnight while they sit on the pay step: the next tap shows the new total and says why', async () => {
    const cls = make({ ...onePass, earlyBird: { untilYmd: '2026-10-20', prices: { all: { person: 3000 } } } })
    await toPay(cls)
    expect(screen.getByRole('button', { name: 'Pay $32.70' })).toBeInTheDocument()
    expect(screen.queryByTestId('early-bird-ended')).toBeNull()
    vi.setSystemTime(new Date('2026-10-21T05:00:30Z')) // just after midnight Chicago
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alicia' } })
    expect(screen.getByTestId('early-bird-ended')).toHaveTextContent('The early-bird ended at midnight, so the price is now $43.60.')
    expect(screen.getByRole('button', { name: 'Pay $43.60' })).toBeInTheDocument()
  })

  it('a code that stopped working between Apply and Pay comes off with the server\'s sentence; nothing charged', async () => {
    const cls = make(onePass)
    const fetchMock = vi.fn(async (url: string) => (url === '/api/classes/promo.json'
      ? codeReply(cls, promo())
      : serverSays(409, { code: 'promo', detail: 'That code has been used up. Nothing was charged.' })))
    vi.stubGlobal('fetch', fetchMock)
    await toPay(cls)
    await applyCode('FALLFRIENDS')
    await screen.findByRole('button', { name: 'Pay $32.70' })
    fireEvent.click(screen.getByRole('button', { name: 'Pay $32.70' }))
    await screen.findByText('That code has been used up. Nothing was charged.')
    expect(screen.getByRole('button', { name: 'Pay $43.60' })).toBeInTheDocument()
  })
})

describe('ClassBookingPanel — stage 4 waitlist', () => {
  // One date, full (capacity 2, 2 taken), waitlist open.
  const one = () => make({ passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }], prices: { all: { person: 2000 } } }, [sess('ses_a', 24, 2)])
  function openFull(n = 2) {
    const cls = one()
    const workshop = toPublicClass(cls, { classId: cls.id, lines: taken(n, ['ses_a']) }, NOW, {}, {
      classId: cls.id, entries: [{ state: 'waiting', sessionIds: ['ses_a'] } as any],
    })
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} syncUrl={false} />)
    return workshop
  }

  it('a full class offers the waitlist: store mode card form (no wallets), consent tick, "Join the waitlist"', async () => {
    const w = openFull()
    expect(w.own!.sessions[0].waitlist).toMatchObject({ open: true, waiting: 1 })
    expect(screen.getByTestId('waitlist-note')).toHaveTextContent('This class is full. Join the waitlist')
    cont()
    expect(screen.getByTestId('waitlist-step')).toBeInTheDocument()
    expect(paymentFormProps.mode).toBe('store')
    expect(paymentFormProps.wallet).toBeUndefined()
    // I2: the class and its date are named; the amount and close time are the ones sent with the join.
    expect(screen.getByTestId('waitlist-consent')).toHaveTextContent('Save my card with Square. If a spot opens in Clay Camp (Sat, Oct 24 at 1 PM) before the waitlist closes on Sat, Oct 24 at 11 AM, Hometown Studio adds me and charges this card. It’s never more than $21.80, even if the price goes up later, and they won’t ask again first. I’ll get a text and an email when it happens.')
    expect(screen.getByRole('button', { name: 'Join the waitlist' })).toBeInTheDocument()
  })

  it('the consent tick is required before anything is sent', async () => {
    openFull()
    cont()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const [label, value] of Object.entries({ 'First name': 'Alice', 'Last name': 'Smith', Email: 'alice@test.com', Phone: '(256) 555-0123' })) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    expect(await screen.findByText('Tick the box to let us save your card and charge it if a spot opens.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('joins: sends only the card token and the consent exactly as shown (I2), shows "You\'re on the waitlist"', async () => {
    openFull()
    cont()
    const fetchMock = vi.fn().mockResolvedValue(serverSays(200, { data: { position: 2, waiting: 2, card: { brand: 'VISA', last4: '4242' }, emailSent: true } }))
    vi.stubGlobal('fetch', fetchMock)
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    expect(await screen.findByText('You’re on the waitlist')).toBeInTheDocument()
    expect(screen.getByText(/You’re number 2 on the waitlist for Clay Camp\. We’ll add you and charge your card ending 4242/)).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/classes/waitlist.json')
    const sent = JSON.parse(init.body)
    expect(sent).toMatchObject({ action: 'join', classId: 'cls_1', passId: 'all', tickets: { person: 1 }, consent: true, cardToken: 'cnon:test-token', verificationToken: null })
    // The server prices it itself; the consent shown is sent only so a changed one is refused (I2).
    expect(sent.consentShown).toEqual({ maxCents: 2180, closesIso: '2026-10-24T16:00:00.000Z', firstStartIso: expect.any(String), text: screen.queryByTestId('waitlist-consent')?.textContent ?? expect.stringContaining('never more than $21.80') })
    const { consentShown: _shown, ...rest } = sent
    expect(JSON.stringify(rest)).not.toMatch(/Cents|price|amount/)
  })

  it('I2: the price changed while the panel was open → the new amount shows, the box is unticked, nothing joined', async () => {
    openFull()
    cont()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(409, { code: 'consent_changed', detail: 'The price changed to $25.07. Check it and tick the box again. Nothing was charged.', maxCents: 2507, closesIso: '2026-10-24T16:00:00.000Z' }))
      .mockResolvedValue(serverSays(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    expect(await screen.findByText('The price changed to $25.07. Check it and tick the box again. Nothing was charged.')).toBeInTheDocument()
    expect(screen.getByTestId('waitlist-consent')).toHaveTextContent('It’s never more than $25.07, even if the price goes up later')
    expect(screen.getByText(/Never more than \$25\.07, charged only if a spot opens\./)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Save my card with Square/ })).not.toBeChecked()
    expect(screen.queryByText('You’re on the waitlist')).toBeNull()
  })

  it('a spot opened meanwhile: "A spot just opened. Book it now." and fresh seat counts are fetched', async () => {
    openFull()
    cont()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(409, { code: 'spot_open', detail: 'A spot just opened. Book it now.' }))
      .mockResolvedValue(serverSays(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    expect(await screen.findByText('A spot just opened. Book it now.')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/classes/cls_1.json', expect.anything()))
  })

  it('after the cutoff the full class is just sold out (no waitlist)', async () => {
    const cls = one()
    const late = new Date('2026-10-24T16:30:00Z') // 1.5 h before
    vi.setSystemTime(late)
    const workshop = toPublicClass(cls, { classId: cls.id, lines: taken(2, ['ses_a']) }, late, {}, { classId: cls.id, entries: [] })
    expect(workshop.own!.sessions[0].waitlist!.open).toBe(false)
  })

  it('at the door there is never a waitlist step', async () => {
    const cls = one()
    const workshop = toPublicClass(cls, { classId: cls.id, lines: taken(2, ['ses_a']) }, NOW, { door: true })
    render(<ClassBookingPanel workshop={workshop} onClose={vi.fn()} syncUrl={false} door />)
    expect(screen.queryByTestId('waitlist-note')).toBeNull()
  })
})

describe('ClassBookingPanel — leaving during payment can never charge twice (final review C2)', () => {
  async function toPayStep() {
    cont()
    await screen.findByTestId('payment-form')
    fillContact()
  }

  it('while Pay is running, × and Escape say the payment is going through and keep the panel open', async () => {
    let answer!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { answer = resolve })))
    const { onClose } = open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Processing…' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const note = screen.getByRole('alertdialog', { name: 'Your payment is going through' })
    expect(note).toHaveTextContent('Stay on this page. It only takes a moment.')
    expect(screen.queryByText(/Nothing is saved until you pay/)).toBeNull()
    // One button only: nothing here closes the panel.
    expect(note.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alertdialog', { name: 'Your payment is going through' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    answer(bookedReply())
    await screen.findByText('You’re booked')
  })

  it('asks the browser to confirm before leaving the page mid-payment', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Processing…' })).toBeInTheDocument())
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Check again sends the very same request (same attempt, same card token) and shows the booking', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(502, { code: 'unknown_outcome', detail: 'We’re not sure that went through.' }))
      .mockResolvedValueOnce(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }))
    await screen.findByText('You’re booked')
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body)
  })

  it('reopened after an unclear answer, the same booking sends the same attempt id, with a note to check email first', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(502, { code: 'unknown_outcome', detail: 'We’re not sure that went through.' }))
      .mockResolvedValueOnce(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    const first = open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByRole('button', { name: 'Check again' })
    const closes = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closes[closes.length - 1])
    expect(first.onClose).toHaveBeenCalled()
    cleanup()
    open()
    await toPayStep()
    expect(screen.getByTestId('earlier-pending')).toHaveTextContent('Your last payment for this class may still be going through. Check your email for a receipt before you pay again.')
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText('You’re booked')
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).attemptId)
    expect(ids[1]).toBe(ids[0])
    // Booked: the tab forgets it.
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('hs-pending-attempt:'))).toEqual([])
  })

  it('a "slow down" (429) keeps the attempt, so the next tap is recognised as the same try', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(429, { code: 'unavailable', detail: 'That’s a lot of attempts in a row. Give it a minute, then try again.' }))
      .mockResolvedValueOnce(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText(/a lot of attempts/)
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    await screen.findByText('You’re booked')
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).attemptId)
    expect(ids[1]).toBe(ids[0])
  })

  it('the same person booked minutes ago: nothing charged, they choose to book again, and the retry says so', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverSays(409, { code: 'recent_booking', detail: 'You booked this class a few minutes ago. Check your email for the confirmation. Nothing was charged this time.' }))
      .mockResolvedValueOnce(bookedReply())
    vi.stubGlobal('fetch', fetchMock)
    open()
    await toPayStep()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $43.60' }))
    expect(await screen.findByTestId('recent-booking')).toHaveTextContent('You booked this class a few minutes ago.')
    fireEvent.click(screen.getByRole('button', { name: 'Yes, book these seats too' }))
    await screen.findByText('You’re booked')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).confirmRepeat).toBeUndefined()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).confirmRepeat).toBe(true)
  })
})
