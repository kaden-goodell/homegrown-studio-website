import { describe, it, expect } from 'vitest'
import { insidePolicyWindow } from '@lib/classes/staff-roster'

const now = new Date('2026-11-10T12:00:00Z')
const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString()

describe('crew I6: is a booking inside the 48-hour refund window?', () => {
  it('uses the booking’s first session', () => {
    const sessions = [{ id: 'a', startIso: at(50) }, { id: 'b', startIso: at(20) }, { id: 'c', startIso: at(100) }]
    expect(insidePolicyWindow(sessions, ['a', 'c'], now)).toBe(false)
    expect(insidePolicyWindow(sessions, ['a', 'b'], now)).toBe(true)
  })
  it('a class that already started is inside; no sessions found is not', () => {
    expect(insidePolicyWindow([{ id: 'a', startIso: at(-2) }], ['a'], now)).toBe(true)
    expect(insidePolicyWindow([{ id: 'a', startIso: at(47.9) }], ['a'], now)).toBe(true)
    expect(insidePolicyWindow([{ id: 'a', startIso: at(48) }], ['a'], now)).toBe(false)
    expect(insidePolicyWindow([], ['a'], now)).toBe(false)
  })
})

describe('run 3: recentSamePerson counts only bookings that really hold a paid seat', () => {
  it('released, refunded-and-freed, or lapsed tries never count as booked', async () => {
    const { recentSamePerson } = await import('@lib/classes/checkout')
    const base = { bookingId: 'b1', customer: { email: 'ada@x.com' }, at: now.toISOString(), holdExpiresAt: null, refunds: [], square: { orderId: null } } as any
    expect(recentSamePerson([{ ...base, state: 'released' }], 'b2', 'ada@x.com', now)).toBeNull()
    expect(recentSamePerson([{ ...base, state: 'held', holdExpiresAt: at(-1) }], 'b2', 'ada@x.com', now)).toBeNull()
    expect(recentSamePerson([{ ...base, state: 'confirmed', refunds: [{ freedSeat: true }] }], 'b2', 'ada@x.com', now)).toBeNull()
    expect(recentSamePerson([{ ...base, state: 'confirmed' }], 'b2', 'ADA@x.com', now)).toBe('booked')
  })
})
