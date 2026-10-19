import { describe, it, expect } from 'vitest'
import { dueCents, paidCents, refundableOn, paymentState, claimPaying } from '@lib/parties/money'
import type { PartyCharge, PartyItem, PartyRecord, PartyRefund } from '@lib/party-store'

const item = (id: string, cents: number, chargeId: string | null = null): PartyItem => ({
  id, kind: id === 'itm_pkg' ? 'package' : 'addon', refId: id, label: id, qty: 1, unitCents: cents, cents, extraMinutes: 0, chargeId, addedAt: '2026-10-19T00:00:00.000Z', by: null,
})
const charge = (id: string, cents: number, itemIds: string[]): PartyCharge => ({
  id, via: 'online', orderId: `o_${id}`, paymentId: `p_${id}`, cents, quotedCents: cents, itemIds, receiptUrl: null, at: '2026-10-19T00:00:00.000Z', by: null,
})
const refund = (chargeId: string, cents: number): PartyRefund => ({
  id: `rf_${chargeId}_${cents}`, chargeId, paymentId: `p_${chargeId}`, cents, reason: 'r', by: null, role: 'owner', squareRefundId: 'sq', requestId: null, at: '2026-10-20T00:00:00.000Z',
})
const rec = (over: Partial<PartyRecord> = {}): PartyRecord => ({
  bookingId: 'pty_1', hostToken: 't', craftName: 'Pails', startIso: '2026-11-08T19:30:00.000Z', durationMinutes: 90, hostName: 'Ada',
  hostEmail: 'a@x.co', guestCount: 12, title: null, dropOff: false, createdAt: '2026-10-19T00:00:00.000Z', source: 'ours', status: 'booked', ...over,
})

describe('party money', () => {
  it('waiting: nothing paid, everything due', () => {
    const r = rec({ items: [item('itm_pkg', 30000), item('itm_half', 5000)] })
    expect(dueCents(r)).toBe(35000)
    expect(paidCents(r)).toBe(0)
    expect(paymentState(r)).toBe('waiting')
  })

  it('paid: every item charged', () => {
    const r = rec({ items: [item('itm_pkg', 30000, 'chg_1')], charges: [charge('chg_1', 30000, ['itm_pkg'])] })
    expect(dueCents(r)).toBe(0)
    expect(paidCents(r)).toBe(30000)
    expect(paymentState(r)).toBe('paid')
  })

  it('partly: an extra added after paying is due', () => {
    const r = rec({ items: [item('itm_pkg', 30000, 'chg_1'), item('itm_half', 5000)], charges: [charge('chg_1', 30000, ['itm_pkg'])] })
    expect(dueCents(r)).toBe(5000)
    expect(paymentState(r)).toBe('partly')
  })

  it('paid counts what Square took (charge cents), less refunds', () => {
    const r = rec({
      items: [item('itm_pkg', 30000, 'chg_1')],
      charges: [{ ...charge('chg_1', 30050, ['itm_pkg']), quotedCents: 30000 }],
      refunds: [refund('chg_1', 10000)],
    })
    expect(paidCents(r)).toBe(20050)
    expect(paymentState(r)).toBe('paid') // a refund never changes what was bought
  })

  it('cancelled: nothing due, money stays as it is', () => {
    const r = rec({ status: 'cancelled', items: [item('itm_pkg', 30000, 'chg_1'), item('itm_half', 5000)], charges: [charge('chg_1', 30000, ['itm_pkg'])] })
    expect(dueCents(r)).toBe(0)
    expect(paidCents(r)).toBe(30000)
    expect(paymentState(r)).toBe('cancelled')
    expect(refundableOn(r, 'chg_1')).toBe(30000)
  })

  it('legacy: a Square-booked party has nothing here', () => {
    const r = rec({ source: undefined, status: undefined })
    expect(dueCents(r)).toBe(0)
    expect(paidCents(r)).toBe(0)
    expect(paymentState(r)).toBe('legacy')
    expect(paymentState(rec({ source: 'square' }))).toBe('legacy')
  })

  it('refundable per charge, never below zero', () => {
    const r = rec({
      items: [item('itm_pkg', 30000, 'chg_1'), item('itm_half', 5000, 'chg_2')],
      charges: [charge('chg_1', 30000, ['itm_pkg']), charge('chg_2', 5000, ['itm_half'])],
      refunds: [refund('chg_1', 10000), refund('chg_1', 5000), refund('chg_2', 5000), refund('chg_2', 100)],
    })
    expect(refundableOn(r, 'chg_1')).toBe(15000)
    expect(refundableOn(r, 'chg_2')).toBe(0)
    expect(refundableOn(r, 'chg_nope')).toBe(0)
    expect(refundableOn(rec(), 'chg_1')).toBe(0)
  })
})

describe('claimPaying', () => {
  const now = new Date('2026-10-19T15:00:00.000Z')
  it('claims a free party for 10 minutes', () => {
    const res = claimPaying(rec(), 'att_a', now, 10)
    expect(res).toEqual({ ok: true, rec: expect.objectContaining({ paying: { attemptId: 'att_a', until: '2026-10-19T15:10:00.000Z' } }) })
  })

  it('refuses a second attempt inside the time, lets the same attempt through', () => {
    const held = rec({ paying: { attemptId: 'att_a', until: '2026-10-19T15:10:00.000Z' } })
    expect(claimPaying(held, 'att_b', new Date('2026-10-19T15:09:59.000Z'), 10)).toEqual({ ok: false, reason: 'busy' })
    const again = claimPaying(held, 'att_a', new Date('2026-10-19T15:05:00.000Z'), 10)
    expect(again.ok).toBe(true)
  })

  it('frees after it runs out', () => {
    const held = rec({ paying: { attemptId: 'att_a', until: '2026-10-19T15:10:00.000Z' } })
    const res = claimPaying(held, 'att_b', new Date('2026-10-19T15:10:00.000Z'), 10)
    expect(res.ok && res.rec.paying?.attemptId).toBe('att_b')
  })

  it('does not change the record it was given', () => {
    const r = rec({ paying: null })
    claimPaying(r, 'att_a', now, 10)
    expect(r.paying).toBeNull()
  })
})
