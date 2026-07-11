import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import WorkshopExplorer from '@components/workshops/WorkshopExplorer'

vi.mock('@components/workshops/WorkshopCard', () => ({
  default: ({ workshop }: { workshop: { id: string; name: string } }) => (
    <div data-testid={`workshop-${workshop.id}`}>{workshop.name}</div>
  ),
}))

vi.mock('@components/workshops/WorkshopBookingModal', () => ({
  default: () => <div data-testid="booking-modal">Modal</div>,
}))

const mockWorkshops = [
  {
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
    remainingSeats: 5 as number | null,
  },
  {
    id: '2',
    name: 'Pottery Basics',
    description: 'Learn pottery',
    category: 'workshop',
    date: '2026-03-20',
    startTime: '2026-03-20T13:00:00',
    endTime: '2026-03-20T15:00:00',
    duration: 120,
    price: 5500,
    currency: 'USD',
    remainingSeats: 3 as number | null,
  },
]

afterEach(() => {
  window.history.replaceState({}, '', '/workshops')
  vi.restoreAllMocks()
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

  it('shows the empty-state copy when there are no workshops', async () => {
    // No SSR list → the component fetches; make the fetch return an empty list.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workshops: [] }) }),
    )
    render(<WorkshopExplorer />)

    expect(await screen.findByText(/New workshops are on the way/i)).toBeInTheDocument()
  })

  it('opens the booking modal when a ?w=<id> deeplink is present', () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.getByTestId('booking-modal')).toBeInTheDocument()
  })
})
