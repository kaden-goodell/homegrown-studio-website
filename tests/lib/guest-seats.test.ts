import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGuest = vi.fn()
const mockAdd = vi.fn()
vi.mock('@config/providers', () => ({ providers: { customer: { createGuest: (...a: any[]) => mockGuest(...a) } } }))
vi.mock('@lib/square-dashboard', () => ({ addClassAttendee: (...a: any[]) => mockAdd(...a) }))

import { addGuestSeats, guestSeatName } from '@lib/guest-seats'

const base = {
  scheduleId: 'clssch_pails',
  startAt: '2026-10-18T18:00:00Z',
  className: 'Bedazzled Pumpkin Pails',
  holder: { givenName: 'Maxie', familyName: 'Gardner', email: 'maxie@example.com' },
  what: 'Comped seat',
}

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  mockGuest.mockImplementation(async () => ({ id: `guest-${++n}` }))
  let b = 0
  mockAdd.mockImplementation(async () => ({ ok: true, bookingId: `clsbk_g${++b}`, orderId: `order-g${b}` }))
})

describe('guest seats (staff Comp / Sell a seat)', () => {
  it('names a guest seat after the person who booked it', () => {
    expect(guestSeatName('Gardner', 2, 3)).toBe('Gardner (guest 2 of 3)')
  })

  it('adds seats 2 and 3 of 3 as their own named guests', async () => {
    const r = await addGuestSeats({ ...base, totalSeats: 3, firstSeat: 2 })
    expect(r).toEqual({ bookingIds: ['clsbk_g1', 'clsbk_g2'], stopped: null })
    expect(mockGuest.mock.calls.map((c) => c[0].familyName)).toEqual(['Gardner (guest 2 of 3)', 'Gardner (guest 3 of 3)'])
    expect(mockGuest.mock.calls[0][0].note).toBe('Comped seat 2 of 3 with Maxie Gardner <maxie@example.com>, Bedazzled Pumpkin Pails.')
    expect(mockAdd.mock.calls.map((c) => c[0])).toEqual([
      { scheduleId: 'clssch_pails', startAt: '2026-10-18T18:00:00Z', customerId: 'guest-1' },
      { scheduleId: 'clssch_pails', startAt: '2026-10-18T18:00:00Z', customerId: 'guest-2' },
    ])
  })

  it('gives a seat the name of who sits in it, when staff picked them', async () => {
    await addGuestSeats({ ...base, totalSeats: 3, firstSeat: 2, seatNames: ['Maxie Gardner', 'Flynn', ''] })
    expect(mockGuest.mock.calls.map((c) => [c[0].givenName, c[0].familyName])).toEqual([
      ['Flynn', '(with Maxie Gardner)'],
      ['Maxie', 'Gardner (guest 3 of 3)'],
    ])
  })

  it('stops at the first seat Square won’t add, keeping the ones it did, with Square’s reason', async () => {
    mockAdd
      .mockResolvedValueOnce({ ok: true, bookingId: 'clsbk_g1', orderId: 'o1' })
      .mockResolvedValueOnce({ ok: false, kind: 'refused', status: 400, detail: 'class full' })
    const r = await addGuestSeats({ ...base, totalSeats: 4, firstSeat: 2 })
    expect(r).toEqual({ bookingIds: ['clsbk_g1'], stopped: { kind: 'refused', status: 400, detail: 'class full' } })
    expect(mockAdd).toHaveBeenCalledTimes(2)
  })

  it('stops when a guest customer can’t be made, adding nothing for that seat', async () => {
    mockGuest.mockRejectedValue(new Error('customers down'))
    const r = await addGuestSeats({ ...base, totalSeats: 2, firstSeat: 2 })
    expect(r.stopped).toEqual({ kind: 'guest_customer', detail: 'customers down' })
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
