import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkshopExplorer from '@components/workshops/WorkshopExplorer'

vi.mock('@components/workshops/WorkshopCard', () => ({
  default: ({ workshop }: { workshop: { id: string; name: string } }) => (
    <div data-testid={`workshop-${workshop.id}`}>{workshop.name}</div>
  ),
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
  {
    id: '3',
    name: 'Painting Class',
    description: 'Paint landscapes',
    category: 'art',
    date: '2026-03-15',
    startTime: '2026-03-15T14:00:00',
    endTime: '2026-03-15T15:30:00',
    duration: 90,
    price: 4000,
    currency: 'USD',
    remainingSeats: null as number | null,
  },
]

describe('WorkshopExplorer', () => {
  it('renders view toggle and defaults to search view', () => {
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search workshops/i)).toBeInTheDocument()
  })

  it('search filters workshops by name', () => {
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    const input = screen.getByPlaceholderText(/search workshops/i)
    fireEvent.change(input, { target: { value: 'Candle' } })

    expect(screen.getByTestId('workshop-1')).toBeInTheDocument()
    expect(screen.queryByTestId('workshop-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workshop-3')).not.toBeInTheDocument()
  })

  it('category filter works', () => {
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    const select = screen.getByRole('combobox', { name: /category/i })
    fireEvent.change(select, { target: { value: 'art' } })

    expect(screen.getByTestId('workshop-3')).toBeInTheDocument()
    expect(screen.queryByTestId('workshop-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workshop-2')).not.toBeInTheDocument()
  })

  it('view toggle switches between calendar and search', () => {
    render(<WorkshopExplorer workshops={mockWorkshops} />)

    expect(screen.getByPlaceholderText(/search workshops/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.queryByPlaceholderText(/search workshops/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/previous month/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByPlaceholderText(/search workshops/i)).toBeInTheDocument()
  })
})
