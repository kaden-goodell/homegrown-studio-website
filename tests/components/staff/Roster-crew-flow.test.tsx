/**
 * Crew review (final, 2 Nov 2026): the roster at a busy start.
 *  I1 families first, money folded away below
 *  I2 booked-but-unsigned and expired/older agreements get a next step
 *  I3 "No one here matches" leads straight to Add / Sell / Comp
 *  I10 party rosters say what to ring up at the end
 *  M2 one post per tap
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import Roster from '@components/staff/Roster'
import type { StaffMember } from '@lib/staff-auth'

const staff: StaffMember = { id: 't', name: 'Test', role: 'crew' }

function household(over: Record<string, any> = {}) {
  return {
    recordId: 'wvr_1', signer: 'Jamie Rivera', phone: '2565550199', email: 'jamie@x.com',
    children: [{ name: 'Kiddo Rivera', allergies: '', medications: '' }], childCount: 1, adultAllergies: '',
    emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', responsibleAdult: '', photoConsent: true,
    signedAt: '2026-08-01T00:00:00.000Z', agreementVersion: 'v1', validUntil: '2099-08-01T00:00:00.000Z', agreement: 'current',
    checkin: { expected: null, presence: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '', hasPickupCode: false, codeAttempts: 0, locked: false, releasedTo: {} },
    ...over,
  }
}

const OWN = { kind: 'workshop', id: 'cls_camp', title: 'Clay Camp', startIso: '2026-10-20T15:00:00.000Z', days: ['2026-10-20'], dropOff: false, own: true, capacity: 8, seats: 6, options: [] }
const booking = {
  bookingId: 'bkg_a', customer: { givenName: 'Gia', familyName: 'Winner', email: 'gia@x.com', phone: '' }, source: 'online', passId: 'day',
  seats: { adult: 1 }, sessionIds: ['ses_tue'], picks: [], addOns: {}, paidCents: 3815, refundedCents: 0, refunds: [], state: 'confirmed',
  overCapacity: false, lineIds: ['led_a'], refundable: [{ id: 'led_a', seat: 1, ticketTypeId: 'adult', sessions: 1, remainingCents: 3815, sessionCents: 0, freed: false }],
  paidHere: true, refundableCents: 3815, at: '', name: 'Gia Winner', seatsToday: 1, waiting: null,
}

type Handler = (href: string, init?: any) => any
function serve(data: Record<string, any>, onPost: Handler = () => ({ data: {} })) {
  const posts: { href: string; body: any }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
    const href = String(url)
    if (href.includes('/api/staff/incidents.json')) return { ok: true, json: async () => ({ data: { incidents: [] } }) } as Response
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push({ href, body })
      const r = await onPost(href, body)
      return { ok: !r?.error, status: r?.status ?? (r?.error ? 400 : 200), json: async () => r } as Response
    }
    if (href.includes('/api/staff/coverage.json') || href.includes('/api/staff/customers.json')) return { ok: true, json: async () => ({ data: { households: [] } }) } as Response
    if (href.includes('/api/staff/class.json')) return { ok: false, json: async () => ({ error: 'no' }) } as Response
    return { ok: true, json: async () => ({ data: { event: OWN, day: '2026-10-20', summary: { households: 1, people: 2, childrenHereNow: 0 }, households: [household()], choices: null, ...data } }) } as Response
  })
  return posts
}

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

describe('Roster: families first, money folded away below (I1)', () => {
  it('search and family cards come before the bookings, which sit in a closed "Bookings and refunds" fold', async () => {
    serve({ bookings: [booking], ticketLabels: { adult: 'Adult' } })
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    const search = await screen.findByRole('searchbox', { name: 'Find a family or kid' })
    const fold = screen.getByTestId('roster-bookings')
    expect(fold.tagName).toBe('DETAILS')
    expect(fold).not.toHaveAttribute('open')
    expect(within(fold).getByText('Bookings and refunds (1 seat)')).toBeInTheDocument()
    const card = screen.getByRole('button', { name: '✓ Here (2)' })
    // DOM order: search → family card → bookings
    expect(search.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens itself when a reader sale is waiting or a seat needs a name, and says so on the fold', async () => {
    serve({ bookings: [{ ...booking, source: 'door-reader', state: 'held' }], ticketLabels: {} })
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    const fold = await screen.findByTestId('roster-bookings')
    expect(fold).toHaveAttribute('open')
    expect(fold).toHaveTextContent('1 waiting on the reader')
  })
})

describe('Roster: "No one here matches" leads somewhere (I3)', () => {
  it('offers + Add a family, Sell a seat and Comp a seat, carrying what was typed', async () => {
    serve({})
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find a family or kid' }), { target: { value: 'Kim' } })
    const box = screen.getByTestId('roster-no-match')
    expect(within(box).getByRole('button', { name: 'Sell a seat' })).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: 'Comp a seat' })).toBeInTheDocument()
    fireEvent.click(within(box).getByRole('button', { name: '+ Add a family' }))
    const sheet = await screen.findByRole('dialog', { name: /Add a family to Clay Camp/ })
    expect(within(sheet).getByPlaceholderText('Phone, email or last name')).toHaveValue('Kim')
  })
})

describe('Roster: getting people signed (I2)', () => {
  it('a booker who never signed gets Sign on this iPad, Text them the link and Show QR; texting goes by their booking email', async () => {
    const posts = serve(
      { choices: { totals: {}, byEmail: {}, seatsByEmail: {}, unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [], comped: false }], seatsSold: null } },
      () => ({ data: { sent: true } }),
    )
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    const row = await screen.findByTestId('unsigned-booker')
    expect(within(row).getByRole('button', { name: 'Sign on this iPad' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Show QR' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Text them the link' })) })
    expect(posts[0]).toEqual({ href: '/api/staff/send-waiver-link.json', body: { kind: 'workshop', id: 'cls_camp', email: 'bo@x.com' } })
    expect(await within(row).findByText('Texted. They can sign on their phone now.')).toBeInTheDocument()
  })

  it('an expired family: "Sign again first" leads, "Mark here anyway" sends anyway and is the only way to mark them', async () => {
    const posts = serve({ households: [household({ agreement: 'expired', validUntil: '2020-01-01T00:00:00.000Z' })] }, () => ({ data: { checkin: null } }))
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    expect(await screen.findByTestId('agreement-needs-signing')).toHaveTextContent('Agreement EXPIRED')
    expect(screen.getByRole('button', { name: 'Sign again first' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /✓ Here/ })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark here anyway (2)' })) })
    expect(posts.find((p) => p.href === '/api/staff/checkin.json')?.body).toMatchObject({ action: 'checkin', anyway: true })
  })

  it('an older version is flagged with the door-search wording', async () => {
    serve({ households: [household({ agreement: 'outdated', agreementVersion: 'v0' })] })
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    expect(await screen.findByTestId('agreement-needs-signing')).toHaveTextContent('UPDATED AGREEMENT — Jamie signed v0, which is out of date.')
  })

  it('a roster loaded before it expired: the server says so, and the card switches to Sign again first', async () => {
    serve({}, (href) => (href.includes('checkin') ? { status: 409, error: 'Their agreement has expired. Have them sign again first.', needsSigning: 'expired' } : { data: {} }))
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    const here = await screen.findByRole('button', { name: '✓ Here (2)' })
    await act(async () => { fireEvent.click(here) })
    expect(await screen.findByRole('button', { name: 'Sign again first' })).toBeInTheDocument()
  })
})

describe('Roster: one post per tap (M2)', () => {
  it('a double tap on ✓ Here posts once and shows Saving… meanwhile', async () => {
    let release!: () => void
    const posts = serve({}, () => new Promise((r) => { release = () => r({ data: { checkin: null } }) }))
    render(<Roster staff={staff} onBack={vi.fn()} kind="workshop" id="cls_camp" />)
    const here = await screen.findByRole('button', { name: '✓ Here (2)' })
    fireEvent.click(here)
    fireEvent.click(here)
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await act(async () => { release() })
    expect(posts.filter((p) => p.href === '/api/staff/checkin.json')).toHaveLength(1)
  })
})

describe('Roster: a party says what to ring up at the end (I10)', () => {
  const PARTY = { kind: 'party', id: 'pty_1', title: 'Suncatchers Party', startIso: '2026-11-14T20:00:00.000Z', endIso: '2026-11-14T22:00:00.000Z', days: ['2026-11-14'], dropOff: false }
  const money = (over: Record<string, any> = {}) => ({
    payer: 'Stefanie Justice', charges: [], waiting: null, dueCents: 5000, cancelled: false,
    ringUp: { craftName: 'Suncatchers', perHeadCents: 1800, guests: 12 }, stillToPayBy: 'register', ...over,
  })
  function serveParty(partyMoney: any) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/api/staff/incidents.json')) return { ok: true, json: async () => ({ data: { incidents: [] } }) } as Response
      return { ok: true, json: async () => ({ data: { event: PARTY, day: '2026-11-14', summary: { households: 0, people: 0, childrenHereNow: 0 }, households: [], partyMoney } }) } as Response
    })
    render(<Roster staff={staff} onBack={vi.fn()} kind="party" id="pty_1" />)
  }

  it('craft, price per guest, guests booked, and the still-to-pay with how to take it', async () => {
    serveParty(money())
    const box = await screen.findByTestId('party-ring-up')
    expect(box).toHaveTextContent('Ring up crafts at the register: 12 booked × Suncatchers ($18 each). Count who actually made one.')
    expect(box).toHaveTextContent('Still to pay: $50. Take it at the register.')
  })

  it('when a payment link went out, says so', async () => {
    serveParty(money({ stillToPayBy: 'link' }))
    expect(await screen.findByTestId('party-ring-up')).toHaveTextContent('Catherine or Kaden sent them a payment link.')
  })

  it('a cancelled party shows no ring-up', async () => {
    serveParty(money({ cancelled: true }))
    await screen.findByText('Cancelled')
    expect(screen.queryByTestId('party-ring-up')).toBeNull()
  })
})
