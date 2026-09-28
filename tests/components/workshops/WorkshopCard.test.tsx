import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkshopCard from '@components/workshops/WorkshopCard'

const DESCRIPTION =
  'Kinusaiga is Japanese fabric art with no sewing: you tuck fabric into grooves cut in a foam board to build a picture.\nEveryone picks their design and fabrics, scores the board, and tucks piece by piece until the image appears.\nEach guest goes home with a finished fabric-art panel. Ages 12 and up.'

// Fri Oct 16 2026, 7–9 PM in Madison, AL (CDT, UTC-5): midnight to 2 AM UTC on the 17th.
function makeWorkshop(overrides: Partial<Parameters<typeof WorkshopCard>[0]['workshop']> = {}) {
  return {
    id: 'ws-1',
    name: 'Kinusaiga',
    description: DESCRIPTION,
    date: '2026-10-16',
    startTime: '2026-10-17T00:00:00Z',
    endTime: '2026-10-17T02:00:00.000Z',
    duration: 120,
    price: 4000,
    currency: 'USD',
    category: 'workshop',
    remainingSeats: 6 as number | null,
    ...overrides,
  }
}

describe('WorkshopCard', () => {
  it('shows the name, when it is, the price per seat and the seats left', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.getByRole('heading', { name: 'Kinusaiga' })).toBeInTheDocument()
    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByText('$40 per seat')).toBeInTheDocument()
    expect(screen.getByText('6 seats left')).toBeInTheDocument()
  })

  it('shows times as the studio clock reads them, whatever the visitor’s own time zone', () => {
    // 2:30–4 PM in Madison in winter (CST, UTC-6).
    render(
      <WorkshopCard
        workshop={makeWorkshop({ date: '2026-12-05', startTime: '2026-12-05T20:30:00Z', endTime: '2026-12-05T22:00:00Z' })}
      />,
    )

    expect(screen.getByText('Sat, Dec 5 · 2:30–4 PM')).toBeInTheDocument()
  })

  it('has no separate duration', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.queryByText(/\bmin\b/)).toBeNull()
  })

  it('never rounds a price', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 3250 })} />)

    expect(screen.getByText('$32.50 per seat')).toBeInTheDocument()
  })

  it('always shows the first paragraph of the description, photo or not', () => {
    const first =
      'Kinusaiga is Japanese fabric art with no sewing: you tuck fabric into grooves cut in a foam board to build a picture.'
    const { unmount } = render(<WorkshopCard workshop={makeWorkshop()} />)
    expect(screen.getByText(first)).toBeInTheDocument()
    expect(screen.queryByText(/Everyone picks/)).toBeNull()
    unmount()

    render(<WorkshopCard workshop={makeWorkshop({ imageUrl: 'https://example.com/k.jpg' })} />)
    expect(screen.getByText(first)).toBeInTheDocument()
  })

  it('shows what you take home and who it is for', () => {
    render(<WorkshopCard workshop={makeWorkshop()} />)

    expect(screen.getByText('Take home a finished fabric-art panel · Ages 12+')).toBeInTheDocument()
  })

  it('leaves the take-home line out when the description has none', () => {
    render(<WorkshopCard workshop={makeWorkshop({ description: 'Learn the basics of wheel throwing.' })} />)

    expect(screen.getByText('Learn the basics of wheel throwing.')).toBeInTheDocument()
    expect(screen.queryByText(/Take home/)).toBeNull()
  })

  it('loads the photo lazily in a 4:3 box, and keeps the box when there is no photo', () => {
    const { unmount } = render(<WorkshopCard workshop={makeWorkshop({ imageUrl: 'https://example.com/k.jpg' })} />)
    const img = screen.getByRole('img', { name: 'Kinusaiga' })
    expect(img).toHaveAttribute('src', 'https://example.com/k.jpg')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(screen.getByTestId('workshop-photo').style.aspectRatio).toBe('4 / 3')
    unmount()

    render(<WorkshopCard workshop={makeWorkshop()} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('workshop-photo').style.aspectRatio).toBe('4 / 3')
  })

  it('says nothing about seats when more than 8 are left, or when the number is unknown', () => {
    const { unmount } = render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: 9 })} />)
    expect(screen.queryByText(/seats? left/)).toBeNull()
    unmount()

    render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: null })} />)
    expect(screen.queryByText(/seats? left/)).toBeNull()
  })

  it('says "1 seat left" for the last seat', () => {
    render(<WorkshopCard workshop={makeWorkshop({ remainingSeats: 1 })} />)

    expect(screen.getByText('1 seat left')).toBeInTheDocument()
  })

  it('has one filled button, "See details and book", which books this workshop', () => {
    const onBook = vi.fn()
    const workshop = makeWorkshop()
    render(<WorkshopCard workshop={workshop} onBook={onBook} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('See details and book')
    expect(buttons[0]).toHaveClass('btn', 'btn-primary')

    fireEvent.click(buttons[0])
    expect(onBook).toHaveBeenCalledWith(workshop)
  })

  it('is a link instead when given somewhere to go (the home page)', () => {
    render(<WorkshopCard workshop={makeWorkshop()} href="/workshops?w=ws-1" />)

    const link = screen.getByRole('link', { name: 'See details and book' })
    expect(link).toHaveAttribute('href', '/workshops?w=ws-1')
    expect(link).toHaveClass('btn', 'btn-primary')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('WorkshopCard — a workshop with no price yet', () => {
  it('says "Coming soon" and shows no price, no seats and no way to book', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 0 })} href="/workshops?w=ws-1" />)

    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).toBeNull()
    expect(screen.queryByText(/per seat/)).toBeNull()
    expect(screen.queryByText(/seats? left/)).toBeNull()
    expect(screen.queryByText('See details and book')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('still shows when it is, the description and the take-home line', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 0 })} />)

    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByText(/^Kinusaiga is Japanese fabric art/)).toBeInTheDocument()
    expect(screen.getByText('Take home a finished fabric-art panel · Ages 12+')).toBeInTheDocument()
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

  it('wins over "Sold out" when a workshop has no price and no seats', () => {
    render(<WorkshopCard workshop={makeWorkshop({ price: 0, remainingSeats: 0 })} />)

    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText('Sold out')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tell me when booking opens' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tell me if a seat opens' })).toBeNull()
  })
})

describe('WorkshopCard — a sold-out workshop', () => {
  const soldOut = (overrides = {}) =>
    makeWorkshop({ remainingSeats: 0, imageUrl: 'https://example.com/k.jpg', ...overrides })

  it('stays on the page, marked "Sold out", with its price and no seat count', () => {
    render(<WorkshopCard workshop={soldOut()} />)

    expect(screen.getByRole('heading', { name: 'Kinusaiga' })).toBeInTheDocument()
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByText('$40 per seat')).toBeInTheDocument()
    expect(screen.queryByText(/seats? left/)).toBeNull()
    expect(screen.queryByText('Coming soon')).toBeNull()
  })

  it('dims the photo', () => {
    const { unmount } = render(<WorkshopCard workshop={soldOut()} />)
    expect(Number(screen.getByRole('img').style.opacity)).toBeLessThan(1)
    unmount()

    render(<WorkshopCard workshop={makeWorkshop({ imageUrl: 'https://example.com/k.jpg' })} />)
    expect(screen.getByRole('img').style.opacity).toBe('')
  })

  it('has no way to book: one secondary button, "Tell me if a seat opens"', () => {
    const onBook = vi.fn()
    render(<WorkshopCard workshop={soldOut()} onBook={onBook} href="/workshops?w=ws-1" />)

    expect(screen.queryByText('See details and book')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Tell me if a seat opens')
    expect(buttons[0]).toHaveClass('btn', 'btn-secondary')

    fireEvent.click(buttons[0])
    expect(onBook).not.toHaveBeenCalled()
  })

  it('asks for an email only after they tap, and promises one email', () => {
    render(<WorkshopCard workshop={soldOut()} />)
    expect(screen.queryByLabelText('Email address')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tell me if a seat opens' }))

    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tell me if a seat opens' })).toHaveAttribute('type', 'submit')
    expect(screen.getByText('One email if a seat opens. Nothing else.')).toBeInTheDocument()
  })

  it('files the sign-up under the workshop and its date, and says what happens next', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const longName = 'A Very Long Workshop Name That Goes On And On Well Past What Fits In The Note'
      render(<WorkshopCard workshop={soldOut({ name: longName })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Tell me if a seat opens' }))
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ann@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Tell me if a seat opens' }))

      expect(
        await screen.findByText('Got it. If a seat opens we’ll email you, and it goes to whoever books first.'),
      ).toBeInTheDocument()
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(sent.email).toBe('ann@example.com')
      expect(sent.interest).toMatch(/^workshop-waitlist:A Very Long Workshop Name/)
      expect(sent.interest).toMatch(/ 2026-10-16$/)
      expect(sent.interest.length).toBeLessThanOrEqual(80)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
