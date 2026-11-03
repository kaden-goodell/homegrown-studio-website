// Money M7: "Put it toward the party" credits only a payment that pays for whole unpaid items exactly.
import { describe, expect, it } from 'vitest'
import { canTakePayment, itemsCovered } from '@lib/parties/paid-elsewhere'

const item = (id: string, cents: number, chargeId: string | null = null) => ({ id, kind: 'addon', refId: id, label: id, qty: 1, cents, chargeId }) as any
const party = (items: any[]) => ({ bookingId: 'pty_1', source: 'ours', status: 'booked', items, charges: [], refunds: [] }) as any

describe('itemsCovered (M7)', () => {
  it('the reviewer’s case: $300 package + $100 extra unpaid, a $350 payment matches nothing → null (refund it instead)', () => {
    expect(itemsCovered([item('pkg', 30000), item('extra', 10000)], 35000)).toBeNull()
    expect(canTakePayment(party([item('pkg', 30000), item('extra', 10000)]), 35000)).toBe(false)
  })
  it('a payment for exactly some of the items covers exactly those (earliest first), never part of one', () => {
    expect(itemsCovered([item('pkg', 30000), item('extra', 10000)], 30000)!.map((i) => i.id)).toEqual(['pkg'])
    expect(itemsCovered([item('pkg', 30000), item('extra', 10000)], 10000)!.map((i) => i.id)).toEqual(['extra'])
    expect(itemsCovered([item('pkg', 30000), item('extra', 10000)], 40000)!.map((i) => i.id)).toEqual(['pkg', 'extra'])
    // a later pair that adds up when the earliest doesn't fit
    expect(itemsCovered([item('a', 5000), item('b', 2000), item('c', 3000)], 5000)!.map((i) => i.id)).toEqual(['a'])
    expect(itemsCovered([item('a', 6000), item('b', 2000), item('c', 3000)], 5000)!.map((i) => i.id)).toEqual(['b', 'c'])
    expect(canTakePayment(party([item('pkg', 30000), item('extra', 10000)]), 40000)).toBe(true)
  })
  it('paid items never count; nothing owed or $0 → null', () => {
    expect(itemsCovered([item('pkg', 30000, 'chg_1'), item('extra', 10000)], 30000)).toBeNull()
    expect(itemsCovered([], 1000)).toBeNull()
    expect(itemsCovered([item('pkg', 30000)], 0)).toBeNull()
  })
})
