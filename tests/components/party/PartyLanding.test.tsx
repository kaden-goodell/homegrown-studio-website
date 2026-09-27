import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { partyConfig } from '@config/party.config'
import { formatMoney } from '@lib/money'

// The booking panel is someone else's work in progress: stand in for it, and
// show the props the page hands over.
vi.mock('@components/party/PartyModal', () => ({
  default: (props: { onClose: () => void; initialStart?: string; initialCraftId?: string; initialDate?: string }) => (
    <div
      data-testid="party-modal"
      data-craft={props.initialCraftId ?? ''}
      data-date={props.initialDate ?? ''}
      data-start={props.initialStart ?? ''}
    >
      <button type="button" onClick={props.onClose}>Close panel</button>
    </div>
  ),
}))

vi.mock('@components/shared/NotifyMe', () => ({
  default: (props: { interest: string }) => <div data-testid="notify-me" data-interest={props.interest} />,
}))

import PartyLanding, {
  PartyPriceLine,
  craftDescriptionStyle,
  feeShareLine,
  lowestCraftCents,
  partyPriceLine,
  resetServiceInfoCache,
} from '@components/party/PartyLanding'

const FEE = formatMoney(partyConfig.basePriceCents)

const CRAFTS = [
  { id: 'KEY', name: 'Bubble Letter Keychains', perHeadCents: 2000, perHeadMaxCents: 2000, description: 'Spell any word in chunky bubble letters.', imageUrl: null, popular: true },
  { id: 'BLING', name: 'Bedazzle & Bling', perHeadCents: 1500, perHeadMaxCents: 1500, description: 'Cover it in rhinestones.', imageUrl: null },
  { id: 'TOTE', name: 'Patch Totes', perHeadCents: 2500, perHeadMaxCents: 3250, description: '', imageUrl: null },
]

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

/** Answers the page's two requests. `null` makes that request fail. */
function mockApi({ crafts = CRAFTS, dates = ['2026-10-17', '2026-10-18'] }: { crafts?: typeof CRAFTS | null; dates?: string[] | null } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/party/service-info.json')) {
      return crafts === null ? json({ error: 'nope' }, false) : json({ data: { crafts, variationId: 'VAR' } })
    }
    if (url.includes('/api/party/available-dates.json')) {
      return dates === null ? json({ error: 'nope' }, false) : json({ data: { dates } })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

/** A booking link that lives outside the React island, like the hero button or the site header. */
function outsideLink(attrs: Record<string, string> = { 'data-open-booking': '' }) {
  const a = document.createElement('a')
  a.href = '/book'
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  const label = document.createElement('span')
  label.textContent = 'Book your date'
  a.appendChild(label)
  document.body.appendChild(a)
  return { link: a, label }
}

/** Waits for the page's two requests to land, so nothing updates after a test has ended. */
async function settled() {
  await waitFor(() => expect(document.querySelector('#open-dates [role="status"]')).toBeNull())
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetServiceInfoCache()
  window.history.replaceState({}, '', '/book')
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('the price line', () => {
  it('takes the lowest craft price from the craft list', () => {
    expect(lowestCraftCents(CRAFTS)).toBe(1500)
    expect(lowestCraftCents([])).toBeNull()
  })

  it('names the fee and the lowest craft price', () => {
    expect(partyPriceLine(1500)).toBe(
      `${FEE} today holds your date. Crafts from $15 a person, paid at the studio for whoever comes.`,
    )
  })

  it('keeps cents when the lowest craft is not a whole dollar', () => {
    expect(partyPriceLine(1250)).toContain('Crafts from $12.50 a person')
  })

  it('leaves the craft price out, rather than guess, when the list has not loaded', () => {
    expect(partyPriceLine(null)).toBe(`${FEE} today holds your date. Crafts are paid at the studio for whoever comes.`)
  })

  it('shows the sentence without a craft price first, then fills it in', async () => {
    mockApi()
    render(<PartyPriceLine />)
    expect(screen.getByText(`${FEE} today holds your date. Crafts are paid at the studio for whoever comes.`)).toBeInTheDocument()
    expect(
      await screen.findByText(`${FEE} today holds your date. Crafts from $15 a person, paid at the studio for whoever comes.`),
    ).toBeInTheDocument()
  })

  it('stays without a craft price when the craft list fails to load', async () => {
    const fetchSpy = mockApi({ crafts: null })
    render(<PartyPriceLine />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.getByText(`${FEE} today holds your date. Crafts are paid at the studio for whoever comes.`)).toBeInTheDocument()
    expect(screen.queryByText(/Crafts from/)).not.toBeInTheDocument()
  })

  it('asks for the craft list once, however many places show it', async () => {
    const fetchSpy = mockApi()
    render(
      <>
        <PartyPriceLine />
        <PartyLanding />
        <PartyPriceLine />
      </>,
    )
    await screen.findByRole('heading', { name: 'Pick your craft' })
    const craftRequests = fetchSpy.mock.calls.filter(([input]) => String(input).includes('service-info.json'))
    expect(craftRequests).toHaveLength(1)
  })
})

describe('the studio fee per person', () => {
  it('is computed from the fee and the example party size', () => {
    expect(feeShareLine(30000, 12)).toBe(
      'For a party of 12, the studio fee works out to $25 each, plus the craft you choose.',
    )
  })

  it('says "about" and rounds to the dollar when it does not divide evenly', () => {
    expect(feeShareLine(30000, 13)).toBe(
      'For a party of 13, the studio fee works out to about $23 each, plus the craft you choose.',
    )
  })

  it('replaces the old "$25 a person for a completely private studio" sentence', async () => {
    mockApi()
    render(<PartyLanding />)
    expect(screen.getByText(new RegExp(feeShareLine().replace(/[$.]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/a person for a completely private studio/)).not.toBeInTheDocument()
    await settled()
  })
})

describe('opening the booking panel', () => {
  it('opens from any [data-open-booking] element on the page, and stops the link', async () => {
    mockApi()
    render(<PartyLanding />)
    const { label } = outsideLink()
    expect(screen.queryByTestId('party-modal')).not.toBeInTheDocument()

    const notPrevented = fireEvent.click(label)

    expect(notPrevented).toBe(false)
    const modal = await screen.findByTestId('party-modal')
    expect(modal).toHaveAttribute('data-craft', '')
    expect(modal).toHaveAttribute('data-date', '')
    expect(modal).toHaveAttribute('data-start', '')
  })

  it('leaves other links alone', async () => {
    mockApi()
    render(<PartyLanding />)
    const { label } = outsideLink({ 'data-something-else': '' })

    const notPrevented = fireEvent.click(label)

    expect(notPrevented).toBe(true)
    expect(screen.queryByTestId('party-modal')).not.toBeInTheDocument()
    await settled()
  })

  it('lets a new-tab click through', async () => {
    mockApi()
    render(<PartyLanding />)
    const { label } = outsideLink()

    expect(fireEvent.click(label, { metaKey: true })).toBe(true)
    expect(fireEvent.click(label, { ctrlKey: true })).toBe(true)
    expect(screen.queryByTestId('party-modal')).not.toBeInTheDocument()
    await settled()
  })

  it('stops listening once the page is gone', () => {
    mockApi()
    const { unmount } = render(<PartyLanding />)
    const { label } = outsideLink()
    unmount()

    expect(fireEvent.click(label)).toBe(true)
  })

  it('adds one listener, not one per render', async () => {
    mockApi()
    const addSpy = vi.spyOn(document, 'addEventListener')
    render(<PartyLanding />)
    await screen.findByRole('heading', { name: 'Pick your craft' })
    await screen.findByRole('button', { name: 'Sat, Oct 17' })

    expect(addSpy.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1)
  })

  it('opens again after the panel is closed', async () => {
    mockApi()
    render(<PartyLanding />)
    const { label } = outsideLink()

    fireEvent.click(label)
    fireEvent.click(await screen.findByRole('button', { name: 'Close panel' }))
    expect(screen.queryByTestId('party-modal')).not.toBeInTheDocument()
    fireEvent.click(label)

    expect(await screen.findByTestId('party-modal')).toBeInTheDocument()
  })

  it('hands the craft to the panel when a craft card is chosen', async () => {
    mockApi()
    render(<PartyLanding />)

    fireEvent.click(await screen.findByRole('button', { name: /Bedazzle & Bling.*Book this craft/ }))

    expect(await screen.findByTestId('party-modal')).toHaveAttribute('data-craft', 'BLING')
  })

  it('hands the date to the panel when an open date is chosen', async () => {
    mockApi()
    render(<PartyLanding />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sat, Oct 17' }))

    expect(await screen.findByTestId('party-modal')).toHaveAttribute('data-date', '2026-10-17')
  })

  it('opens on a shared craft link (?craft=)', async () => {
    window.history.replaceState({}, '', '/book?craft=KEY')
    mockApi()
    render(<PartyLanding />)

    expect(await screen.findByTestId('party-modal')).toHaveAttribute('data-craft', 'KEY')
  })

  it('opens on a calendar day (?date=) and a calendar time (?start=)', async () => {
    window.history.replaceState({}, '', '/book?date=2026-10-24')
    mockApi()
    const first = render(<PartyLanding />)
    expect(await screen.findByTestId('party-modal')).toHaveAttribute('data-date', '2026-10-24')
    first.unmount()

    window.history.replaceState({}, '', '/book?start=2026-10-24T14:00:00.000Z&date=2026-10-24')
    render(<PartyLanding />)
    const modal = await screen.findByTestId('party-modal')
    expect(modal).toHaveAttribute('data-start', '2026-10-24T14:00:00.000Z')
    expect(modal).toHaveAttribute('data-date', '')
  })

  it('has no outlined "start a booking" duplicate', async () => {
    mockApi()
    render(<PartyLanding />)
    await screen.findByRole('heading', { name: 'Pick your craft' })

    expect(screen.queryByRole('button', { name: /start a booking/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Book a Party' })).not.toBeInTheDocument()
  })
})

describe('open dates', () => {
  it('is on the page from the first render, with a loading state', async () => {
    mockApi()
    const { container } = render(<PartyLanding />)

    const section = container.querySelector('#open-dates') as HTMLElement
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('Next open dates')
    expect(section.querySelector('[role="status"]')).toHaveTextContent('Checking open dates')
    await settled()
  })

  it('stops short of the sticky header when scrolled to', async () => {
    mockApi()
    const { container } = render(<PartyLanding />)

    const section = container.querySelector('#open-dates') as HTMLElement
    expect(section.style.scrollMarginTop).not.toBe('')
    await settled()
  })

  it('lists the open dates and counts them against the booking window', async () => {
    mockApi()
    const { container } = render(<PartyLanding />)

    expect(await screen.findByRole('button', { name: 'Sat, Oct 17' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sun, Oct 18' })).toBeInTheDocument()
    const section = container.querySelector('#open-dates') as HTMLElement
    expect(section).toHaveTextContent(`2 dates open in the next ${partyConfig.bookingWindowDays} days`)
    expect(section.querySelector('[role="status"]')).toBeNull()
    expect(screen.queryByTestId('notify-me')).not.toBeInTheDocument()
  })

  it('says so when nothing is open, and offers the email sign-up', async () => {
    mockApi({ dates: [] })
    const { container } = render(<PartyLanding />)

    const notify = await screen.findByTestId('notify-me')
    expect(notify).toHaveAttribute('data-interest', 'party:more-dates')
    const section = container.querySelector('#open-dates') as HTMLElement
    expect(section).toContainElement(notify)
    expect(section).toHaveTextContent(
      `No open dates in the next ${partyConfig.bookingWindowDays} days. Leave your email and we’ll tell you when more open.`,
    )
  })

  it('does not claim "no open dates" when the dates could not be loaded', async () => {
    mockApi({ dates: null })
    const { container } = render(<PartyLanding />)

    const section = container.querySelector('#open-dates') as HTMLElement
    await waitFor(() => expect(section.querySelector('[role="status"]')).toBeNull())
    expect(section).not.toHaveTextContent('No open dates')
    expect(section).toHaveTextContent('We couldn’t load the open dates')
    expect(screen.queryByTestId('notify-me')).not.toBeInTheDocument()
  })

  it('does not claim "no open dates" when the craft list could not be loaded either', async () => {
    mockApi({ crafts: null })
    const { container } = render(<PartyLanding />)

    const section = container.querySelector('#open-dates') as HTMLElement
    await waitFor(() => expect(section.querySelector('[role="status"]')).toBeNull())
    expect(section).not.toHaveTextContent('No open dates')
    expect(section).toHaveTextContent('We couldn’t load the open dates')
  })
})

describe('craft cards', () => {
  it('clamps the description to four lines at a fixed height', async () => {
    mockApi()
    render(<PartyLanding />)

    const description = await screen.findByText('Cover it in rhinestones.')
    expect(craftDescriptionStyle.WebkitLineClamp).toBe(4)
    expect(craftDescriptionStyle.lineHeight).toBe(1.5)
    // four lines of 1.5 = 6em, whether the copy is one line or ten
    expect(description.style.height).toBe('6em')
    expect(description.style.overflow).toBe('hidden')
  })

  it('shows whole-dollar prices without cents, and ranges when a craft has one', async () => {
    mockApi()
    render(<PartyLanding />)

    await screen.findByRole('heading', { name: 'Pick your craft' })
    expect(screen.getByText('$20/person')).toBeInTheDocument()
    expect(screen.getByText('$15/person')).toBeInTheDocument()
    expect(screen.getByText('$25–$32.50/person')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$\d+\.00/)
  })
})

describe('headings', () => {
  it('are in sentence case', async () => {
    mockApi()
    render(<PartyLanding />)

    expect(await screen.findByRole('heading', { name: 'Pick your craft' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Next open dates' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The whole studio is yours' })).toBeInTheDocument()
  })

  it('names the studio fee from config in "How it works"', async () => {
    mockApi()
    render(<PartyLanding />)

    expect(screen.getByText(`Pay the ${FEE} studio fee — the date is yours`)).toBeInTheDocument()
    await settled()
  })
})
