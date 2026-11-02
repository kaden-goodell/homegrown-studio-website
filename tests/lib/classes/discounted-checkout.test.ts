import { describe, it, expect } from 'vitest'
import { orderLinesFor } from '@lib/classes/checkout'
import { planRefund } from '@lib/classes/refunds'
import { quote } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import type { LedgerLine } from '@lib/classes/seat-ledger'
import type { ScheduledClass } from '@lib/classes/types'
import type { PromoCode } from '@lib/promos/types'

const NOW = new Date('2026-10-20T12:00:00Z')
const by = { id: 'c', name: 'C' }
const cls: ScheduledClass = {
  id: 'cls_d', libraryId: null, libraryVersion: null,
  content: {
    name: 'Looms', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
    prices: { all: { person: 1500 } }, questions: [], addOns: [{ id: 'glaze', label: 'Glaze', priceCents: 400, maxPerSeat: 1 }],
    defaultCapacity: 8, defaultMinutes: 90, earlyBird: { untilYmd: '2026-10-30', prices: { all: { person: 1200 } } },
  },
  sessions: [{ id: 's1', startIso: '2026-11-20T18:00:00Z', endIso: '2026-11-20T20:00:00Z', capacity: 8 }],
  status: 'open', square: { itemId: 'item', variations: { 'all:person': 'v_seat', 'addon:glaze': 'v_glaze' } },
  createdAt: '', updatedAt: '', by, history: [],
}
const promo: PromoCode = {
  code: 'TEN', label: '', off: { kind: 'percent', percent: 10 }, per: 'booking', appliesTo: { kind: 'all' }, includeExtras: false,
  endsYmd: null, maxUses: null, active: true, createdAt: '', updatedAt: '', by, history: [],
}

describe('orderLinesFor — per-line discounts (stage 4)', () => {
  it('one discount per discount per line, indexed to its order line; undiscounted lines have none', () => {
    const r = quote(cls, { passId: 'all', tickets: { person: 2 }, seats: [{ addOns: { glaze: 1 } }, {}] }, NOW, 9, { promo })
    if (!r.ok) throw new Error(r.error)
    const o = orderLinesFor(cls, r.value)
    expect(o.ok && o.lines.map((l) => l.catalogObjectId)).toEqual(['v_seat', 'v_glaze', 'v_seat'])
    expect(o.ok && o.discounts).toEqual([
      { line: 0, name: 'Early-bird', cents: 300 }, { line: 0, name: 'Code TEN', cents: 120 },
      { line: 2, name: 'Early-bird', cents: 300 }, { line: 2, name: 'Code TEN', cents: 120 },
    ])
  })
  it('no discounts → an empty list', () => {
    const plain = { ...cls, content: { ...cls.content, earlyBird: null } }
    const r = quote(plain, { passId: 'all', tickets: { person: 1 }, seats: [{}] }, NOW, 9)
    if (!r.ok) throw new Error(r.error)
    const o = orderLinesFor(plain, r.value)
    expect(o.ok && o.discounts).toEqual([])
  })
})

describe('orderLinesFor — D4: the POS item already carries the early-bird price', () => {
  const req = { passId: 'all', tickets: { person: 2 }, seats: [{ addOns: { glaze: 1 } }, {}] }
  it('the early-bird the catalog carries is never taken twice: only the code goes to Square', () => {
    const onPos = { ...cls, square: { ...cls.square, prices: { 'all:person': 1200, 'addon:glaze': 400 } } }
    const r = quote(onPos, req, NOW, 9, { promo })
    if (!r.ok) throw new Error(r.error)
    const o = orderLinesFor(onPos, r.value)
    expect(o.ok && o.discounts).toEqual([{ line: 0, name: 'Code TEN', cents: 120 }, { line: 2, name: 'Code TEN', cents: 120 }])
    expect(o.ok && o.shortCents).toBe(0)
  })
  it('POS still at the early-bird price after it ended (before the hourly flip): the code still goes; the early-bird part is short', () => {
    const later = new Date('2026-11-01T12:00:00Z')
    const onPos = { ...cls, square: { ...cls.square, prices: { 'all:person': 1200, 'addon:glaze': 400 } } }
    const r = quote(onPos, req, later, 9, { promo })
    if (!r.ok) throw new Error(r.error)
    // Quote: $15 − 10% = $13.50 a seat. M1: the stale $3 never swallows the code: the code goes, $3 a seat is short
    // (Square's total is then lower than the quote, charged in the customer's favour, owners emailed).
    const o = orderLinesFor(onPos, r.value)
    expect(o.ok && o.discounts).toEqual([{ line: 0, name: 'Code TEN', cents: 150 }, { line: 2, name: 'Code TEN', cents: 150 }])
    expect(o.ok && o.shortCents).toBe(600)
  })
  it('M1 (the review probe): our record says the POS is at the early-bird, Square is already back at the regular price; a 50¢ code is still sent, so Square charges the $14.50 shown', async () => {
    const later = new Date('2026-11-01T12:00:00Z')
    const fifty: PromoCode = { ...promo, code: 'FIFTY', off: { kind: 'amount', cents: 50 } }
    const one = { ...cls, content: { ...cls.content, addOns: [], earlyBird: { untilYmd: '2026-10-30', prices: { all: { person: 1400 } } } } }
    const stale = { ...one, square: { ...one.square, prices: { 'all:person': 1400 } } }
    const r = quote(stale, { passId: 'all', tickets: { person: 1 } }, later, 9, { promo: fifty })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.subtotalCents).toBe(1450)
    const o = orderLinesFor(stale, r.value)
    // Before the fix the "carried" $1 swallowed the code: nothing was sent and Square (really at $15) charged $15 + tax.
    expect(o.ok && o.discounts).toEqual([{ line: 0, name: 'Code FIFTY', cents: 50 }])
    // Square, really at $15, with that discount: exactly the quote ($14.50 + $1.31 tax).
    const { MockPaymentProvider } = await import('@providers/mock/payment')
    const square = new MockPaymentProvider()
    square.prices = { v_seat: 1500 }
    const order = await square.createClassOrder({ locationId: 'L', customerId: null, idempotencyKey: 'k', referenceId: 'bkg_x', lines: o.ok ? o.lines : [], lineDiscounts: o.ok ? o.discounts : [] })
    expect(order.totalCents).toBe(r.value.totalCents)
  })
  it('POS still at the regular price while the early-bird runs (saved while Square was down): the early-bird goes as a discount', () => {
    const onPos = { ...cls, square: { ...cls.square, prices: { 'all:person': 1500, 'addon:glaze': 400 } } }
    const r = quote(onPos, req, NOW, 9)
    if (!r.ok) throw new Error(r.error)
    const o = orderLinesFor(onPos, r.value)
    expect(o.ok && o.discounts).toEqual([{ line: 0, name: 'Early-bird', cents: 300 }, { line: 2, name: 'Early-bird', cents: 300 }])
  })
})

describe('planRefund — a discounted seat refunds what Square charged for it (stage 4)', () => {
  const line = (seat: number, over: Partial<LedgerLine> = {}): LedgerLine => ({
    id: `led_${seat}`, bookingId: 'bkg_1', sessionIds: ['s1'], ticketTypeId: 'person', passId: 'all', seat,
    priceCents: 1333, taxCents: 120, listCents: 1500, discounts: [{ kind: 'promo', name: 'Code FIVE', cents: 167 }],
    addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null,
    customer: { givenName: 'A', familyName: 'B', email: 'a@b.c', phone: '' },
    square: { orderId: 'o', paymentId: 'p', lineUid: null, chargedCents: 4359, lineNetCents: 1333, lineTaxCents: 120 },
    by: null, refunds: [], at: '', ...over,
  })
  it('one person: their Square net + tax, never the list price', () => {
    const lines = [line(1), line(2, { square: { orderId: 'o', paymentId: 'p', lineUid: null, chargedCents: 4359, lineNetCents: 1334, lineTaxCents: 121 } }), line(3)]
    const plan = planRefund({ classId: 'cls_d', lines }, { bookingId: 'bkg_1', kind: 'person', lineIds: ['led_2'], reason: 'x' } as any)
    expect(plan.totalCents).toBe(1455) // Square: 1334 + 121; ours would be 1333 + 120
  })
})
