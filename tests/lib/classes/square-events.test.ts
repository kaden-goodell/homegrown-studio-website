import { describe, it, expect, vi, beforeEach } from 'vitest'

// Square answers from fixtures; the seat ledger and kv stores are real (temp dir).
const sq = vi.hoisted(() => ({
  orders: new Map<string, any>(),
  payments: new Map<string, any>(),
  catalog: new Map<string, any>(),
  search: [] as any[][],
  calls: [] as { path: string; body: any }[],
  fail: null as null | RegExp,
}))
vi.mock('@lib/classes/square-api', () => ({
  SQUARE_API_VERSION: '2026-01-22',
  squareSettings: () => ({ locationId: 'LOC1', classesCategoryId: 'CAT_CLASSES' }),
  squareFetch: async (path: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null
    sq.calls.push({ path, body })
    if (sq.fail && sq.fail.test(path)) throw Object.assign(new Error('Square said: boom'), { status: 500 })
    let m: RegExpMatchArray | null
    if ((m = path.match(/^\/orders\/([^/]+)$/)) && m[1] !== 'search') {
      const order = sq.orders.get(decodeURIComponent(m[1]))
      if (!order) throw Object.assign(new Error('Square said: not found'), { status: 404 })
      return { order }
    }
    if ((m = path.match(/^\/payments\/([^/]+)$/))) return { payment: sq.payments.get(decodeURIComponent(m[1])) }
    if (path === '/catalog/batch-retrieve') {
      const objects = body.object_ids.map((id: string) => sq.catalog.get(id)).filter(Boolean)
      const related = objects.map((o: any) => sq.catalog.get(o.item_variation_data?.item_id)).filter(Boolean)
      return { objects, related_objects: related }
    }
    if (path === '/orders/search') return { orders: sq.search.shift() ?? [] }
    throw new Error(`unexpected Square call ${path}`)
  },
}))

const classes = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => classes.list,
  getClass: async (id: string) => classes.list.find((c) => c.id === id) ?? null,
}))
const freed = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@lib/classes/refunds', () => ({ onSeatFreed: freed }))

import {
  handleOrder, handleRefund, handleSquareEvent, reconcileClasses, splitCents,
  listUnmatchedPos, listPosNeedsDays, listRefundFlags, resolveRefundFlag,
} from '@lib/classes/square-events'
import { getLedger, seatsTaken, recordRefund } from '@lib/classes/seat-ledger'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-10-20T15:00:00Z')
const by = { id: 'k', name: 'Kaden' }
let n = 0
const uid = (p: string) => `${p}${++n}${Date.now().toString(36).toUpperCase()}`

/** A class with Full series ($30) and One day ($10) passes on the POS, plus a clay add-on. */
function makeClass(capacity = 8): ScheduledClass {
  const id = `cls_${uid('ev').toLowerCase()}`
  return {
    id, libraryId: null, libraryVersion: null,
    content: {
      name: 'Camp', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'person', label: 'Person' }],
      passes: [
        { id: 'all', label: 'Full series', covers: { kind: 'all' } },
        { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
      ],
      prices: { all: { person: 3000 }, day: { person: 1000 } },
      questions: [], addOns: [{ id: 'clay', label: 'Extra clay', priceCents: 500, maxPerSeat: 2 }],
      defaultCapacity: capacity, defaultMinutes: 120,
    },
    sessions: [
      { id: 'ses_a', startIso: '2026-10-22T18:00:00.000Z', endIso: '2026-10-22T20:00:00.000Z', capacity },
      { id: 'ses_b', startIso: '2026-10-23T18:00:00.000Z', endIso: '2026-10-23T20:00:00.000Z', capacity },
    ],
    status: 'open',
    square: { itemId: `ITEM_${id}`, variations: { 'all:person': `VAR_ALL_${id}`, 'day:person': `VAR_DAY_${id}`, 'addon:clay': `VAR_CLAY_${id}` } },
    createdAt: '', updatedAt: '', by, history: [],
  }
}

const usd = (amount: number) => ({ amount, currency: 'USD' })
/** A Square line item as GET /v2/orders returns it (version 2026-01-22). */
function lineItem(variationId: string, qty: number, unitCents: number, opts: { uid?: string; name?: string; taxPct?: number } = {}) {
  const gross = unitCents * qty
  const tax = Math.round(gross * (opts.taxPct ?? 9) / 100)
  return {
    uid: opts.uid ?? uid('LI'), catalog_object_id: variationId, catalog_version: 1, quantity: String(qty),
    name: opts.name ?? 'Camp · Thu Oct 22', variation_name: 'Full series · Person', item_type: 'ITEM',
    base_price_money: usd(unitCents), gross_sales_money: usd(gross), total_tax_money: usd(tax),
    total_discount_money: usd(0), total_money: usd(gross + tax),
  }
}
function order(lines: any[], over: Record<string, any> = {}) {
  const id = uid('ORD')
  const total = lines.reduce((s, l) => s + l.total_money.amount, 0)
  const paymentId = uid('PAY')
  return {
    id, location_id: 'LOC1', source: { name: 'Point of Sale' }, line_items: lines, state: 'COMPLETED',
    version: 4, created_at: '2026-10-20T14:58:00.000Z', updated_at: '2026-10-20T14:59:00.000Z', closed_at: '2026-10-20T14:59:00.000Z',
    total_money: usd(total), net_amounts: { total_money: usd(total) },
    tenders: [{ id: paymentId, location_id: 'LOC1', type: 'CARD', amount_money: usd(total), payment_id: paymentId, card_details: { status: 'CAPTURED' } }],
    ...over,
  }
}
/** The webhook body Square sends for order.updated. */
const orderUpdated = (o: any) => ({
  merchant_id: 'MERCH', type: 'order.updated', event_id: uid('evt-'), created_at: o.updated_at,
  data: { type: 'order_updated', id: o.id, object: { order_updated: { order_id: o.id, state: o.state, location_id: 'LOC1', version: o.version, created_at: o.created_at, updated_at: o.updated_at } } },
})
const refundEvent = (type: 'refund.created' | 'refund.updated', refund: any) => ({
  merchant_id: 'MERCH', type, event_id: uid('evt-'), created_at: '2026-10-21T10:00:00.000Z',
  data: { type: 'refund', id: refund.id, object: { refund } },
})
function refund(paymentId: string, cents: number, over: Record<string, any> = {}) {
  return {
    id: uid('RF'), status: 'COMPLETED', amount_money: usd(cents), payment_id: paymentId, location_id: 'LOC1',
    reason: 'Returned goods', created_at: '2026-10-21T10:00:00.000Z', updated_at: '2026-10-21T10:00:05.000Z', ...over,
  }
}

beforeEach(() => {
  sq.orders.clear(); sq.payments.clear(); sq.catalog.clear(); sq.search = []; sq.calls = []; sq.fail = null
  freed.mockClear()
})

describe('splitCents', () => {
  it('puts the odd cents on the first parts', () => {
    expect(splitCents(1001, 3)).toEqual([334, 334, 333])
    expect(splitCents(0, 2)).toEqual([0, 0])
  })
})

describe('POS sales', () => {
  it('a counter sale of 2 Full series seats becomes 2 counter seats on every session', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 2, 3000)])
    sq.orders.set(o.id, o)
    await handleSquareEvent(orderUpdated(o), NOW)
    const lines = (await getLedger(cls.id)).lines
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(l).toMatchObject({
        source: 'pos', state: 'confirmed', customer: null, passId: 'all', ticketTypeId: 'person',
        sessionIds: ['ses_a', 'ses_b'], priceCents: 3000, taxCents: 270,
        square: { orderId: o.id, paymentId: o.tenders[0].payment_id, lineUid: o.line_items[0].uid, chargedCents: 6540 },
      })
    }
    expect(lines.map((l) => l.seat)).toEqual([1, 2])
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(2)
  })

  it('a replayed webhook (and the payment event for the same order) adds nothing', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 2, 3000)])
    sq.orders.set(o.id, o)
    await handleSquareEvent(orderUpdated(o), NOW)
    await handleSquareEvent(orderUpdated(o), NOW)
    await handleSquareEvent({ type: 'payment.updated', data: { type: 'payment', id: o.tenders[0].id, object: { payment: { id: o.tenders[0].id, status: 'COMPLETED', order_id: o.id } } } }, NOW)
    expect((await getLedger(cls.id)).lines).toHaveLength(2)
  })

  it('our own online order echoed back (reference bkg_) is ignored', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { reference_id: 'bkg_abc123', source: { name: 'Hometown Studio' } })
    sq.orders.set(o.id, o)
    const out = await handleSquareEvent(orderUpdated(o), NOW)
    expect(out).toMatchObject({ skipped: 'not-ours' })
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('an order at another location, or not yet paid, is ignored', async () => {
    const cls = makeClass(); classes.list = [cls]
    const elsewhere = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { location_id: 'LOC2' })
    expect(await handleOrder(elsewhere, NOW)).toMatchObject({ skipped: 'other-location' })
    const open = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { state: 'OPEN', tenders: [] })
    expect(await handleOrder(open, NOW)).toMatchObject({ skipped: 'not-paid' })
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('an OPEN order with a COMPLETED payment is a sale', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { state: 'OPEN' })
    sq.payments.set(o.tenders[0].payment_id, { id: o.tenders[0].payment_id, status: 'COMPLETED', order_id: o.id })
    expect(await handleOrder(o, NOW)).toMatchObject({ recorded: 1 })
  })

  it('seats a full class anyway and marks them over capacity', async () => {
    const cls = makeClass(1); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 2, 3000)])
    await handleOrder(o, NOW)
    const lines = (await getLedger(cls.id)).lines
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.overCapacity)).toBe(true) // like confirm: the booking's seats on a full session
  })

  it('a One day pass from the counter goes on the next session and is listed for staff to set the day', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['day:person'], 1, 1000)], { closed_at: '2026-10-22T21:00:00.000Z' }) // sold after ses_a ended
    await handleOrder(o, new Date('2026-10-22T21:01:00Z'))
    const [line] = (await getLedger(cls.id)).lines
    expect(line.sessionIds).toEqual(['ses_b'])
    const pending = (await listPosNeedsDays()).filter((p) => p.orderId === o.id)
    expect(pending).toEqual([expect.objectContaining({ classId: cls.id, lineIds: [line.id], passId: 'day', sessionIds: ['ses_b'] })])
  })

  it('add-on lines attach to nothing', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['all:person'], 1, 3000), lineItem(cls.square.variations['addon:clay'], 1, 500)])
    expect(await handleOrder(o, NOW)).toMatchObject({ recorded: 1, unmatched: 0 })
  })

  it('an unknown class item is kept for staff; café items are not; nothing throws', async () => {
    const cls = makeClass(); classes.list = [cls]
    sq.catalog.set('VAR_GONE', { type: 'ITEM_VARIATION', id: 'VAR_GONE', item_variation_data: { item_id: 'ITEM_GONE', sku: 'cls_deleted01', name: 'Person' } })
    sq.catalog.set('ITEM_GONE', { type: 'ITEM', id: 'ITEM_GONE', item_data: { name: 'Old camp', categories: [{ id: 'CAT_CLASSES' }] } })
    sq.catalog.set('VAR_CAT', { type: 'ITEM_VARIATION', id: 'VAR_CAT', item_variation_data: { item_id: 'ITEM_CAT', sku: '', name: 'Regular' } })
    sq.catalog.set('ITEM_CAT', { type: 'ITEM', id: 'ITEM_CAT', item_data: { name: 'Paint night', categories: [{ id: 'CAT_CLASSES' }] } })
    sq.catalog.set('VAR_LATTE', { type: 'ITEM_VARIATION', id: 'VAR_LATTE', item_variation_data: { item_id: 'ITEM_LATTE', sku: '', name: 'Large' } })
    sq.catalog.set('ITEM_LATTE', { type: 'ITEM', id: 'ITEM_LATTE', item_data: { name: 'Latte', categories: [{ id: 'CAT_CAFE' }] } })
    const gone = lineItem('VAR_GONE', 2, 2500, { name: 'Old camp' })
    const cat = lineItem('VAR_CAT', 1, 2000, { name: 'Paint night' })
    const o = order([gone, cat, lineItem('VAR_LATTE', 1, 450, { name: 'Latte' })])
    sq.orders.set(o.id, o)
    expect(await handleSquareEvent(orderUpdated(o), NOW)).toMatchObject({ unmatched: 2, recorded: 0 })
    await handleSquareEvent(orderUpdated(o), NOW) // replay: no duplicates
    const mine = (await listUnmatchedPos()).filter((u) => u.orderId === o.id)
    expect(mine).toHaveLength(2)
    expect(mine).toContainEqual(expect.objectContaining({ lineUid: gone.uid, qty: 2, name: expect.stringContaining('Old camp') }))

    sq.fail = /batch-retrieve/
    const o2 = order([lineItem('VAR_GONE', 1, 2500)])
    await expect(handleOrder(o2, NOW)).resolves.toMatchObject({ unmatched: 0 })
  })

  it('a Square error while handling an event is logged, never thrown', async () => {
    sq.fail = /orders/
    await expect(handleSquareEvent(orderUpdated(order([])), NOW)).resolves.toBeNull()
  })
})

describe('Square refunds', () => {
  async function posSale(qty = 2) {
    const cls = makeClass(); classes.list = [cls]
    const li = lineItem(cls.square.variations['all:person'], qty, 3000)
    const o = order([li])
    sq.orders.set(o.id, o)
    await handleOrder(o, NOW)
    return { cls, o, li, paymentId: o.tenders[0].payment_id as string }
  }
  /** The return order Square makes for an itemized refund at the register. */
  function returnOrder(source: any, li: any, qty: number) {
    const id = uid('RET')
    const each = li.total_money.amount / Number(li.quantity)
    const ret = {
      id, location_id: 'LOC1', state: 'COMPLETED', created_at: '2026-10-21T10:00:00.000Z', updated_at: '2026-10-21T10:00:00.000Z',
      returns: [{ uid: uid('R'), source_order_id: source.id, return_line_items: [{
        uid: uid('RLI'), source_line_item_uid: li.uid, catalog_object_id: li.catalog_object_id, quantity: String(qty),
        name: li.name, base_price_money: li.base_price_money, total_tax_money: usd(270 * qty), total_money: usd(each * qty),
      }] }],
    }
    sq.orders.set(id, ret)
    return ret
  }

  it('an itemized return frees that seat (once)', async () => {
    const { cls, o, li, paymentId } = await posSale(2)
    const ret = returnOrder(o, li, 1)
    const rf = refund(paymentId, 3270, { order_id: ret.id })
    expect(await handleSquareEvent(refundEvent('refund.updated', rf), NOW)).toMatchObject({ action: 'freed' })
    let ledger = await getLedger(cls.id)
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(1)
    const refunded = ledger.lines.filter((l) => l.state === 'refunded')
    expect(refunded).toHaveLength(1)
    expect(refunded[0].refunds[0]).toMatchObject({ cents: 3270, freedSeat: true, squareRefundId: rf.id, by: { id: 'square' } })
    expect(freed).toHaveBeenCalledWith(cls.id, ['ses_a', 'ses_b'])

    expect(await handleSquareEvent(refundEvent('refund.updated', rf), NOW)).toMatchObject({ action: 'ignored', why: 'already-recorded' })
    ledger = await getLedger(cls.id)
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(1)
  })

  it('an itemized return of an online seat (no Square line uid) is matched by the class item', async () => {
    const { cls, o, li, paymentId } = await posSale(1)
    // The return line's source uid matches no ledger line, as with a seat sold by our own checkout.
    const ret = returnOrder(o, { ...li, uid: 'SOME_OTHER_UID' }, 1)
    ret.returns[0].return_line_items[0].source_line_item_uid = 'SOME_OTHER_UID'
    const rf = refund(paymentId, 3270, { order_id: ret.id })
    expect(await handleRefund(rf, NOW)).toMatchObject({ action: 'freed' })
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(0)
  })

  it('a plain amount refund is flagged for a person and changes no seats', async () => {
    const { cls, o, paymentId } = await posSale(2)
    const rf = refund(paymentId, 1000, { order_id: o.id })
    expect(await handleSquareEvent(refundEvent('refund.created', rf), NOW)).toMatchObject({ action: 'flagged', kind: 'plain-refund' })
    await handleSquareEvent(refundEvent('refund.updated', rf), NOW) // replay
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(2)
    const flags = (await listRefundFlags()).filter((f) => f.squareRefundId === rf.id)
    expect(flags).toEqual([expect.objectContaining({
      kind: 'plain-refund', classId: cls.id, bookingId: `bkg_pos_${o.id}`, paymentId, cents: 1000, resolved: null,
    })])

    const done = await resolveRefundFlag(flags[0].id, by, 'kept-seat')
    expect(done.resolved).toMatchObject({ by, action: 'kept-seat' })
    expect((await listRefundFlags()).some((f) => f.id === flags[0].id)).toBe(false)
    expect((await listRefundFlags({ includeResolved: true })).some((f) => f.id === flags[0].id)).toBe(true)
    await expect(resolveRefundFlag('flag-nope', by, 'dismissed')).rejects.toThrow(/no longer there/)
  })

  it('a pending refund waits for its final status', async () => {
    const { paymentId } = await posSale(1)
    expect(await handleRefund(refund(paymentId, 100, { status: 'PENDING' }), NOW)).toMatchObject({ action: 'ignored', why: 'pending' })
  })

  it('a refund on a payment that is not ours is ignored', async () => {
    await posSale(1)
    expect(await handleRefund(refund('PAY_CAFE', 450), NOW)).toMatchObject({ action: 'ignored', why: 'not-ours' })
  })

  it('a refund our own flow already recorded is ignored; if Square later fails it, staff are told', async () => {
    const { cls, paymentId } = await posSale(1)
    const [line] = (await getLedger(cls.id)).lines
    const rf = refund(paymentId, 3270)
    await recordRefund(cls.id, [line.id], { cents: 3270, reason: 'Sick', by, freeSeat: true, squareRefundId: rf.id })
    expect(await handleRefund(rf, NOW)).toMatchObject({ action: 'ignored', why: 'already-recorded' })
    expect(await handleRefund({ ...rf, status: 'FAILED' }, NOW)).toMatchObject({ action: 'flagged', kind: 'refund-failed' })
    const [f] = (await listRefundFlags()).filter((x) => x.squareRefundId === rf.id)
    expect(f).toMatchObject({ kind: 'refund-failed', status: 'FAILED' })
    expect((await getLedger(cls.id)).lines[0].state).toBe('refunded') // never undone automatically
  })

  it('a plain refund flag disappears once our own flow records that refund (webhook beat the save)', async () => {
    const { cls, paymentId } = await posSale(1)
    const rf = refund(paymentId, 3270)
    await handleRefund(rf, NOW)
    expect((await listRefundFlags()).some((f) => f.squareRefundId === rf.id)).toBe(true)
    const [line] = (await getLedger(cls.id)).lines
    await recordRefund(cls.id, [line.id], { cents: 3270, reason: 'Sick', by, freeSeat: true, squareRefundId: rf.id })
    expect((await listRefundFlags()).some((f) => f.squareRefundId === rf.id)).toBe(false)
  })
})

describe('nightly reconcile', () => {
  it('finds a sale the webhook missed, once', async () => {
    const cls = makeClass(); classes.list = [cls]
    const missed = order([lineItem(cls.square.variations['all:person'], 3, 3000)])
    const ours = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { reference_id: 'bkg_online1' })
    sq.search = [[missed, ours], [missed, ours]]
    expect(await reconcileClasses(NOW)).toMatchObject({ orders: 2, recorded: 3, errors: 0 })
    expect(await reconcileClasses(NOW)).toMatchObject({ orders: 2, recorded: 0 })
    expect((await getLedger(cls.id)).lines).toHaveLength(3)

    const search = sq.calls.find((c) => c.path === '/orders/search')!.body
    expect(search.location_ids).toEqual(['LOC1'])
    expect(search.query.filter.state_filter.states).toEqual(['COMPLETED'])
    expect(search.query.filter.date_time_filter.updated_at).toEqual({ start_at: '2026-10-18T15:00:00.000Z', end_at: NOW.toISOString() })
    expect(search.query.sort.sort_field).toBe('UPDATED_AT')
  })
})
