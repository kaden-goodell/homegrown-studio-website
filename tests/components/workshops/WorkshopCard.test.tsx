import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WorkshopCard from '@components/workshops/WorkshopCard'

function makeWorkshop(overrides: Partial<Parameters<typeof WorkshopCard>[0]['workshop']> = {}) {
  return {
    id: 'ws-1',
    name: 'Intro to Pottery',
    description: 'Learn the basics of wheel throwing.',
    date: '2026-04-15',
    startTime: '2026-04-15T14:00:00',
    endTime: '2026-04-15T15:30:00',
    duration: 90,
    price: 4500,
    currency: 'USD',
    remainingSeats: 5 as number | null,
    ...overrides,
  }
}

describe('WorkshopCard', () => {
  it('renders workshop name, formatted date, time, price, and duration', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.getByText('Intro to Pottery')).toBeInTheDocument()
    expect(screen.getByText(/April 15, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/2:00 PM - 3:30 PM/)).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
    expect(screen.getByText('90 min')).toBeInTheDocument()
  })

  it('shows seats remaining when remainingSeats is a number', () => {
    render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: 5 })} />)

    expect(screen.getByText('5 seats remaining')).toBeInTheDocument()
  })

  it('hides seat count when remainingSeats is null', () => {
    render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: null })} />)

    expect(screen.queryByText(/seats remaining/)).not.toBeInTheDocument()
  })

  it('shows Book Seat button with correct href', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    const link = screen.getByRole('link', { name: 'Book Seat' })
    expect(link).toHaveAttribute('href', '/book?workshop=ws-1')
  })

  it('returns null when remainingSeats is 0', () => {
    const { container } = render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: 0 })} />)

    expect(container.innerHTML).toBe('')
  })
})
