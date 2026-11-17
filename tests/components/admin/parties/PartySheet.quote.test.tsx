import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { PartySheet } from '@components/admin/parties/PartySheet'
import { renderSheet } from '../sheets/harness'
import { CRAFTS, DAY, party, partyServer, settings, T1 } from './fixtures'

/**
 * A party born from a private-event quote (origin 'quote'): Details says
 * "Private event", lists the package lines and the deposit paid / balance
 * due; no "+ Add an extra" and no "crafts rung up on the POS" line.
 */
vi.mock('@components/checkout/PaymentForm', () => ({ default: () => null }))
afterEach(() => vi.unstubAllGlobals())

const ID = 'pty_0123456789abcdef'
const ITEM = { qty: 1, count: 1, extraMinutes: 0, addedAt: '2031-03-01T00:00:00Z', by: null, refId: 'qt_1', kind: 'quote' }
const quoteParty = (over: any = {}) => party({
  craftName: 'Holiday Glow Night', guestCount: 30, packageId: null, craftId: null,
  origin: 'quote', place: 'away', address: '12 Oak Lane, Madison, AL',
  quote: { quoteId: 'qt_1', tierName: 'Holiday Glow Night', lines: ['Glass terrarium', 'Earring bar'], guests: 30, pricePerPersonCents: 7500 },
  items: [
    { ...ITEM, id: 'itm_dep', label: 'Deposit', unitCents: 112500, cents: 112500, chargeId: 'chg_1' },
    { ...ITEM, id: 'itm_bal', label: 'Balance', unitCents: 112500, cents: 112500, chargeId: null },
  ],
  charges: [{ id: 'chg_1', via: 'link', orderId: 'o1', paymentId: 'p1', cents: 112500, quotedCents: 112500, itemIds: ['itm_dep'], receiptUrl: null, at: '2031-03-02T15:00:00Z', by: null }],
  dueCents: 112500, paymentState: 'partly',
  ...over,
})

function server(p: any) {
  return partyServer({
    '/api/admin/party.json': { body: { data: { party: p, guests: [] } } },
    '/api/admin/parties/settings.json': { body: { data: { settings: settings(), legacyRemaining: { count: 0, lastIso: null } } } },
    '/api/party/service-info.json': { body: { data: { crafts: CRAFTS } } },
    '/api/admin/parties/times.json': { body: { data: { minutes: 90, offered: [T1], open: [T1] } } },
  })
}

describe('Party sheet · private event', () => {
  it('Details: Private event badge, the package lines, deposit paid and balance due; no add-an-extra', async () => {
    server(quoteParty())
    renderSheet(<PartySheet day={DAY} id={ID} />)
    expect(await screen.findByText('Private event')).toBeInTheDocument()
    expect(screen.getByText('Glass terrarium')).toBeInTheDocument()
    expect(screen.getByText('Earring bar')).toBeInTheDocument()
    expect(screen.getByText('$1,125 paid')).toBeInTheDocument()
    expect(screen.getByText('$1,125 due')).toBeInTheDocument()
    expect(screen.getByText('12 Oak Lane, Madison, AL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add an extra' })).toBeNull()
    expect(screen.queryByText('Extras')).toBeNull()
  })

  it('Payments lists the quote lines by label, with no POS craft line and no add-an-extra', async () => {
    server(quoteParty())
    renderSheet(<PartySheet day={DAY} id={ID} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Payments · $1,125 due' }))
    expect(screen.getByText('Deposit')).toBeInTheDocument()
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.queryByText(/rung up on the POS/)).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add an extra' })).toBeNull()
    expect(screen.getByText(/Crafts are included in the package/)).toBeInTheDocument()
  })

  it('balance not on the party yet: due is guests × price per person less what is paid', async () => {
    const p = quoteParty()
    server(quoteParty({ items: [p.items[0]], dueCents: 0, paymentState: 'paid' }))
    renderSheet(<PartySheet day={DAY} id={ID} />)
    expect(await screen.findByText('$1,125 due')).toBeInTheDocument()
  })

  it('a weekend party still has its extras and POS line (unchanged)', async () => {
    server(party())
    renderSheet(<PartySheet day={DAY} id={ID} />)
    expect(await screen.findByRole('button', { name: '+ Add an extra' })).toBeInTheDocument()
    expect(screen.queryByText('Private event')).toBeNull()
  })
})
