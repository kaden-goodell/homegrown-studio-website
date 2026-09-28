import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PartyDashboard from '@components/party/PartyDashboard'

interface Group {
  signer: string
  children: { name: string; allergies: string }[]
  adultAllergies?: string
  attending: string[]
}

function roster(groups: Group[]) {
  return {
    data: {
      party: {
        craftName: 'Tote Bag',
        startIso: '2026-10-17T15:00:00-05:00',
        durationMinutes: 90,
        hostName: 'Host Person',
        guestCount: 10,
        title: null,
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
async function show(groups: Group[]) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => roster(groups) })
  vi.stubGlobal('fetch', fetchMock)
  const view = render(<PartyDashboard bookingId="bk-1" hostKey="key-1" />)
  await screen.findByText('Who’s crafting')
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
