import { describe, it, expect } from 'vitest'
import { isComing, takesSeat, leftOn } from '@lib/classes/seat-status'
import { groupBookings } from '@lib/classes/admin-actions'
import { seatsTaken, type LedgerLine } from '@lib/classes/seat-ledger'

const NOW = new Date('2031-03-01T12:00:00Z')
const by = { id: 'a', name: 'A' }
const line = (over: Partial<LedgerLine>): LedgerLine => ({
  id: 'led_1', bookingId: 'bkg_1', sessionIds: ['ses_1'], ticketTypeId: 'person', passId: 'all', seat: 1,
  priceCents: 2500, taxCents: 200, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
  state: 'confirmed', holdExpiresAt: null, customer: null, square: { orderId: 'o', paymentId: 'p', lineUid: null },
  by: null, refunds: [], at: NOW.toISOString(), ...over,
})
const refund = (freedSeat: boolean, cents = 2700) => ({ at: NOW.toISOString(), cents, reason: 'x', by, freedSeat, squareRefundId: null })

describe('seat-status (R43)', () => {
  it('coming: confirmed, or refunded with the seat kept; a freed seat, a hold and a released line are not', () => {
    expect(isComing(line({}))).toBe(true)
    expect(isComing(line({ state: 'refunded', refunds: [refund(false)] }))).toBe(true)
    expect(isComing(line({ state: 'refunded', refunds: [refund(true)] }))).toBe(false)
    expect(isComing(line({ state: 'held', holdExpiresAt: '2031-03-01T12:10:00Z' }))).toBe(false)
    expect(isComing(line({ state: 'released' }))).toBe(false)
  })

  it('takes a seat: coming, or a hold still running', () => {
    expect(takesSeat(line({ state: 'held', holdExpiresAt: '2031-03-01T12:10:00Z' }), NOW)).toBe(true)
    expect(takesSeat(line({ state: 'held', holdExpiresAt: '2031-03-01T11:59:00Z' }), NOW)).toBe(false)
    expect(leftOn(line({ state: 'refunded', refunds: [refund(false, 700)] }))).toBe(2000)
  })

  it('a refunded-but-kept person counts and shows as coming; a freed seat does not count anywhere', () => {
    const ledger = {
      classId: 'cls_1',
      lines: [
        line({ id: 'led_k', bookingId: 'bkg_kept', state: 'refunded', refunds: [refund(false)] }),
        line({ id: 'led_f', bookingId: 'bkg_part', state: 'refunded', refunds: [refund(true)] }),
        line({ id: 'led_c', bookingId: 'bkg_part', seat: 2 }),
      ],
    }
    expect(seatsTaken(ledger, 'ses_1', NOW)).toBe(2)
    const views = groupBookings(ledger, NOW)
    expect(views.find((b) => b.bookingId === 'bkg_kept')!.seatsComing).toBe(1)
    expect(views.find((b) => b.bookingId === 'bkg_part')!.seatsComing).toBe(1)
  })
})
