import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import ClassBookings from '@components/admin/classes/ClassBookings'
import { defaultRules } from '@lib/classes/validate'
import { localToUtcISO } from '@lib/party-slots'

const cls = (over: any = {}) => ({
  id: 'cls_1', libraryId: null, libraryVersion: null,
  content: {
    name: 'Pottery', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }], prices: { all: { adult: 3000, kid: 2000 } },
    questions: [{ id: 'q1', label: 'Glaze', choices: ['Red', 'Blue'] }], addOns: [], defaultCapacity: 10, defaultMinutes: 90,
  },
  sessions: [{ id: 'ses_1', startIso: localToUtcISO('2031-03-12', '10:00'), endIso: localToUtcISO('2031-03-12', '11:30'), capacity: 10 }],
  status: 'open', square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '2031-01-02T00:00:00.000Z', by: { id: 'admin', name: 'Owner' }, history: [],
  ...over,
})
const booking = {
  bookingId: 'bkg_1', customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0100' },
  source: 'online', passId: 'all', seats: { adult: 1, kid: 2 }, sessionIds: ['ses_1'],
  picks: [{ seat: 1, ticketTypeId: 'adult', answers: { q1: 'Red' } }], addOns: {}, paidCents: 7630, refundedCents: 0, refunds: [],
  state: 'confirmed', overCapacity: false, lineIds: ['led_1'], at: '2031-03-01T00:00:00Z',
  refundable: [{ id: 'led_1', seat: 1, ticketTypeId: 'adult', sessions: 1, remainingCents: 7630, sessionCents: 0, freed: false }], paidHere: true, refundableCents: 7630,
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

describe('ClassBookings', () => {
  it('shows each booking with a Refund button, and the seats taken', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { class: cls(), bookings: [booking] } })))
    render(<ClassBookings id="cls_1" onEdit={() => {}} onBack={() => {}} />)
    const b = await screen.findByRole('article', { name: 'Ada Lovelace' })
    expect(within(b).getByText('1 Adult, 2 Kid')).toBeInTheDocument()
    expect(within(b).getByText(/\$76\.30/)).toBeInTheDocument()
    expect(within(b).getByText(/ada@example.com/)).toBeInTheDocument()
    expect(within(b).getByText(/Glaze Red/)).toBeInTheDocument()
    expect(b.querySelector('[data-refund-slot="bkg_1"]')).not.toBeNull()
    expect(within(b).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
    expect(screen.getByText('3 of 10 seats taken')).toBeInTheDocument()
  })

  it('cancel asks first, sends the copy it loaded, and lists who to contact', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: any) => (init?.method === 'POST'
      ? ok({ data: { class: cls({ status: 'cancelled' }), booked: [{ bookingId: 'bkg_1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '(256) 555-0100', seats: 3, paidCents: 7630 }] } })
      : ok({ data: { class: cls(), bookings: [booking] } })))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassBookings id="cls_1" onEdit={() => {}} onBack={() => {}} />)
    await screen.findByRole('article', { name: 'Ada Lovelace' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this class' }))
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel the class' }))
    const list = await screen.findByRole('list', { name: 'People to contact' })
    expect(within(list).getByText(/Ada Lovelace/)).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)).toEqual({ action: 'cancel', id: 'cls_1', expectedUpdatedAt: '2031-01-02T00:00:00.000Z' })
  })

  it('a stale cancel shows the sentence and Reload', async () => {
    let gets = 0
    const fetchMock = vi.fn(async (_url: string, init?: any) => (init?.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ error: 'Someone else changed this class. Reload to see their changes.', stale: true }) }
      : (gets++, ok({ data: { class: cls(), bookings: [] } }))))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassBookings id="cls_1" onEdit={() => {}} onBack={() => {}} />)
    await screen.findByText('No bookings yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this class' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel the class' }))
    expect(await screen.findByText('Someone else changed this class. Reload to see their changes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(gets).toBe(2))
  })

  it('Edit hands up the class as loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { class: cls(), bookings: [] } })))
    const onEdit = vi.fn()
    render(<ClassBookings id="cls_1" onEdit={onEdit} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit class' }))
    expect(onEdit.mock.calls[0][0].id).toBe('cls_1')
  })
})
