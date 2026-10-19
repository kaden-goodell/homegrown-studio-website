import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PrintDay from '@components/admin/classes/PrintDay'
import { localToUtcISO } from '@lib/party-slots'

const DAY = '2031-03-12'
const at = (hhmm: string) => localToUtcISO(DAY, hhmm)
const booking = (over: any) => ({
  bookingId: 'bkg_1', customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0100' },
  source: 'online', passId: 'all', seats: { adult: 1, kid: 1 }, sessionIds: ['ses_1'],
  picks: [{ seat: 1, ticketTypeId: 'adult', answers: { q1: 'Red' } }, { seat: 2, ticketTypeId: 'kid', answers: { q1: 'Blue' } }],
  addOns: { add1: 2 }, paidCents: 5000, refundedCents: 0, refunds: [], state: 'confirmed', overCapacity: false, lineIds: [], at: '2031-03-01T00:00:00Z',
  ...over,
})
const dayData = {
  day: DAY,
  classes: [{
    id: 'cls_1', sessionId: 'ses_1', name: 'Pottery', startIso: at('10:00'), endIso: at('12:00'), capacity: 10,
    content: {
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      questions: [{ id: 'q1', label: 'Glaze', choices: ['Red', 'Blue'] }],
      addOns: [{ id: 'add1', label: 'Extra mug', priceCents: 500, maxPerSeat: 2 }],
      passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
    },
    bookings: [
      booking({}),
      booking({ bookingId: 'bkg_2', customer: { givenName: 'Bo', familyName: 'Diddley', email: 'bo@example.com', phone: '' }, seats: { adult: 1 }, picks: [{ seat: 1, ticketTypeId: 'adult', answers: { q1: 'Red' } }], addOns: {} }),
    ],
    waivers: [{ name: 'Ada Lovelace', email: 'ADA@example.com', kids: 1 }],
  }],
  events: [{ kind: 'party', id: 'bk_1', label: 'Party for Sam', startIso: at('14:00'), endIso: at('16:00'), waivers: [{ name: 'Sam Parent', email: 's@example.com', kids: 2 }] }],
  other: [{ kind: 'cafe', id: 'cafe-x', label: 'Craft Café', startIso: at('09:00'), endIso: at('12:30') }],
}
afterEach(() => vi.unstubAllGlobals())

describe('PrintDay', () => {
  it('lists each class roster with seats, pick totals, add-ons and waiver status, then parties', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ data: dayData }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PrintDay day={DAY} onBack={() => {}} />)
    const cls = await screen.findByRole('region', { name: 'Pottery' })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/classes/day.json?day=${DAY}`)
    expect(within(cls).getByText('3 of 10 seats')).toBeInTheDocument()
    expect(within(cls).getByText('Adult 2 · Kid 1')).toBeInTheDocument()
    expect(within(cls).getByText('Glaze: Red 2 · Blue 1')).toBeInTheDocument()
    expect(within(cls).getByText('Extra mug 2')).toBeInTheDocument()
    const ada = within(cls).getByRole('row', { name: /Ada Lovelace/ })
    expect(ada).toHaveTextContent('Waiver signed')
    expect(ada).toHaveTextContent('1 Adult, 1 Kid')
    expect(within(cls).getByRole('row', { name: /Bo Diddley/ })).toHaveTextContent('No waiver yet')
    const party = screen.getByRole('region', { name: 'Party for Sam' })
    expect(within(party).getByText(/Sam Parent/)).toBeInTheDocument()
    expect(screen.getByText(/Craft Café/)).toBeInTheDocument()
  })

  it('the Print button prints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: dayData }) })))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(<PrintDay day={DAY} onBack={() => {}} />)
    await screen.findByRole('region', { name: 'Pottery' })
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalled()
  })
})
