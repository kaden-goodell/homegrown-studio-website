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
