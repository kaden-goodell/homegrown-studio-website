import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PartyDashboard from '@components/party/PartyDashboard'

interface Group {
  signer: string
  children: { name: string; allergies: string }[]
  adultAllergies?: string
  attending: string[]
}

function roster(groups: Group[], extra: Record<string, unknown> = {}) {
  return {
    data: {
      party: {
        craftName: 'Tote Bag',
        startIso: '2026-10-17T15:00:00-05:00',
        durationMinutes: 90,
        hostName: 'Host Person',
        guestCount: 10,
        title: null,
        ...extra,
      },
      summary: { households: groups.length, people: groups.reduce((n, g) => n + g.attending.length, 0) },
      households: groups.map((g) => ({
        adultAllergies: '',
        ...g,
        childCount: g.children.length,
        attendingCount: g.attending.length,
      })),
    },
  }
}

/** The dashboard only ever reads: one GET for the roster. */
async function show(groups: Group[], extra: Record<string, unknown> = {}, waitFor = 'Who’s crafting') {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => roster(groups, extra) })
  vi.stubGlobal('fetch', fetchMock)
  const view = render(<PartyDashboard bookingId="bk-1" hostKey="key-1" />)
  await screen.findByText(waitFor)
  return { ...view, fetchMock }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PartyDashboard wording', () => {
  it('counts the people a group is bringing as guests', async () => {
    await show([
      {
        signer: 'Dana Smith',
        children: [
          { name: 'Ava Smith', allergies: '' },
          { name: 'Ben Smith', allergies: '' },
        ],
        attending: ['adult', 'child:0', 'child:1'],
      },
    ])
    expect(screen.getByText('Dana + 2 guests')).toBeInTheDocument()
  })

  it('says "1 guest" for one', async () => {
    await show([
      { signer: 'Dana Smith', children: [{ name: 'Ava Smith', allergies: '' }], attending: ['adult', 'child:0'] },
    ])
    expect(screen.getByText('Dana + 1 guest')).toBeInTheDocument()
  })

  it('leaves the signer out when they are not crafting', async () => {
    await show([
      {
        signer: 'Dana Smith',
        children: [
          { name: 'Ava Smith', allergies: '' },
          { name: 'Ben Smith', allergies: '' },
        ],
        attending: ['child:0', 'child:1'],
      },
    ])
    expect(screen.getByText('2 guests')).toBeInTheDocument()
  })

  it('never calls anyone a kid', async () => {
    const { container } = await show([
      {
        signer: 'Dana Smith',
        children: [
          { name: 'Ava Smith', allergies: 'latex' },
          { name: 'Ben Smith', allergies: '' },
        ],
        adultAllergies: 'wool',
        attending: ['adult', 'child:0'],
      },
      { signer: 'Lee Jones', children: [], attending: ['adult'] },
    ])
    expect(container.textContent).not.toMatch(/\bkids?\b/i)
  })

  it('labels allergies in words', async () => {
    await show([
      {
        signer: 'Dana Smith',
        children: [{ name: 'Ava Smith', allergies: 'latex' }],
        adultAllergies: 'wool',
        attending: ['adult', 'child:0'],
      },
    ])
    expect(screen.getByText('Allergy: Dana: wool')).toBeInTheDocument()
    expect(screen.getByText('Allergy: Ava: latex')).toBeInTheDocument()
  })

  it('uses plain words on its buttons: no emoji or symbols', async () => {
    const { container } = await show([])
    expect(screen.getByRole('button', { name: 'Invite your guests' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Google Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apple / Outlook' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Email your guests' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh roster' })).toHaveTextContent(/^Refresh$/)
    // The agreement button's label comes from waiver-content.ts, which has its
    // own copy rules; everything else on the page is the dashboard's.
    const own = container.cloneNode(true) as HTMLElement
    own.querySelector('a[href*="/waiver"]')?.remove()
    expect(own.textContent).not.toMatch(/[←-⇿☀-➿\u{1F300}-\u{1FAFF}]/u)
  })

  it('only reads: the roster is fetched with GET', async () => {
    const { fetchMock } = await show([])
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain('/api/party/roster.json?party=bk-1&key=key-1')
      expect(init?.method ?? 'GET').toBe('GET')
    }
  })
})

describe('PartyDashboard: our party records', () => {
  const icsOf = (container: HTMLElement) => decodeURIComponent((container.querySelector('a[download]') as HTMLAnchorElement).href.split(',')[1])

  it('a cancelled party says so, with no invite, calendar or RSVP buttons', async () => {
    await show([], { cancelled: true }, 'This party was cancelled.')
    expect(screen.queryByRole('button', { name: 'Invite your guests' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Apple / Outlook' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Email your guests' })).toBeNull()
    expect(document.querySelector('a[href*="/waiver"]')).toBeNull()
    expect(screen.queryByText(/still to pay/)).toBeNull()
    // Which party (a host may have two), and where to ask about a payment.
    expect(screen.getByTestId('party-when')).toHaveTextContent(/CT$/)
    expect(screen.getByText(/Questions, or about a payment\?/)).toBeInTheDocument()
  })

  it('shows the party’s end with its extra time', async () => {
    await show([], { startIso: '2026-10-17T20:00:00Z', endIso: '2026-10-17T22:00:00Z' })
    expect(screen.getByTestId('party-when')).toHaveTextContent('Sat, Oct 17 · 3–5 PM CT')
  })

  it('studio fee due: a pay link that says what it is for, never crafts', async () => {
    await show([], { pay: { cents: 30000, what: 'the studio fee', url: 'https://x.test/party/pay/pty_1?k=pay' } })
    expect(screen.getByText('There’s $300 still to pay for the studio fee.')).toBeInTheDocument()
    expect(screen.getByText('Crafts are paid at the studio for whoever comes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pay $300' })).toHaveAttribute('href', 'https://x.test/party/pay/pty_1?k=pay')
  })

  it('nothing due: no pay link', async () => {
    await show([], { pay: null })
    expect(screen.queryByRole('link', { name: /^Pay / })).toBeNull()
  })

  it('the Apple / Outlook file keeps one id across moves (booking id + sequence), so it replaces the old event', async () => {
    const first = await show([], { startIso: '2026-10-17T20:00:00Z', calendarSeq: 0 })
    const a = icsOf(first.container)
    cleanup()
    const moved = await show([], { startIso: '2026-10-18T19:00:00Z', calendarSeq: 1 })
    const b = icsOf(moved.container)
    expect(a).toContain('UID:party-bk-1@ourhometownstudio.com')
    expect(b).toContain('UID:party-bk-1@ourhometownstudio.com')
    expect(a).toContain('SEQUENCE:0')
    expect(b).toContain('SEQUENCE:1')
    expect(b).toContain('DTSTART:20261018T190000Z')
  })
})
