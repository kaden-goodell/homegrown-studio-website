// D2: which seats a customer can cancel themselves, and for how much (pure).
import { describe, it, expect } from 'vitest'
import { cancelOptions, cancelSplit, pickedSeats, CANCEL_WHY } from '@lib/classes/self-cancel-rules'
import type { LedgerLine } from '@lib/classes/seat-ledger'

const START = '2026-11-20T18:00:00.000Z'
const cls = (over: Record<string, any> = {}) => ({
  status: 'open' as const,
  sessions: [{ id: 's1', startIso: START, endIso: '2026-11-20T20:00:00.000Z', capacity: 6 }, { id: 's2', startIso: '2026-11-21T18:00:00.000Z', endIso: '2026-11-21T20:00:00.000Z', capacity: 6 }],
  content: { ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }] } as any,
  ...over,
})
let n = 0
const line = (over: Partial<LedgerLine> = {}): LedgerLine => ({
  id: `led_${++n}`, bookingId: 'bkg_1', sessionIds: ['s1'], ticketTypeId: 'adult', passId: 'one', seat: n, priceCents: 2000, taxCents: 180,
  addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null,
  customer: { givenName: 'Jane', familyName: 'Doe', email: 'j@x.co', phone: '' },
  square: { orderId: 'O1', paymentId: 'P1', lineUid: null, chargedCents: 4360 }, by: null, refunds: [], at: '', ...over,
})
const policy = { policyHours: 48 }
const at = (hoursBefore: number) => new Date(Date.parse(START) - hoursBefore * 3_600_000)

describe('D2 cancel options', () => {
  it('48+ hours ahead: self-serve, each seat its own price + tax (Square’s line totals when kept)', () => {
    n = 0
    const a = line({ seat: 1 }), b = line({ seat: 2, ticketTypeId: 'kid', square: { orderId: 'O1', paymentId: 'P1', lineUid: null, chargedCents: 4360, lineNetCents: 1500, lineTaxCents: 135 } })
    const o = cancelOptions(cls(), [a, b], at(49), policy)
    expect(o.mode).toBe('self')
    expect(o.seats.map((s) => [s.label, s.cents, s.canPick])).toEqual([['Adult', 2180, true], ['Kid', 1635, true]])
    expect(o.wholeOnly).toBe(false)
    expect(pickedSeats(o, [b.id])).toEqual([b.id])
    expect(pickedSeats(o, ['led_x'])).toBeNull()
    expect(pickedSeats(o, [])).toBeNull()
  })

  it('exactly 48 hours is still self-serve; one second less is the request path with the policy', () => {
    expect(cancelOptions(cls(), [line()], at(48), policy).mode).toBe('self')
    const inside = cancelOptions(cls(), [line()], new Date(at(48).getTime() + 1000), policy)
    expect(inside.mode).toBe('request')
    expect(inside.why).toBe(CANCEL_WHY.inside(48))
    expect(inside.seats.every((s) => !s.canPick)).toBe(true)
  })

  it('never more than the booking has left (what Square charged less refunds)', () => {
    const a = line({ seat: 1, square: { orderId: 'O', paymentId: 'P', lineUid: null, chargedCents: 3000 } })
    const b = line({ seat: 2, square: { orderId: 'O', paymentId: 'P', lineUid: null, chargedCents: 3000 } })
    expect(cancelSplit([a, b], [a.id, b.id]).map((x) => x.cents)).toEqual([2180, 820])
  })

  it('a gift seat, a seat paid at the studio (counter, register, reader): the request path, said why', () => {
    expect(cancelOptions(cls(), [line({ source: 'comp', square: { orderId: null, paymentId: null, lineUid: null } })], at(100), policy)).toMatchObject({ mode: 'request', why: CANCEL_WHY.comp })
    for (const source of ['door-counter', 'pos', 'door-reader'] as const) {
      expect(cancelOptions(cls(), [line({ source })], at(100), policy)).toMatchObject({ mode: 'request', why: CANCEL_WHY.studio })
    }
  })

  it('a $0 booking: free cancel any time before it starts, nothing to refund', () => {
    const free = line({ priceCents: 0, taxCents: 0, square: { orderId: null, paymentId: null, lineUid: null, chargedCents: 0 } })
    const o = cancelOptions(cls(), [free], at(2), policy)
    expect(o.mode).toBe('free')
    expect(o.seats[0]).toMatchObject({ cents: 0, canPick: true })
  })

  it('a booking for several dates goes whole; part of it refunded or started → request', () => {
    const a = line({ seat: 1, sessionIds: ['s1', 's2'] }), b = line({ seat: 2, sessionIds: ['s1', 's2'] })
    const o = cancelOptions(cls(), [a, b], at(72), policy)
    expect(o).toMatchObject({ mode: 'self', wholeOnly: true })
    expect(pickedSeats(o, [a.id])).toBeNull()
    expect(pickedSeats(o, [a.id, b.id])).toEqual([a.id, b.id])
    const freed = { ...b, state: 'refunded' as const, refunds: [{ at: '', cents: 2180, reason: '', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: 'R' }] }
    expect(cancelOptions(cls(), [a, freed], at(72), policy)).toMatchObject({ mode: 'request', why: CANCEL_WHY.partly })
    // the first date has started, the second hasn't
    expect(cancelOptions(cls(), [a, b], new Date(Date.parse(START) + 3_600_000), policy)).toMatchObject({ mode: 'request', why: CANCEL_WHY.started })
  })

  it('a goodwill refund (seat kept) takes that seat out of self-serve; already-cancelled seats show as cancelled', () => {
    const kept = line({ seat: 1, state: 'refunded', refunds: [{ at: '', cents: 500, reason: '', by: { id: 'k', name: 'K' }, freedSeat: false, squareRefundId: 'R' }] })
    const other = line({ seat: 2 })
    const o = cancelOptions(cls(), [kept, other], at(72), policy)
    expect(o.mode).toBe('self')
    expect(o.seats.map((s) => [s.state, s.canPick])).toEqual([['booked', false], ['booked', true]])
    const gone = line({ seat: 3, state: 'refunded', refunds: [{ at: '', cents: 2180, reason: '', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: 'R' }] })
    expect(cancelOptions(cls(), [gone], at(72), policy)).toMatchObject({ mode: 'none', seats: [expect.objectContaining({ state: 'cancelled' })] })
  })

  it('seats being cancelled (refund unanswered) can’t be picked again', () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const o = cancelOptions(cls(), [a, b], at(72), { ...policy, cancelling: new Set([a.id]) })
    expect(o.seats.map((s) => [s.state, s.canPick])).toEqual([['cancelling', false], ['booked', true]])
  })

  it('over, or cancelled by the studio: nothing to cancel', () => {
    expect(cancelOptions(cls({ status: 'cancelled' }), [line()], at(72), policy)).toMatchObject({ mode: 'none', why: CANCEL_WHY.classCancelled })
    expect(cancelOptions(cls(), [line()], new Date('2026-11-22T00:00:00.000Z'), policy)).toMatchObject({ mode: 'none', why: CANCEL_WHY.over })
  })

  it('a paid seat with no Square payment on record goes to a person', () => {
    expect(cancelOptions(cls(), [line({ square: { orderId: null, paymentId: null, lineUid: null } })], at(72), policy)).toMatchObject({ mode: 'request', why: CANCEL_WHY.noPayment })
  })
})
