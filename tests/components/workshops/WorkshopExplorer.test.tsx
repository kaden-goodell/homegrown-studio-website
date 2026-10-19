import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import WorkshopExplorer from '@components/workshops/WorkshopExplorer'

vi.mock('@components/workshops/WorkshopRow', () => ({
  default: ({ workshop }: { workshop: { id: string; name: string } }) => (
    <div data-testid={`workshop-${workshop.id}`}>{workshop.name}</div>
  ),
}))

vi.mock('@components/workshops/WorkshopTile', () => ({
  default: ({ workshop }: { workshop: { id: string; name: string } }) => <div data-testid={`tile-${workshop.id}`}>{workshop.name}</div>,
}))
vi.mock('@components/workshops/WorkshopBookingModal', () => ({
  default: ({ workshop }: { workshop: { name: string } }) => <div data-testid="booking-modal">Modal for {workshop.name}</div>,
}))
vi.mock('@components/classes/ClassBookingPanel', () => ({
  default: ({ workshop }: { workshop: { name: string } }) => <div data-testid="class-panel">Class panel for {workshop.name}</div>,
}))

const mockWorkshops = [
  {
    id: '1',
    name: 'Candle Making',
    description: 'Make candles',
    category: 'workshop',
    date: '2026-03-15',
    startTime: '2026-03-15T15:00:00Z',
    endTime: '2026-03-15T16:30:00Z',
    duration: 90,
    price: 4500,
    currency: 'USD',
    remainingSeats: 5 as number | null,
  },
  {
    id: '2',
    name: 'Pottery Basics',
    description: 'Learn pottery',
    category: 'workshop',
    date: '2026-03-20',
    startTime: '2026-03-20T18:00:00Z',
    endTime: '2026-03-20T20:00:00Z',
    duration: 120,
    price: 5500,
    currency: 'USD',
    remainingSeats: 3 as number | null,
  },
]

const soldOut = { ...mockWorkshops[0], id: '3', name: 'Kinusaiga', date: '2026-03-18', startTime: '2026-03-19T00:00:00Z', endTime: '2026-03-19T02:00:00Z', remainingSeats: 0 }
const comingSoon = { ...mockWorkshops[0], id: '4', name: 'Tallow Skincare', date: '2026-03-25', startTime: '2026-03-26T00:00:00Z', endTime: '2026-03-26T02:00:00Z', price: 0 }

const SOLD_OUT_NOTICE = 'Kinusaiga is sold out. Leave your email on its card and we’ll tell you if a seat opens.'
const FINISHED_NOTICE = 'That workshop has finished or is no longer listed. Here’s what’s coming up.'

function answerWith(...answers: Array<{ ok?: boolean; status?: number; body?: unknown } | Error>) {
  const fetchMock = vi.fn()
  for (const a of answers) {
    if (a instanceof Error) fetchMock.mockRejectedValueOnce(a)
    else fetchMock.mockResolvedValueOnce({ ok: a.ok ?? true, status: a.status ?? 200, json: async () => a.body })
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  window.history.replaceState({}, '', '/workshops')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('WorkshopExplorer', () => {
  it('renders one card per workshop in chronological order', () => {
    // Pass them out of order to prove the component sorts by date/time.
    render(<WorkshopExplorer workshops={[mockWorkshops[1], mockWorkshops[0]]} />)

    const cards = screen.getAllByTestId(/^workshop-/)
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'workshop-1',
      'workshop-2',
    ])
  })

  it('keeps sold-out and coming-soon workshops in date order with the rest', () => {
    render(<WorkshopExplorer workshops={[comingSoon, mockWorkshops[1], soldOut, mockWorkshops[0]]} />)

    const cards = screen.getAllByTestId(/^workshop-/)
    expect(cards.map((c) => c.textContent)).toEqual([
      'Candle Making',
      'Kinusaiga',
      'Pottery Basics',
      'Tallow Skincare',
    ])
  })

  it('describes each listed workshop to search engines', () => {
    const { container } = render(<WorkshopExplorer workshops={mockWorkshops} />)
    const block = container.querySelector('script[type="application/ld+json"]')
    expect(block).not.toBeNull()
    const events = JSON.parse(block!.textContent ?? '[]')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ '@type': 'Event', name: 'Candle Making' })
    expect(events[0].offers.url).toBe('https://ourhometownstudio.com/workshops?w=1')
    expect(events[0].offers.price).toBe('45.00')
    expect(events[0].offers.availability).toBe('https://schema.org/InStock')
  })

  it('tells search engines a sold-out workshop is sold out, and leaves a coming-soon one out', () => {
    const { container } = render(<WorkshopExplorer workshops={[mockWorkshops[0], soldOut, comingSoon]} />)
    const events = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent ?? '[]')

    expect(events.map((e: { name: string }) => e.name)).toEqual(['Candle Making', 'Kinusaiga'])
    expect(events[1].offers.availability).toBe('https://schema.org/SoldOut')
    expect(events[1].offers.price).toBe('45.00')
  })

  it('shows the empty-state copy when there are no workshops', async () => {
    // No SSR list → the component fetches; make the fetch return an empty list.
    answerWith({ body: { workshops: [] } })
    render(<WorkshopExplorer />)

    expect(await screen.findByText(/New workshops are on the way/i)).toBeInTheDocument()
    // Never a promise without a way to act on it: the empty state takes an email.
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tell me when they’re posted' })).toBeInTheDocument()
    expect(screen.queryByText(/newsletter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).toBeNull()
  })

  it('shows the workshops it fetched', async () => {
    answerWith({ body: { workshops: mockWorkshops } })
    render(<WorkshopExplorer />)

    expect(await screen.findByTestId('workshop-1')).toBeInTheDocument()
    expect(screen.getByTestId('workshop-2')).toBeInTheDocument()
  })
})

describe('WorkshopExplorer — when workshops cannot be loaded', () => {
  async function expectFailureState() {
    expect(await screen.findByText('We couldn’t load workshops just now.')).toBeInTheDocument()
    expect(screen.queryByText(/New workshops are on the way/i)).toBeNull()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('btn', 'btn-secondary')
    expect(screen.getByRole('link', { name: 'See the calendar' })).toHaveAttribute('href', '/calendar')
    expect(screen.getByRole('link', { name: 'Book a party' })).toHaveAttribute('href', '/book')
  }

  it('says so when the request is refused', async () => {
    answerWith({ ok: false, status: 500, body: {} })
    render(<WorkshopExplorer />)
    await expectFailureState()
  })

  it('says so when the request never arrives', async () => {
    answerWith(new Error('offline'))
    render(<WorkshopExplorer />)
    await expectFailureState()
  })

  it('says so when the answer is incomplete and lists nothing', async () => {
    answerWith({ body: { workshops: [], incomplete: true } })
    render(<WorkshopExplorer />)
    await expectFailureState()
  })

  it('shows what it has when the answer is incomplete but lists workshops', async () => {
    answerWith({ body: { workshops: mockWorkshops, incomplete: true } })
    render(<WorkshopExplorer />)

    expect(await screen.findByTestId('workshop-1')).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).toBeNull()
  })

  it('"Try again" asks again and shows the workshops when it works', async () => {
    const fetchMock = answerWith({ ok: false, status: 502, body: {} }, { body: { workshops: mockWorkshops } })
    render(<WorkshopExplorer />)

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('workshop-1')).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/workshops.json')
  })

  it('"Try again" that fails again says so again', async () => {
    answerWith({ ok: false, status: 502, body: {} }, new Error('offline'))
    render(<WorkshopExplorer />)

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await expectFailureState()
  })

  it('says nothing about a finished workshop while the list could not be loaded', async () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    answerWith({ body: { workshops: [], incomplete: true } })
    render(<WorkshopExplorer />)

    await expectFailureState()
    expect(screen.queryByText(/has finished/)).toBeNull()
  })
})

describe('WorkshopExplorer — a link to one workshop (?w=<id>)', () => {
  it('opens the booking panel for a workshop that can be booked', () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.getByTestId('booking-modal')).toHaveTextContent('Pottery Basics')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens it once the fetched list arrives', async () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    answerWith({ body: { workshops: mockWorkshops } })
    render(<WorkshopExplorer />)

    expect(await screen.findByTestId('booking-modal')).toHaveTextContent('Pottery Basics')
  })

  it('sold out: no booking panel, a notice above the list, and the card scrolled into view', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    window.history.replaceState({}, '', '/workshops?w=3')
    render(<WorkshopExplorer workshops={[...mockWorkshops, soldOut]} />)

    expect(screen.queryByTestId('booking-modal')).toBeNull()
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(SOLD_OUT_NOTICE)
    // Above the list: the notice comes before the first card in the page.
    const firstCard = screen.getAllByTestId(/^workshop-/)[0]
    expect(notice.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(scrolled).toContainElement(screen.getByTestId('workshop-3'))
    expect(scrolled).not.toContainElement(screen.getByTestId('workshop-1'))
  })

  it('sold out: still works in a browser that cannot scroll an element into view', () => {
    window.history.replaceState({}, '', '/workshops?w=3')
    render(<WorkshopExplorer workshops={[...mockWorkshops, soldOut]} />)

    expect(screen.getByRole('status')).toHaveTextContent(SOLD_OUT_NOTICE)
  })

  it('coming soon: no booking panel and no notice', () => {
    window.history.replaceState({}, '', '/workshops?w=4')
    render(<WorkshopExplorer workshops={[...mockWorkshops, comingSoon]} />)

    expect(screen.queryByTestId('booking-modal')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('workshop-4')).toBeInTheDocument()
  })

  it('coming soon wins over sold out: no notice for a workshop with no price and no seats', () => {
    window.history.replaceState({}, '', '/workshops?w=4')
    render(<WorkshopExplorer workshops={[...mockWorkshops, { ...comingSoon, remainingSeats: 0 }]} />)

    expect(screen.queryByTestId('booking-modal')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('finished or unknown: says so above the list of what is coming up', () => {
    window.history.replaceState({}, '', '/workshops?w=gone')
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.queryByTestId('booking-modal')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(FINISHED_NOTICE)
    expect(screen.getAllByTestId(/^workshop-/)).toHaveLength(2)
  })

  it('finished or unknown: waits for the list before saying so', async () => {
    window.history.replaceState({}, '', '/workshops?w=gone')
    let arrive: (value: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { arrive = resolve })))
    render(<WorkshopExplorer />)

    expect(screen.queryByRole('status')).toBeNull()

    arrive({ ok: true, status: 200, json: async () => ({ workshops: mockWorkshops }) })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(FINISHED_NOTICE))
  })

  it('sign-ups closed: no booking panel, a notice instead', () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    render(<WorkshopExplorer workshops={[mockWorkshops[0], { ...mockWorkshops[1], signupClosed: true }]} />)
    expect(screen.queryByTestId('booking-modal')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Sign-ups for Pottery Basics have closed.')
  })

  it('no link, no notice', () => {
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByTestId('booking-modal')).toBeNull()
  })
})

describe('WorkshopExplorer — Kids & teens / Adults switch and This week', () => {
  const kid = { ...mockWorkshops[0], id: 'k', name: 'Pumpkin Pails', description: 'Bedazzle a pail.\n\nEach guest goes home with the pail. Ages 8 and up.', startTime: '2026-10-18T18:00:00Z', date: '2026-10-18' }
  const teen = { ...mockWorkshops[0], id: 't', name: 'Craft Club', description: 'Bulletin boards.\n\nEach guest goes home with a board. Grades 9–12 only.', startTime: '2026-10-19T00:00:00Z', date: '2026-10-18' }
  const adult = { ...mockWorkshops[0], id: 'a', name: 'Kinusaiga', description: 'Fabric art.\n\nEach guest goes home with a panel. Ages 18 and up.', startTime: '2026-10-25T00:00:00Z', date: '2026-10-24' }
  const unknown = { ...mockWorkshops[0], id: 'u', name: 'Mystery', description: 'Something.', startTime: '2026-10-26T00:00:00Z', date: '2026-10-25' }
  const names = () => screen.queryAllByTestId(/^workshop-/).map((c) => c.textContent)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('starts on All and shows every class', () => {
    render(<WorkshopExplorer workshops={[adult, kid, teen, unknown]} />)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['Pumpkin Pails', 'Craft Club', 'Kinusaiga', 'Mystery'])
  })

  it('Kids & teens shows ages-under-18 and grades classes only; Adults the 18+ ones', () => {
    render(<WorkshopExplorer workshops={[adult, kid, teen, unknown]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kids & teens' }))
    expect(names()).toEqual(['Pumpkin Pails', 'Craft Club'])
    fireEvent.click(screen.getByRole('button', { name: 'Adults' }))
    expect(names()).toEqual(['Kinusaiga'])
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(names()).toHaveLength(4)
  })

  it('splits into This week (next 7 days) and Coming up', () => {
    render(<WorkshopExplorer workshops={[adult, kid]} />)
    const week = screen.getByRole('region', { name: 'This week' })
    const later = screen.getByRole('region', { name: 'Coming up' })
    expect(within(week).getByText('Pumpkin Pails')).toBeInTheDocument()
    expect(within(later).getByText('Kinusaiga')).toBeInTheDocument()
  })

  it('a filter with nothing in it says so and offers All', () => {
    render(<WorkshopExplorer workshops={[adult]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kids & teens' }))
    expect(screen.getByText(/No kids’ classes posted right now/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See all classes' }))
    expect(names()).toEqual(['Kinusaiga'])
  })
})

describe('WorkshopExplorer — phone rows vs wide-screen cards', () => {
  const setWidth = (wide: boolean) =>
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: wide && q.includes('768'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  it('phones get the compact rows', () => {
    setWidth(false)
    render(<WorkshopExplorer workshops={mockWorkshops} />)
    expect(screen.getAllByTestId(/^workshop-/)).toHaveLength(2)
    expect(screen.queryAllByTestId(/^tile-/)).toHaveLength(0)
  })
  it('768px and wider get the photo cards', () => {
    setWidth(true)
    render(<WorkshopExplorer workshops={mockWorkshops} />)
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(2)
    expect(screen.queryAllByTestId(/^workshop-/)).toHaveLength(0)
  })
})

describe('WorkshopExplorer — our own classes', () => {
  it('opens our class in its own booking panel, not the Square one', () => {
    window.history.replaceState({}, '', '/workshops?w=cls_1')
    const ours = { ...mockWorkshops[1], id: 'cls_1', name: 'Clay Camp', own: { classId: 'cls_1', sessions: [], passes: [], ticketTypes: [], prices: {}, questions: [], addOns: [], rules: {} as any, instructor: null, taxPercent: 9 } }
    render(<WorkshopExplorer workshops={[...mockWorkshops, ours]} />)
    expect(screen.getByTestId('class-panel')).toHaveTextContent('Clay Camp')
    expect(screen.queryByTestId('booking-modal')).toBeNull()
  })

  it('the Kids & teens filter reads our class’s ages line', () => {
    const ours = { ...mockWorkshops[1], id: 'cls_2', name: 'Clay Camp', description: 'Make a pot.', own: { classId: 'cls_2', sessions: [], passes: [], ticketTypes: [], prices: {}, questions: [], addOns: [], rules: { ages: '8 and up' } as any, instructor: null, taxPercent: 9 } }
    render(<WorkshopExplorer workshops={[ours]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kids & teens' }))
    expect(screen.getByTestId('workshop-cls_2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Adults' }))
    expect(screen.queryByTestId('workshop-cls_2')).toBeNull()
  })
})
