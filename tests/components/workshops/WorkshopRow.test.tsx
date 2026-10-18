import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkshopRow, { rowWhen } from '@components/workshops/WorkshopRow'

vi.mock('@components/shared/NotifyMe', () => ({ default: ({ buttonLabel }: { buttonLabel: string }) => <div data-testid="notify">{buttonLabel}</div> }))

const base = {
  id: 'w1', name: 'Bedazzled Pumpkin Pails', category: 'workshop',
  description: 'Bedazzle a pail.\n\nEach guest goes home with the pail. Ages 8 and up. This is a drop-off class, so parents can head out.',
  date: '2026-10-18', startTime: '2026-10-18T18:00:00.000Z', endTime: '2026-10-18T20:00:00.000Z', duration: 120,
  price: 2500, currency: 'USD', remainingSeats: 20 as number | null, imageUrl: 'https://example.com/p.jpg',
}

describe('WorkshopRow', () => {
  it('shows when, what, price, ages and drop-off, and opens booking on tap', () => {
    const onBook = vi.fn()
    render(<WorkshopRow workshop={base} onBook={onBook} />)
    expect(screen.getByText('Sun, Oct 18 · 1 PM')).toBeInTheDocument()
    expect(screen.getByText('$25 · Ages 8+ · Drop-off')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bedazzled Pumpkin Pails, Sun, Oct 18 · 1 PM\. See details and book/ }))
    expect(onBook).toHaveBeenCalledWith(base)
  })

  it('says seats left only under 10', () => {
    const { rerender } = render(<WorkshopRow workshop={{ ...base, remainingSeats: 10 }} />)
    expect(screen.queryByText(/seats? left/)).toBeNull()
    rerender(<WorkshopRow workshop={{ ...base, remainingSeats: 3 }} />)
    expect(screen.getByText('3 seats left')).toBeInTheDocument()
  })

  it('sold out: not bookable, offers the seat-opens email', () => {
    const onBook = vi.fn()
    render(<WorkshopRow workshop={{ ...base, remainingSeats: 0 }} onBook={onBook} />)
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /See details and book/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tell me if a seat opens' }))
    expect(screen.getByTestId('notify')).toHaveTextContent('Tell me if a seat opens')
  })

  it('coming soon: no price, no booking, offers the opens email', () => {
    render(<WorkshopRow workshop={{ ...base, price: 0 }} />)
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText(/\$0/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Tell me when booking opens' })).toBeInTheDocument()
  })

  it('sign-ups closed: says so, not bookable, and offers to call about a spot', () => {
    render(<WorkshopRow workshop={{ ...base, signupClosed: true }} />)
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /See details and book/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Request a spot' }))
    const dialog = screen.getByRole('dialog', { name: 'Request a spot' })
    expect(dialog).toHaveTextContent('Sign-ups close early so we can get everything ready for each person. Sometimes we have a spare, so give us a call and we’ll check.')
    expect(screen.getByRole('link', { name: 'Call (256) 464-1710' })).toHaveAttribute('href', 'tel:+12564641710')
    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('times read "1 PM", "7:30 PM", "10 AM"', () => {
    expect(rowWhen({ date: '2026-10-18', startTime: '2026-10-18T18:00:00.000Z' })).toBe('Sun, Oct 18 · 1 PM')
    expect(rowWhen({ date: '2026-10-17', startTime: '2026-10-18T00:30:00.000Z' })).toBe('Sat, Oct 17 · 7:30 PM')
    expect(rowWhen({ date: '2026-12-05', startTime: '2026-12-05T16:00:00.000Z' })).toBe('Sat, Dec 5 · 10 AM')
  })
})
