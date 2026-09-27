import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import WhatsOnCalendar from '@components/calendar/WhatsOnCalendar'
import type { CalendarEvent } from '@components/calendar/calendar-view-model'

// Pin the opening date so the month grid opens on October 2026 whatever the real one becomes.
vi.mock('@config/opening', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/opening')>()),
  OPENING_DATE: '2026-10-16',
}))

const NBSP = ' '
/** Line two never breaks inside an item, so it is set with non-breaking spaces. */
const spaced = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ')

const SATURDAY = '2026-10-17'

const EVENTS: CalendarEvent[] = [
  { id: 'party-available-a', kind: 'party-available', title: 'Party available · 9:00 AM', date: SATURDAY, startTime: '09:00', bookable: true, href: '/book?start=a' },
  { id: 'party-available-b', kind: 'party-available', title: 'Party available · 11:30 AM', date: SATURDAY, startTime: '11:30', bookable: true, href: '/book?start=b' },
  { id: 'party-available-c', kind: 'party-available', title: 'Party available · 2:00 PM', date: SATURDAY, startTime: '14:00', bookable: true, href: '/book?start=c' },
  { id: 'party-available-d', kind: 'party-available', title: 'Party available · 4:30 PM', date: SATURDAY, startTime: '16:30', bookable: true, href: '/book?start=d' },
  { id: 'open-studio-1', kind: 'open-studio', title: 'Open Studio', date: SATURDAY, startTime: '09:00', endTime: '18:00', bookable: false, href: '/open-studio' },
  { id: 'party-booked-1', kind: 'party-booked', title: 'Booked · private party', date: SATURDAY, startTime: '13:00', bookable: false },
  { id: 'workshop-abc', kind: 'workshop', title: 'Fall Earring Bar', date: SATURDAY, startTime: '19:00', endTime: '21:00', price: 3500, currency: 'USD', remainingSeats: 3, bookable: true, href: '/workshops?w=abc' },
]

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

/** Serve EVENTS for October 2026 and nothing for any other month. */
function stubCalendarApi(events: CalendarEvent[] = EVENTS) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({ events: String(url).includes('month=2026-10') ? events : [] }),
    }))
  )
}

/** The row (link or plain) that holds a given title. */
async function rowFor(title: string): Promise<HTMLElement> {
  const el = await screen.findByText(title)
  // title span → text column → row
  return el.parentElement!.parentElement!
}

describe('WhatsOnCalendar list rows (HOM-179)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T17:00:00.000Z'))
    stubMatchMedia(false)
    stubCalendarApi()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders a workshop as one link: title, then kind · time · price · seats, then "Book ›"', async () => {
    render(<WhatsOnCalendar />)
    const row = await rowFor('Fall Earring Bar')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/workshops?w=abc')
    expect(spaced(row.textContent)).toBe('Fall Earring BarWorkshop · 7–9 PM · $35 · 3 seats leftBook ›')
    expect(within(row).getByText('Book ›')).toHaveStyle({ fontWeight: '600', color: 'var(--tone-workshop-ink)' })
  })

  it('renders party availability as "Private party times" with a "Pick a time ›" link to the day', async () => {
    render(<WhatsOnCalendar />)
    const row = await rowFor('Private party times')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', `/book?date=${SATURDAY}`)
    expect(spaced(row.textContent)).toBe('Private party times4 open · from 9:00 AMPick a time ›')
    expect(within(row).getByText('Pick a time ›')).toHaveStyle({ fontWeight: '600', color: 'var(--tone-party-ink)' })
  })

  it('links an Open Studio row without offering a booking action', async () => {
    render(<WhatsOnCalendar />)
    const row = await rowFor('Open Studio')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/open-studio')
    expect(spaced(row.textContent)).toBe('Open StudioWalk-in · 9 AM–6 PM')
  })

  it('renders a row that cannot be tapped as a plain row', async () => {
    render(<WhatsOnCalendar />)
    const row = await rowFor('Booked · private party')
    expect(row.tagName).toBe('DIV')
    expect(row).not.toHaveAttribute('href')
    expect(spaced(row.textContent)).toBe('Booked · private party1:00 PM')
  })

  it('gives every row a tap area at least 44px tall', async () => {
    render(<WhatsOnCalendar />)
    for (const title of ['Fall Earring Bar', 'Private party times', 'Open Studio', 'Booked · private party']) {
      expect(await rowFor(title)).toHaveStyle({ minHeight: '2.75rem' })
    }
  })

  it('sets the title dark at weight 600 and keeps line two out of the kind colours', async () => {
    render(<WhatsOnCalendar />)
    const title = await screen.findByText('Fall Earring Bar')
    expect(title).toHaveStyle({ color: 'var(--color-dark)', fontWeight: '600', fontSize: '0.9375rem' })
    const meta = title.nextElementSibling as HTMLElement
    expect(meta).toHaveStyle({ color: 'var(--color-text)' })
  })

  it('orders the day by start time, earliest at the top', async () => {
    render(<WhatsOnCalendar />)
    const first = await rowFor('Fall Earring Bar')
    const titles = Array.from(first.parentElement!.children).map((row) => row.firstElementChild!.firstElementChild!.textContent)
    // 9:00 party times (party first on a tie), 9:00 open studio, 1:00 booked party, 7:00 workshop
    expect(titles).toEqual(['Private party times', 'Open Studio', 'Booked · private party', 'Fall Earring Bar'])
  })

  it('shows no emoji on party rows', async () => {
    render(<WhatsOnCalendar />)
    expect((await rowFor('Private party times')).textContent).not.toMatch(/🎉/)
    expect((await rowFor('Booked · private party')).textContent).not.toMatch(/🎉/)
  })

  it('leaves the Grand Opening row text alone', async () => {
    stubCalendarApi([{ id: 'grand-opening', kind: 'event', title: '🎉 Grand Opening (tentative)', date: '2026-10-16', bookable: false }])
    render(<WhatsOnCalendar />)
    const row = await rowFor('🎉 Grand Opening (tentative)')
    expect(row.tagName).toBe('DIV')
    expect(spaced(row.textContent)).toBe('🎉 Grand Opening (tentative)Event')
  })

  it('pads the day card 1.25rem/1.5rem on wide screens and 1rem under 550px', async () => {
    const { unmount } = render(<WhatsOnCalendar />)
    const wide = (await rowFor('Fall Earring Bar')).parentElement!.parentElement!
    expect(wide).toHaveStyle({ padding: '1.25rem 1.5rem' })
    unmount()

    stubMatchMedia(true)
    render(<WhatsOnCalendar />)
    const narrow = (await rowFor('Fall Earring Bar')).parentElement!.parentElement!
    expect(narrow).toHaveStyle({ padding: '1rem' })
  })
})

describe('WhatsOnCalendar month view', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T17:00:00.000Z'))
    stubMatchMedia(false)
    stubCalendarApi()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('makes the Open Studio chip a link and drops the emoji from the party chip', async () => {
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    const studio = await screen.findByTitle('Open Studio')
    expect(studio.tagName).toBe('A')
    expect(studio).toHaveAttribute('href', '/open-studio')

    const party = await screen.findByTitle('4 party times open')
    expect(party).toHaveAttribute('href', `/book?date=${SATURDAY}`)

    const booked = await screen.findByTitle('Booked · private party')
    expect(booked.tagName).toBe('SPAN')
  })
})
