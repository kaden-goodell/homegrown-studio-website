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
  it('sign-ups closed: says so, and the only thing to press is Request a spot', () => {
    render(<WorkshopTile workshop={{ ...base, signupClosed: true }} />)
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Request a spot'])
  })
})

describe('WorkshopTile — ticket types', () => {
  it('shows each ticket’s price', () => {
    render(<WorkshopTile workshop={{ ...base, price: 2000, tickets: [{ id: 'adult', label: 'Adult', priceCents: 2000, min: 1 }, { id: 'kid', label: 'Kid', priceCents: 1500, min: 1 }] } as any} />)
    expect(screen.getByText(/\$20 adult · \$15 kid/)).toBeInTheDocument()
  })
})

describe('WorkshopTile — our own class with an early-bird (stage 4)', () => {
  it('the card says the early-bird price and the day it ends', async () => {
    const { previewData } = await import('@components/admin/classes/preview')
    const { content } = await import('../admin/sheets/harness')
    const w = previewData(content({ name: 'Pottery', prices: { pas_full: { person: 2500 } }, earlyBird: { untilYmd: '2031-10-31', prices: { pas_full: { person: 2000 } } } }), [
      { id: 's1', startIso: '2031-11-20T18:00:00Z', endIso: '2031-11-20T20:00:00Z', capacity: 8 },
    ])
    render(<WorkshopTile workshop={w} />)
    expect(screen.getByText(/\$25 · Early-bird \$20 until Fri Oct 31/)).toBeInTheDocument()
  })
})
