import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGuest = vi.fn()
const mockSettle = vi.fn()
const mockAdd = vi.fn()
const mockOrderOf = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    customer: { createGuest: (...a: any[]) => mockGuest(...a) },
    workshop: { settleGuestSeat: (...a: any[]) => mockSettle(...a) },
  },
}))
vi.mock('@lib/square-dashboard', () => ({
  addClassAttendee: (...a: any[]) => mockAdd(...a),
  classBookingOrderId: (...a: any[]) => mockOrderOf(...a),
}))

import { addGuestSeats, addOneGuestSeat, guestSeatName } from '@lib/guest-seats'

const base = {
  scheduleId: 'clssch_pails',
  startAt: '2026-10-18T18:00:00Z',
  className: 'Bedazzled Pumpkin Pails',
  holder: { givenName: 'Maxie', familyName: 'Gardner', email: 'maxie@example.com' },
  what: 'Online seat',
}

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  mockGuest.mockImplementation(async () => ({ id: `guest-${++n}` }))
  let b = 0
  mockAdd.mockImplementation(async () => { b++; return { ok: true, bookingId: `clsbk_g${b}`, orderId: `order-g${b}` } })
  mockSettle.mockResolvedValue(undefined)
  mockOrderOf.mockResolvedValue(null)
})

describe('guest seats', () => {
  it('names a guest seat after the person who booked it', () => {
    expect(guestSeatName('Gardner', 2, 3)).toBe('Gardner (guest 2 of 3)')
  })

  it('adds seats 2 and 3 of 3 as their own named guests, and settles each order at $0', async () => {
    const r = await addGuestSeats({ ...base, totalSeats: 3, firstSeat: 2, settleAs: 'Paid on booking clsbk_1' })
    expect(r).toEqual({ bookingIds: ['clsbk_g1', 'clsbk_g2'], stopped: null, unsettled: [] })
    expect(mockGuest.mock.calls.map((c) => c[0].familyName)).toEqual(['Gardner (guest 2 of 3)', 'Gardner (guest 3 of 3)'])
    expect(mockGuest.mock.calls[0][0].note).toBe('Online seat 2 of 3 with Maxie Gardner <maxie@example.com>, Bedazzled Pumpkin Pails.')
    expect(mockAdd.mock.calls.map((c) => c[0])).toEqual([
      { scheduleId: 'clssch_pails', startAt: '2026-10-18T18:00:00Z', customerId: 'guest-1' },
      { scheduleId: 'clssch_pails', startAt: '2026-10-18T18:00:00Z', customerId: 'guest-2' },
    ])
    expect(mockSettle.mock.calls.map((c) => c[0])).toEqual([
      { orderId: 'order-g1', label: 'Paid on booking clsbk_1' },
      { orderId: 'order-g2', label: 'Paid on booking clsbk_1' },
    ])
  })

  it('finds the seat’s order on the class when Square’s add reply leaves it out', async () => {
    mockAdd.mockResolvedValue({ ok: true, bookingId: 'clsbk_g1', orderId: null })
    mockOrderOf.mockResolvedValue('order-from-class')
    const one = await addOneGuestSeat({ ...base, totalSeats: 2, seat: 2, settleAs: 'Paid' })
    expect(one).toEqual({ ok: true, bookingId: 'clsbk_g1', settled: true })
    expect(mockOrderOf).toHaveBeenCalledWith('clssch_pails', 'clsbk_g1')
    expect(mockSettle).toHaveBeenCalledWith({ orderId: 'order-from-class', label: 'Paid' })
  })

  it('a seat whose order cannot be found is added but reported unsettled', async () => {
    mockAdd.mockResolvedValue({ ok: true, bookingId: 'clsbk_g1', orderId: null })
    const r = await addGuestSeats({ ...base, totalSeats: 2, firstSeat: 2, settleAs: 'Paid' })
    expect(r).toEqual({ bookingIds: ['clsbk_g1'], stopped: null, unsettled: ['clsbk_g1'] })
    expect(mockSettle).not.toHaveBeenCalled()
  })

  it('a seat Square won’t settle is still added, reported, and the next seat still goes in', async () => {
    mockSettle.mockRejectedValueOnce(new Error('Square 400'))
    const r = await addGuestSeats({ ...base, totalSeats: 3, firstSeat: 2, settleAs: 'Paid' })
    expect(r.bookingIds).toEqual(['clsbk_g1', 'clsbk_g2'])
    expect(r.unsettled).toEqual(['clsbk_g1'])
  })

  it('stops at the first seat Square won’t add, keeping the ones it did, with Square’s reason', async () => {
    mockAdd
      .mockResolvedValueOnce({ ok: true, bookingId: 'clsbk_g1', orderId: 'o1' })
      .mockResolvedValueOnce({ ok: false, kind: 'refused', status: 400, detail: 'class full' })
    const r = await addGuestSeats({ ...base, totalSeats: 4, firstSeat: 2, settleAs: 'Paid' })
    expect(r).toEqual({ bookingIds: ['clsbk_g1'], stopped: { kind: 'refused', status: 400, detail: 'class full' }, unsettled: [] })
    expect(mockAdd).toHaveBeenCalledTimes(2)
  })

  it('stops when a guest customer can’t be made, adding nothing for that seat', async () => {
    mockGuest.mockRejectedValue(new Error('customers down'))
    const r = await addGuestSeats({ ...base, totalSeats: 2, firstSeat: 2 })
    expect(r.stopped).toEqual({ kind: 'guest_customer', detail: 'customers down' })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('without settleAs (staff comp / sell at register) the orders are left alone', async () => {
    const r = await addGuestSeats({ ...base, totalSeats: 3, firstSeat: 2 })
    expect(r.bookingIds).toHaveLength(2)
    expect(r.unsettled).toEqual([])
    expect(mockSettle).not.toHaveBeenCalled()
  })
})
