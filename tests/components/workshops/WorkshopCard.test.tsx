import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    category: 'workshop',
    remainingSeats: 5 as number | null,
    ...overrides,
  }
}

describe('WorkshopCard', () => {
  it('renders workshop name, formatted date, time, price, and duration', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.getByText('Intro to Pottery')).toBeInTheDocument()
    expect(screen.getByText(/April 15$/)).toBeInTheDocument() // no year on cards
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

  it('shows Book Seat button', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.getByRole('button', { name: 'Book Seat' })).toBeInTheDocument()
  })

  it('returns null when remainingSeats is 0', () => {
    const { container } = render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: 0 })} />)

    expect(container.innerHTML).toBe('')
  })
})

describe('WorkshopCard — a workshop with no price yet', () => {
  it('says "Coming soon" and shows no price, no seats and no way to book', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 0 })} />)

    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.queryByText(/seats remaining/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Book Seat' })).toBeNull()
  })

  it('offers to tell them when booking opens, and asks for an email only after they tap', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 0 })} />)
    expect(screen.queryByLabelText('Email address')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tell me when booking opens' }))

    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
  })

  it('never calls onBook', () => {
    const onBook = vi.fn()
    render(<WorkshopCard workshop={makeWorkshop({ price: 0 })} onBook={onBook} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when booking opens' }))
    expect(onBook).not.toHaveBeenCalled()
  })

  it('leaves a priced workshop exactly as it was', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)
    expect(screen.getByRole('button', { name: 'Book Seat' })).toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).toBeNull()
  })
})
