/**
 * Roster screen — the two things the Chrome walkthrough caught:
 *  - I2: switching days on a multi-day roster carried the previous day's
 *    check-in selection over, because the cards were keyed by record alone.
 *  - F3: a roster with no RSVPs yet rendered nothing at all under the header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import Roster from '@components/staff/Roster'
import type { StaffMember } from '@lib/staff-auth'

const staff: StaffMember = { id: 't', name: 'Test', role: 'crew' }

function household(overrides: Record<string, any> = {}) {
  return {
    recordId: 'wvr_1',
    signer: 'Jamie Rivera',
    phone: '2565550199',
    email: 'jamie@x.com',
    children: [{ name: 'Kiddo Rivera', allergies: '', medications: '' }],
    childCount: 1,
    adultAllergies: '',
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: [],
    notAuthorized: '',
    responsibleAdult: '',
    photoConsent: true,
    signedAt: '2026-08-01T00:00:00.000Z',
    agreementVersion: 'v3',
    validUntil: '2027-08-01T00:00:00.000Z',
    checkin: {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      notAuthorized: '',
      hasPickupCode: false,
      codeAttempts: 0,
      locked: false,
      releasedTo: {},
    },
    ...overrides,
  }
}

const CAMP = {
  kind: 'workshop',
  id: 'cs-camp',
  title: 'Fall Camp',
  startIso: '2026-10-20T15:00:00.000Z',
  days: ['2026-10-20', '2026-10-21'],
  dropOff: true,
}

/** Serve roster.json per requested `day`, and an empty incidents list. */
function mockRoster(households: any[], event: any = CAMP) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const href = String(url)
    if (href.includes('/api/staff/incidents.json')) {
      return { ok: true, json: async () => ({ data: { incidents: [] } }) } as Response
    }
    const day = new URL(href, 'http://localhost').searchParams.get('day') ?? event.days[0]
    return {
      ok: true,
      json: async () => ({
        data: {
          event,
          day,
          summary: { households: households.length, people: households.length * 2, childrenHereNow: 0 },
          capWarning: false,
          households,
        },
      }),
    } as Response
  })
}

function renderRoster() {
  return render(
    <Roster
      staff={staff}
      onSwitch={vi.fn()}
      onKits={vi.fn()}
      onLogout={vi.fn()}
      onBack={vi.fn()}
      kind="workshop"
      id="cs-camp"
    />,
  )
}

describe('Roster', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('I2: switching days re-derives each household card instead of carrying the selection over', async () => {
    mockRoster([household()])
    const { container } = renderRoster()
    await screen.findAllByText('Jamie Rivera')

    // Nobody is here yet, so both people show a (checked) check-in box.
    const boxesDay1 = container.querySelectorAll('input[type="checkbox"]')
    expect(boxesDay1).toHaveLength(2)
    expect((boxesDay1[0] as HTMLInputElement).checked).toBe(true)

    // Staff uncheck the adult on day 1 — that's a day-1 decision.
    fireEvent.click(boxesDay1[0])
    expect((container.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).checked).toBe(false)

    // Switch to day 2 of the camp.
    await act(async () => {
      fireEvent.click(screen.getByText(/21$/))
    })

    await waitFor(() => {
      const boxesDay2 = container.querySelectorAll('input[type="checkbox"]')
      expect((boxesDay2[0] as HTMLInputElement).checked).toBe(true)
    })
  })

  it('F3: an empty roster says so, and a drop-off event shows the link to send', async () => {
    mockRoster([])
    renderRoster()

    await screen.findByText(/No RSVPs yet/)
    expect(screen.getByText(/anyone who signs the agreement for this event will appear here/)).toBeInTheDocument()
    expect(screen.getByText(/\/waiver\?workshop=cs-camp/)).toBeInTheDocument()
  })

  it('F3: a non-drop-off empty roster shows the empty state without the link line', async () => {
    mockRoster([], { ...CAMP, dropOff: false })
    renderRoster()

    await screen.findByText(/No RSVPs yet/)
    expect(screen.queryByText(/\/waiver\?workshop=/)).not.toBeInTheDocument()
  })

  it('every roster has a "+ Add family" button that opens the door search for THIS event', async () => {
    mockRoster([household()], { ...CAMP, dropOff: false })
    renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.queryByRole('dialog', { name: /Add a family/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add family' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add a family to Fall Camp' })
    expect(within(sheet).getByPlaceholderText('Phone, email or last name')).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: /Add a family/ })).not.toBeInTheDocument()
  })

  it('a drop-off roster has it too, and shows the drop-off banner; a non-drop-off one does not', async () => {
    mockRoster([household()])
    const { unmount } = renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.getByRole('button', { name: '+ Add family' })).toBeInTheDocument()
    expect(screen.getByText(/DROP-OFF EVENT/)).toBeInTheDocument()
    unmount()

    vi.restoreAllMocks()
    mockRoster([household()], { ...CAMP, dropOff: false })
    renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.getByRole('button', { name: '+ Add family' })).toBeInTheDocument()
    expect(screen.queryByText(/DROP-OFF EVENT/)).not.toBeInTheDocument()
  })

  it('a non-drop-off roster card is attendance-only (✓ Here, no check-out)', async () => {
    mockRoster([household()], { ...CAMP, dropOff: false })
    renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.getByRole('button', { name: '✓ Here (2)' })).toBeInTheDocument()
    expect(screen.getByText(/Not here yet/)).toBeInTheDocument()
    expect(screen.queryByText(/Check out|Collected by/i)).not.toBeInTheDocument()
  })

  it('opens the sheet on arrival with the household already found (Today\'s event chip)', async () => {
    mockRoster([], { ...CAMP, dropOff: false })
    const found = {
      recordId: 'wvr_9', firstName: 'Sam', lastName: 'Lee', contactHint: '••• 0142', signedAt: '2026-08-01T00:00:00.000Z',
      agreementVersion: 'v3', validUntil: '2027-08-01T00:00:00.000Z', covered: true, kids: [{ name: 'Mia Lee', allergies: '' }],
      adultAllergies: '', photoConsent: true, openStudioToday: false,
    }
    render(
      <Roster staff={staff} onSwitch={vi.fn()} onKits={vi.fn()} onLogout={vi.fn()} onBack={vi.fn()} kind="workshop" id="cs-camp" addFamily={{ household: found }} />,
    )
    const sheet = await screen.findByRole('dialog', { name: 'Add a family to Fall Camp' })
    expect(within(sheet).getByText(/GOOD TO GO — Sam Lee/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: '✓ Add & mark here' })).toBeInTheDocument()
  })

  it('the "n with allergies" summary ignores "None" answers', async () => {
    mockRoster([
      household({ children: [{ name: 'A', allergies: 'None', medications: '' }], adultAllergies: 'n/a' }),
      household({ recordId: 'wvr_2', signer: 'Pat Lee', children: [{ name: 'B', allergies: 'peanuts', medications: '' }] }),
    ], { ...CAMP, dropOff: false })
    renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.getByText('⚠ 1 with allergies')).toBeInTheDocument()
  })
})
