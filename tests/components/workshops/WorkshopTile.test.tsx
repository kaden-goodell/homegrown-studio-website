import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkshopTile from '@components/workshops/WorkshopTile'

vi.mock('@components/shared/NotifyMe', () => ({ default: ({ buttonLabel }: { buttonLabel: string }) => <div data-testid="notify">{buttonLabel}</div> }))

const base = {
  id: 'w1', name: 'Kinusaiga', category: 'workshop',
  description: 'Kinusaiga is Japanese fabric art with no sewing.\n\nLearn to tuck fabric.\n\nEach guest goes home with the panel. Ages 18 and up.',
  date: '2026-10-17', startTime: '2026-10-18T00:00:00.000Z', endTime: '2026-10-18T02:00:00.000Z', duration: 120,
  price: 4500, currency: 'USD', remainingSeats: 30 as number | null, imageUrl: 'https://example.com/k.jpg',
}

describe('WorkshopTile (wide screens)', () => {
  it('photo with the date on it, name, one-line hook, price and ages, and a Book button', () => {
    const onBook = vi.fn()
    render(<WorkshopTile workshop={base} onBook={onBook} />)
    expect(screen.getByText('Sat, Oct 17 · 7 PM')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kinusaiga' })).toBeInTheDocument()
    expect(screen.getByText('Kinusaiga is Japanese fabric art with no sewing.')).toBeInTheDocument()
    expect(screen.getByText('$45 · Ages 18+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See details and book' }))
    expect(onBook).toHaveBeenCalledWith(base)
  })
  it('sold out offers the seat-opens email instead of booking', () => {
    render(<WorkshopTile workshop={{ ...base, remainingSeats: 0 }} />)
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'See details and book' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tell me if a seat opens' })).toBeInTheDocument()
  })
  it('sign-ups closed: says so, nothing to press', () => {
    render(<WorkshopTile workshop={{ ...base, signupClosed: true }} />)
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
