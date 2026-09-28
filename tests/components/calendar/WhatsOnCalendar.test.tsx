import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import WhatsOnCalendar, { forgetFetchedMonths } from '@components/calendar/WhatsOnCalendar'
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

/** The events that fall in the months a request asks for (?month=YYYY-MM&months=N). */
function inAskedMonths(url: string, events: CalendarEvent[]): CalendarEvent[] {
  const q = new URLSearchParams(String(url).split('?')[1])
  const [y, m] = q.get('month')!.split('-').map(Number)
  const keys = Array.from({ length: Number(q.get('months') ?? 1) }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  return events.filter((e) => keys.includes(e.date.slice(0, 7)))
}

/** Serve the given events (October 2026 by default), month by month as asked. */
function stubCalendarApi(events: CalendarEvent[] = EVENTS, extra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({ events: inAskedMonths(url, events), ...extra }),
    }))
  )
}

const calls = () => (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))

const GRAND_OPENING: CalendarEvent = {
  id: 'grand-opening',
  kind: 'event',
  title: 'Grand Opening',
  detail: 'Doors open. Come see the studio.',
  date: '2026-10-16',
  bookable: false,
  href: '/',
}

function setUp() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T17:00:00.000Z'))
  stubMatchMedia(false)
  stubCalendarApi()
  forgetFetchedMonths()
  sessionStorage.clear()
}

function tearDown() {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
}

/** The row (link or plain) that holds a given title. */
async function rowFor(title: string): Promise<HTMLElement> {
  const el = await screen.findByText(title)
  // title span → text column → row
  return el.parentElement!.parentElement!
}

describe('WhatsOnCalendar list rows (HOM-179)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

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
    const row = await rowFor('1 party booked')
    expect(row.tagName).toBe('DIV')
    expect(row).not.toHaveAttribute('href')
    expect(spaced(row.textContent)).toBe('1 party booked1:00 PM')
  })

  it('collapses a day of booked parties into one row that cannot be tapped', async () => {
    stubCalendarApi([
      ...EVENTS,
      { id: 'party-booked-2', kind: 'party-booked', title: 'Booked · private party', date: SATURDAY, startTime: '10:30', bookable: false },
      { id: 'party-booked-3', kind: 'party-booked', title: 'Booked · private party', date: SATURDAY, startTime: '15:30', bookable: false },
    ])
    render(<WhatsOnCalendar />)
    const row = await rowFor('3 parties booked')
    expect(row.tagName).toBe('DIV')
    expect(spaced(row.textContent)).toBe('3 parties bookedfrom 10:30 AM')
    expect(screen.queryByText('Booked · private party')).toBeNull()
  })

  it('shows a sold-out workshop as a link to its panel, with "Sold out" and no "Book ›"', async () => {
    stubCalendarApi([
      { ...EVENTS[6], remainingSeats: 0, soldOut: true, bookable: false },
    ])
    render(<WhatsOnCalendar />)
    const row = await rowFor('Fall Earring Bar')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/workshops?w=abc')
    expect(spaced(row.textContent)).toBe('Fall Earring BarWorkshop · 7–9 PM · $35 · Sold out')
    expect(within(row).queryByText('Book ›')).toBeNull()
  })

  it('gives every row a tap area at least 44px tall', async () => {
    render(<WhatsOnCalendar />)
    for (const title of ['Fall Earring Bar', 'Private party times', 'Open Studio', '1 party booked']) {
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
    expect(titles).toEqual(['Private party times', 'Open Studio', '1 party booked', 'Fall Earring Bar'])
  })

  it('shows no emoji on party rows', async () => {
    render(<WhatsOnCalendar />)
    expect((await rowFor('Private party times')).textContent).not.toMatch(/🎉/)
    expect((await rowFor('1 party booked')).textContent).not.toMatch(/🎉/)
  })

  it('makes the Grand Opening a tappable row: title, then "Doors open. Come see the studio."', async () => {
    stubCalendarApi([GRAND_OPENING])
    render(<WhatsOnCalendar />)
    const row = await rowFor('Grand Opening')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/')
    expect(spaced(row.textContent)).toBe('Grand OpeningDoors open. Come see the studio.')
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
  beforeEach(setUp)
  afterEach(tearDown)

  it('makes the Open Studio chip a link and drops the emoji from the party chip', async () => {
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    const studio = await screen.findByTitle('Open Studio')
    expect(studio.tagName).toBe('A')
    expect(studio).toHaveAttribute('href', '/open-studio')

    const party = await screen.findByTitle('4 party times open')
    expect(party).toHaveAttribute('href', `/book?date=${SATURDAY}`)

    const booked = await screen.findByTitle('1 party booked')
    expect(booked.tagName).toBe('SPAN')
  })

  it('keeps an evening workshop visible on a fully booked Saturday', async () => {
    const booked = (id: string, startTime: string): CalendarEvent => ({
      id: `party-booked-${id}`,
      kind: 'party-booked',
      title: 'Booked · private party',
      date: SATURDAY,
      startTime,
      bookable: false,
    })
    stubCalendarApi([
      booked('a', '09:00'),
      booked('b', '11:30'),
      booked('c', '14:00'),
      booked('d', '16:30'),
      EVENTS[6], // the 7 PM workshop
    ])
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    const workshop = await screen.findByTitle('Fall Earring Bar')
    expect(workshop.tagName).toBe('A')
    expect(workshop).toHaveAttribute('href', '/workshops?w=abc')

    const parties = screen.getByTitle('4 parties booked')
    expect(parties.tagName).toBe('SPAN')
    expect(spaced(parties.textContent)).toBe('9am4 parties booked')
    expect(screen.queryByTitle('Booked · private party')).toBeNull()
    expect(screen.queryByText(/more$/)).toBeNull()
  })

  it('makes the Grand Opening chip a link', async () => {
    stubCalendarApi([GRAND_OPENING])
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    const chip = await screen.findByTitle('Grand Opening')
    expect(chip.tagName).toBe('A')
    expect(chip).toHaveAttribute('href', '/')
  })

  it('sets chip labels in dark text and keeps the kind colour on the edge', async () => {
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    const chip = await screen.findByTitle('Fall Earring Bar')
    expect(chip).toHaveStyle({ color: 'var(--color-dark)', background: 'var(--tone-workshop-soft)' })
    expect(chip.style.borderLeft).toBe('3px solid var(--tone-workshop)')
  })

  it('gives "Event" and "Party Available" different colours', async () => {
    stubCalendarApi([GRAND_OPENING, EVENTS[0]])
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    const event = await screen.findByTitle('Grand Opening')
    const party = await screen.findByTitle('Party available · 9:00 AM')
    expect(event.style.borderLeft).toBe('3px solid var(--tone-event)')
    expect(party.style.borderLeft).toBe('3px solid var(--tone-party)')
    expect(event.style.background).not.toBe(party.style.background)
  })

  describe('a day closed for a holiday', () => {
    const HALLOWEEN: CalendarEvent = {
      id: 'closed-2026-10-31',
      kind: 'event',
      title: 'Closed for Halloween weekend',
      detail: 'We reopen Thursday, November 5.',
      date: '2026-10-31',
      bookable: false,
      holiday: 'halloween',
    }

    async function cellFor(title: string): Promise<HTMLElement> {
      const chip = await screen.findByTitle(title)
      return chip.parentElement!
    }

    it('wears the holiday\'s colours on its chip, not the usual event colour', async () => {
      stubCalendarApi([HALLOWEEN])
      render(<WhatsOnCalendar />)
      fireEvent.click(screen.getByRole('button', { name: 'Month' }))
      const chip = await screen.findByTitle('Closed for Halloween weekend')
      expect(chip.style.borderLeft).toBe('3px solid var(--holiday-halloween)')
      expect(chip.style.background).toBe('var(--holiday-halloween-soft)')
      // The whole name shows: it runs to a second line instead of being cut.
      expect(chip.style.whiteSpace).toBe('normal')
    })

    it('stripes the day, and keeps the stripes when the day is hovered', async () => {
      stubCalendarApi([HALLOWEEN])
      render(<WhatsOnCalendar />)
      fireEvent.click(screen.getByRole('button', { name: 'Month' }))
      const cell = await cellFor('Closed for Halloween weekend')
      expect(cell.style.backgroundImage).toContain('--holiday-halloween')
      fireEvent.mouseEnter(cell)
      expect(cell.style.backgroundImage).toContain('--holiday-halloween')
      fireEvent.mouseLeave(cell)
      expect(cell.style.backgroundImage).toContain('--holiday-halloween')
    })

    it('stripes every day of the Christmas holidays like a candy cane, with or without a row on it', async () => {
      vi.setSystemTime(new Date('2026-12-01T17:00:00.000Z'))
      stubCalendarApi([])
      render(<WhatsOnCalendar />)
      // The month view opens on the current month once the opening month has passed.
      fireEvent.click(screen.getByRole('button', { name: 'Month' }))
      expect(await screen.findByText('December 2026')).toBeInTheDocument()
      const striped = Array.from(document.querySelectorAll<HTMLElement>('div')).filter((d) =>
        d.style.backgroundImage.includes('--holiday-christmas'),
      )
      expect(striped.map((d) => d.textContent?.trim().slice(0, 2))).toEqual(['21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'])
    })

    it('shows in the list in the holiday\'s colours, with the day it reopens', async () => {
      stubCalendarApi([HALLOWEEN])
      render(<WhatsOnCalendar />)
      const row = await rowFor('Closed for Halloween weekend')
      expect(row.textContent).toContain('We reopen Thursday, November 5.')
      expect(row.style.backgroundImage).toContain('--holiday-halloween')
      expect(row.tagName).toBe('DIV')
    })
  })

  it('always shows the "Closed" key, even for a month with nothing in it', async () => {
    stubCalendarApi([])
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByText("Closed")).toBeInTheDocument()
  })

  it('disables "Previous month" on the opening month and enables it after', async () => {
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    const prev = screen.getByRole('button', { name: 'Previous month' })
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(prev).toBeDisabled()
    expect(prev).toHaveAttribute('aria-disabled', 'true')
    expect(prev).toHaveStyle({ cursor: 'not-allowed' })

    fireEvent.click(prev)
    expect(screen.getByText('October 2026')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    expect(prev).toBeEnabled()
    expect(prev).toHaveAttribute('aria-disabled', 'false')

    fireEvent.click(prev)
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(prev).toBeDisabled()
  })

  it('on a phone shows a count beside the dots when a day has more than one item', async () => {
    stubMatchMedia(true)
    stubCalendarApi([
      ...EVENTS,
      { id: 'workshop-one', kind: 'workshop', title: 'Solo Night', date: '2026-10-23', startTime: '19:00', endTime: '21:00', price: 3500, currency: 'USD', bookable: true, href: '/workshops?w=one' },
    ])
    render(<WhatsOnCalendar />)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    // Saturday: party times, open studio, booked party, workshop.
    const busy = await screen.findByRole('button', { name: `${SATURDAY}, 4 items` })
    expect(within(busy).getByText('4')).toBeInTheDocument()
    expect(within(busy).queryByTitle('Fall Earring Bar')).toBeNull() // dots only, no chips

    const single = screen.getByRole('button', { name: '2026-10-23, 1 item' })
    expect(within(single).queryByText('1')).toBeNull()
  })
})

describe('WhatsOnCalendar filters (HOM-192)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  const chip = (name: string) => screen.getByRole('button', { name })
  const listTitles = () =>
    ['Fall Earring Bar', 'Private party times', '1 party booked', 'Open Studio', 'Grand Opening'].filter(
      (t) => screen.queryByText(t) !== null
    )

  beforeEach(() => stubCalendarApi([GRAND_OPENING, ...EVENTS]))

  it('offers Everything, Workshops and Party dates, with Everything chosen', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    expect(chip('Everything')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Workshops')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Party dates')).toHaveAttribute('aria-pressed', 'false')
    for (const name of ['Everything', 'Workshops', 'Party dates']) {
      expect(chip(name).tagName).toBe('BUTTON')
      expect(chip(name)).toHaveStyle({ minHeight: '2.75rem' })
    }
    expect(listTitles()).toHaveLength(5)
  })

  it('"Workshops" leaves only workshop rows', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Workshops'))
    expect(chip('Workshops')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Everything')).toHaveAttribute('aria-pressed', 'false')
    expect(listTitles()).toEqual(['Fall Earring Bar'])
  })

  it('"Party dates" leaves open party times and booked parties', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Party dates'))
    expect(listTitles()).toEqual(['Private party times', '1 party booked'])
  })

  it('filters the month grid too', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Workshops'))
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByTitle('Fall Earring Bar')).toBeInTheDocument()
    expect(screen.queryByTitle('Open Studio')).toBeNull()
    expect(screen.queryByTitle('4 party times open')).toBeNull()
    expect(screen.queryByTitle('1 party booked')).toBeNull()
    expect(screen.queryByTitle('Grand Opening')).toBeNull()

    fireEvent.click(chip('Party dates'))
    expect(screen.queryByTitle('Fall Earring Bar')).toBeNull()
    expect(screen.getByTitle('4 party times open')).toBeInTheDocument()
    expect(screen.getByTitle('1 party booked')).toBeInTheDocument()
  })

  it('does not ask the server again when the filter changes', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Workshops'))
    fireEvent.click(chip('Party dates'))
    fireEvent.click(chip('Everything'))
    expect(calls()).toHaveLength(1)
  })

  it('remembers the choice for the visit', async () => {
    const { unmount } = render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Party dates'))
    unmount()

    render(<WhatsOnCalendar />)
    await rowFor('Private party times')
    expect(chip('Party dates')).toHaveAttribute('aria-pressed', 'true')
    expect(listTitles()).toEqual(['Private party times', '1 party booked'])
  })

  it('ignores a remembered value it does not know', async () => {
    sessionStorage.setItem('calendar-filter', 'kits')
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    expect(chip('Everything')).toHaveAttribute('aria-pressed', 'true')
  })

  it('still works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(chip('Workshops'))
    expect(chip('Workshops')).toHaveAttribute('aria-pressed', 'true')
    expect(listTitles()).toEqual(['Fall Earring Bar'])
  })

  it('says so when the filter leaves nothing, and offers the way back', async () => {
    stubCalendarApi(EVENTS.filter((e) => e.kind !== 'workshop'))
    render(<WhatsOnCalendar />)
    await rowFor('Private party times')
    fireEvent.click(chip('Workshops'))
    expect(screen.getByText('No workshops on the calendar yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing scheduled yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }))
    expect(chip('Everything')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Private party times')).toBeInTheDocument()
  })
})

describe('WhatsOnCalendar when loading goes wrong (HOM-192)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  // Typographic apostrophes, as everywhere else on the site.
  const FAILED = 'We couldn’t load the calendar just now.'
  const PARTIAL = 'Some of the calendar didn’t load. Try again in a minute.'

  /** Answer each request in turn from the list; the last answer repeats. */
  function stubAnswers(...answers: Array<'network' | number | Record<string, unknown>>) {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const a = answers[Math.min(n++, answers.length - 1)]
        if (a === 'network') throw new TypeError('Failed to fetch')
        if (typeof a === 'number') return { ok: false, status: a, json: async () => ({}) }
        return { ok: true, json: async () => ({ ...a, events: inAskedMonths(url, (a.events as CalendarEvent[]) ?? []) }) }
      })
    )
  }

  for (const [what, answer] of [['the network fails', 'network'], ['the server answers 500', 500]] as const) {
    it(`says it could not load when ${what}, never "nothing scheduled"`, async () => {
      stubAnswers(answer)
      render(<WhatsOnCalendar />)
      expect(await screen.findByText(FAILED)).toBeInTheDocument()
      expect(screen.queryByText(/Nothing scheduled yet/)).toBeNull()
      expect(screen.queryByText(/Nothing further scheduled/)).toBeNull()

      const retry = screen.getByRole('button', { name: 'Try again' })
      expect(retry).toHaveClass('btn', 'btn-secondary')
      expect(screen.getByRole('link', { name: 'See workshops' })).toHaveAttribute('href', '/workshops')
      expect(screen.getByRole('link', { name: 'Book a party' })).toHaveAttribute('href', '/book')
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
    })
  }

  it('"Try again" asks again and shows the calendar when it arrives', async () => {
    stubAnswers(500, { events: EVENTS })
    render(<WhatsOnCalendar />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Fall Earring Bar')).toBeInTheDocument()
    expect(screen.queryByText(FAILED)).toBeNull()
    expect(calls()).toEqual([
      '/api/calendar.json?month=2026-10&months=3',
      '/api/calendar.json?month=2026-10&months=3',
    ])
  })

  it('shows what did arrive, with a warning, when part of the calendar is missing', async () => {
    stubAnswers({ events: EVENTS, incomplete: true })
    render(<WhatsOnCalendar />)
    expect(await screen.findByText('Fall Earring Bar')).toBeInTheDocument()
    expect(screen.getByText(PARTIAL)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('btn', 'btn-secondary')
    expect(screen.queryByText(FAILED)).toBeNull()
  })

  it('puts the warning above the events', async () => {
    stubAnswers({ events: EVENTS, incomplete: true })
    render(<WhatsOnCalendar />)
    const row = await rowFor('Fall Earring Bar')
    const warning = screen.getByText(PARTIAL)
    expect(warning.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('warns, rather than saying "nothing scheduled", when a partial answer is empty', async () => {
    stubAnswers({ events: [], incomplete: true })
    render(<WhatsOnCalendar />)
    expect(await screen.findByText(PARTIAL)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing scheduled yet/)).toBeNull()
  })

  it('"Try again" after a partial answer really asks again, and drops the warning once whole', async () => {
    stubAnswers({ events: EVENTS.slice(0, 6), incomplete: true }, { events: EVENTS })
    render(<WhatsOnCalendar />)
    await rowFor('Private party times')
    expect(screen.queryByText('Fall Earring Bar')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Fall Earring Bar')).toBeInTheDocument()
    expect(screen.queryByText(PARTIAL)).toBeNull()
    expect(calls()).toHaveLength(2)
  })

  it('does not treat a partial month as fetched: the month grid asks again', async () => {
    stubAnswers({ events: EVENTS.slice(0, 6), incomplete: true }, { events: EVENTS })
    render(<WhatsOnCalendar />)
    await rowFor('Private party times')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByTitle('Fall Earring Bar')).toBeInTheDocument()
    expect(calls()).toEqual(['/api/calendar.json?month=2026-10&months=3', '/api/calendar.json?month=2026-10'])
    expect(screen.queryByText(PARTIAL)).toBeNull()
  })

  it('says so in the month grid too, and "Try again" reloads the month', async () => {
    stubAnswers({ events: EVENTS }, 'network', { events: [] })
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    // October came with the list; January has to be asked for.
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByText(FAILED)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await vi.waitFor(() => expect(screen.queryByText(FAILED)).toBeNull())
    expect(calls().slice(1)).toEqual(['/api/calendar.json?month=2027-01', '/api/calendar.json?month=2027-01'])
  })

  it('keeps the list on screen when "Show more" fails', async () => {
    stubAnswers({ events: EVENTS }, 503)
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText(FAILED)).toBeInTheDocument()
    expect(screen.getByText('Fall Earring Bar')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing further scheduled/)).toBeNull()
  })
})

describe('WhatsOnCalendar "Show more" (HOM-192)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  const JANUARY_PARTY: CalendarEvent = {
    id: 'party-available-jan',
    kind: 'party-available',
    title: 'Party available · 9:00 AM',
    date: '2027-01-09',
    startTime: '09:00',
    bookable: true,
    href: '/book?start=jan',
  }

  it('swaps the button for "Nothing further scheduled yet." after a month that adds nothing', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Nothing further scheduled yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show more|Loading/ })).toBeNull()
    // One extra month was asked for, and it stops there.
    expect(calls()).toEqual(['/api/calendar.json?month=2026-10&months=3', '/api/calendar.json?month=2027-01'])
  })

  it('keeps the button while months keep adding something', async () => {
    stubCalendarApi([...EVENTS, JANUARY_PARTY])
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    await vi.waitFor(() => expect(screen.getAllByText('Private party times')).toHaveLength(2))
    expect(screen.getByRole('button', { name: /Show more/ })).toBeEnabled()
    expect(screen.queryByText('Nothing further scheduled yet.')).toBeNull()
  })

  it('judges "adds nothing" by what the filter shows', async () => {
    stubCalendarApi([...EVENTS, JANUARY_PARTY])
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: 'Workshops' }))
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Nothing further scheduled yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    expect(screen.queryByText('Nothing further scheduled yet.')).toBeNull()
    expect(screen.getByRole('button', { name: /Show more/ })).toBeInTheDocument()
  })
})

describe('WhatsOnCalendar loading', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('asks for the whole list in one request', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    expect(calls()).toEqual(['/api/calendar.json?month=2026-10&months=3'])
  })

  it('says it is loading before anything arrives, never "nothing scheduled"', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    render(<WhatsOnCalendar />)
    expect(screen.getByRole('status', { name: 'Loading the calendar' })).toBeInTheDocument()
    expect(screen.queryByText(/Nothing scheduled yet/)).toBeNull()
  })

  it('says nothing is scheduled only once it knows', async () => {
    stubCalendarApi([])
    render(<WhatsOnCalendar />)
    expect(await screen.findByText(/Nothing scheduled yet/)).toBeInTheDocument()
  })

  it('opens the month grid from what the list already fetched, without asking again', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByTitle('Open Studio')).toBeInTheDocument()
    expect(calls()).toHaveLength(1)
  })

  it('"Show more" asks only for the month it does not have', async () => {
    render(<WhatsOnCalendar />)
    await rowFor('Fall Earring Bar')
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    await vi.waitFor(() => expect(calls()).toHaveLength(2))
    expect(calls()[1]).toBe('/api/calendar.json?month=2027-01')
  })
})
