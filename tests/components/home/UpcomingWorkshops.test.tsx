import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import UpcomingWorkshops from '@components/home/UpcomingWorkshops'

const DESCRIPTION =
  'Kinusaiga is Japanese fabric art with no sewing.\nEveryone picks their design and fabrics.\nEach guest goes home with a finished fabric-art panel. Ages 12 and up.'

function workshop(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    name: 'Kinusaiga',
    description: DESCRIPTION,
    category: 'workshop',
    date: '2026-10-16',
    // 7–9 PM in Madison, AL (CDT, UTC-5)
    startTime: '2026-10-17T00:00:00Z',
    endTime: '2026-10-17T02:00:00.000Z',
    duration: 120,
    price: 4000,
    currency: 'USD',
    remainingSeats: 6 as number | null,
    ...overrides,
  }
}

function answerWith(answer: { ok?: boolean; status?: number; body?: unknown } | Error) {
  const fetchMock =
    answer instanceof Error
      ? vi.fn().mockRejectedValue(answer)
      : vi.fn().mockResolvedValue({ ok: answer.ok ?? true, status: answer.status ?? 200, json: async () => answer.body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const names = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('UpcomingWorkshops (home page)', () => {
  it('shows a workshop the way the workshops page does', async () => {
    answerWith({ body: { workshops: [workshop()] } })
    render(<UpcomingWorkshops />)

    expect(await screen.findByRole('heading', { name: 'Kinusaiga' })).toBeInTheDocument()
    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByText('Kinusaiga is Japanese fabric art with no sewing.')).toBeInTheDocument()
    expect(screen.getByText('Take home a finished fabric-art panel · Ages 12+')).toBeInTheDocument()
    expect(screen.getByText('$40 per seat')).toBeInTheDocument()
    expect(screen.getByText('6 seats left')).toBeInTheDocument()
  })

  it('links each card to that workshop on the workshops page', async () => {
    answerWith({ body: { workshops: [workshop({ id: 'clsschi_a/b' })] } })
    render(<UpcomingWorkshops />)

    const link = await screen.findByRole('link', { name: 'See details and book' })
    expect(link).toHaveAttribute('href', '/workshops?w=clsschi_a%2Fb')
    expect(link).toHaveClass('btn', 'btn-primary')
  })

  it('never rounds a price', async () => {
    answerWith({ body: { workshops: [workshop({ price: 3250 })] } })
    render(<UpcomingWorkshops />)

    expect(await screen.findByText('$32.50 per seat')).toBeInTheDocument()
    expect(screen.queryByText(/\$33/)).toBeNull()
  })

  it('says nothing about seats above 8', async () => {
    answerWith({ body: { workshops: [workshop({ remainingSeats: 35 })] } })
    render(<UpcomingWorkshops />)

    await screen.findByRole('heading', { name: 'Kinusaiga' })
    expect(screen.queryByText(/seats? left/)).toBeNull()
  })

  it('shows the next three, by date and then by start time', async () => {
    answerWith({
      body: {
        workshops: [
          workshop({ id: 'd', name: 'Later', date: '2026-10-31', startTime: '2026-10-31T19:00:00Z' }),
          workshop({ id: 'c', name: 'Same day, evening', date: '2026-10-25', startTime: '2026-10-26T00:00:00Z' }),
          workshop({ id: 'b', name: 'Same day, afternoon', date: '2026-10-25', startTime: '2026-10-25T21:00:00Z' }),
          workshop({ id: 'a', name: 'First', date: '2026-10-16', startTime: '2026-10-17T00:00:00Z' }),
        ],
      },
    })
    render(<UpcomingWorkshops />)

    await screen.findByRole('heading', { name: 'First' })
    expect(names()).toEqual(['First', 'Same day, afternoon', 'Same day, evening'])
  })

  it('keeps a sold-out workshop in its place, with no way to book it', async () => {
    answerWith({
      body: {
        workshops: [
          workshop({ id: 'b', name: 'Open', date: '2026-10-17', startTime: '2026-10-18T00:00:00Z' }),
          workshop({ id: 'a', name: 'Full', remainingSeats: 0 }),
        ],
      },
    })
    render(<UpcomingWorkshops />)

    await screen.findByRole('heading', { name: 'Full' })
    expect(names()).toEqual(['Full', 'Open'])
    const full = screen.getByRole('heading', { name: 'Full' }).closest('article')!
    expect(within(full).getByText('Sold out')).toBeInTheDocument()
    expect(within(full).getByRole('button', { name: 'Tell me if a seat opens' })).toBeInTheDocument()
    expect(within(full).queryByRole('link')).toBeNull()
  })

  it('shows a workshop with no price as coming soon, with no price and no way to book', async () => {
    answerWith({ body: { workshops: [workshop({ price: 0 })] } })
    render(<UpcomingWorkshops />)

    expect(await screen.findByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText(/per seat/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See details and book' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tell me when booking opens' })).toBeInTheDocument()
  })

  it('links to all workshops', async () => {
    answerWith({ body: { workshops: [workshop()] } })
    render(<UpcomingWorkshops />)

    expect(await screen.findByRole('link', { name: /See all workshops/ })).toHaveAttribute('href', '/workshops')
  })

  it('hides itself when there are no workshops', async () => {
    const fetchMock = answerWith({ body: { workshops: [] } })
    const { container } = render(<UpcomingWorkshops />)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await Promise.resolve()
    expect(container.innerHTML).toBe('')
  })

  it('hides itself when workshops cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = answerWith({ ok: false, status: 500, body: {} })
    const { container } = render(<UpcomingWorkshops />)

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/workshops.json')
    expect(container.innerHTML).toBe('')
  })
})
