import { describe, it, expect, vi, beforeEach } from 'vitest'

// Square answers from fixtures; the seat ledger and kv stores are real (temp dir).
const sq = vi.hoisted(() => ({
  orders: new Map<string, any>(),
  payments: new Map<string, any>(),
  catalog: new Map<string, any>(),
  search: [] as any[][],
  calls: [] as { path: string; body: any }[],
  fail: null as null | RegExp,
  refundPages: [] as any[][],
  searchCursor: false,
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
    if (path === '/orders/search') { const page = sq.search.shift() ?? []; return { orders: page, ...(sq.search.length && sq.searchCursor ? { cursor: 'NEXT' } : {}) } }
    if (path.startsWith('/refunds?')) { const page = sq.refundPages.shift() ?? []; return { refunds: page, ...(sq.refundPages.length ? { cursor: `RC${sq.refundPages.length}` } : {}) } }
    throw new Error(`unexpected Square call ${path}`)
  },
}))

const classes = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => classes.list,
  getClass: async (id: string) => classes.list.find((c) => c.id === id) ?? null,
}))
const freed = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@lib/classes/refunds', async (orig) => ({ ...(await orig<typeof import('@lib/classes/refunds')>()), onSeatFreed: freed }))

import {
  handleOrder, handleRefund, handleSquareEvent, reconcileClasses, splitCents,
  listUnmatchedPos, listPosNeedsDays, listRefundFlags, resolveRefundFlag, resetCatalogCache, SQUARE_BY,
  setPosDays, decideRefundFlag, flagUnconfirmedRequests,
} from '@lib/classes/square-events'
import { getLedger, seatsTaken, recordRefund } from '@lib/classes/seat-ledger'
import { createRefundRequest, markRequestDone, changeRefundRequest } from '@lib/classes/refund-requests'
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
  sq.refundPages = []; sq.searchCursor = false
  resetCatalogCache()
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
    // The sold variation rides along, so /admin can start the match on the right seat.
    expect(mine.find((u) => u.lineUid === gone.uid)).toMatchObject({ variationId: 'VAR_GONE' })

    sq.fail = /batch-retrieve/
    const o2 = order([lineItem('VAR_NOT_LOOKED_UP', 1, 2500)])
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

  it('a plain amount refund is recorded as money at once, keeps every seat, and asks a person about the seat', async () => {
    const { cls, o, paymentId } = await posSale(2)
    const rf = refund(paymentId, 1000, { order_id: o.id })
    expect(await handleSquareEvent(refundEvent('refund.created', rf), NOW)).toMatchObject({ action: 'flagged', kind: 'plain-refund', recordedCents: 1000 })
    await handleSquareEvent(refundEvent('refund.updated', rf), NOW) // replay
    const ledger = await getLedger(cls.id)
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(2)
    const entries = ledger.lines.flatMap((l) => l.refunds.map((r) => ({ seat: l.seat, ...r })))
    expect(entries).toEqual([expect.objectContaining({ seat: 1, cents: 1000, freedSeat: false, squareRefundId: rf.id, by: SQUARE_BY })])
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

  it('our own refund whose webhook beat the save: our record replaces Square\'s, and the flag is hidden', async () => {
    const { cls, paymentId } = await posSale(1)
    const rf = refund(paymentId, 3270)
    await handleRefund(rf, NOW)
    expect((await listRefundFlags()).some((f) => f.squareRefundId === rf.id)).toBe(true)
    const [line] = (await getLedger(cls.id)).lines
    await recordRefund(cls.id, [line.id], { cents: 3270, reason: 'Sick', by, freeSeat: true, squareRefundId: rf.id })
    expect((await listRefundFlags()).some((f) => f.squareRefundId === rf.id)).toBe(false)
    const [after] = (await getLedger(cls.id)).lines
    expect(after.refunds).toEqual([expect.objectContaining({ cents: 3270, freedSeat: true, by, reason: 'Sick', squareRefundId: rf.id })])
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(0)
    // and a late replay of the webhook changes nothing
    expect(await handleRefund(rf, NOW)).toMatchObject({ action: 'ignored', why: 'already-recorded' })
    expect((await getLedger(cls.id)).lines[0].refunds).toHaveLength(1)
  })

  it('a plain refund spreads in seat order, capped at what each seat has left, and is never recorded twice', async () => {
    const { cls, o, paymentId } = await posSale(3) // 3 × $32.70
    const rf = refund(paymentId, 5000, { order_id: o.id })
    await handleRefund(rf, NOW)
    await handleRefund(rf, NOW)
    const lines = (await getLedger(cls.id)).lines.sort((a, b) => a.seat - b.seat)
    expect(lines.map((l) => l.refunds.reduce((s, r) => s + r.cents, 0))).toEqual([3270, 1730, 0])
    expect(lines[2].refunds).toEqual([])
    expect(lines.every((l) => !l.refunds.some((r) => r.freedSeat))).toBe(true)
    const [f] = (await listRefundFlags()).filter((x) => x.squareRefundId === rf.id)
    expect(f).toMatchObject({ kind: 'plain-refund', cents: 5000, refundCents: 5000 })
  })

  it('a plain refund on a payment that covers two classes spreads class by class and asks about each class', async () => {
    const a = makeClass(); const b = makeClass(); classes.list = [a, b]
    const o = order([lineItem(a.square.variations['all:person'], 1, 3000), lineItem(b.square.variations['day:person'], 1, 1000)])
    await handleOrder(o, NOW)
    const paymentId = o.tenders[0].payment_id
    const rf = refund(paymentId, 4000)
    expect(await handleRefund(rf, NOW)).toMatchObject({ action: 'flagged', kind: 'plain-refund', recordedCents: 4000 })
    const onA = (await getLedger(a.id)).lines[0].refunds
    const onB = (await getLedger(b.id)).lines[0].refunds
    expect(onA).toEqual([expect.objectContaining({ cents: 3270, squareRefundId: rf.id, freedSeat: false })])
    expect(onB).toEqual([expect.objectContaining({ cents: 730, squareRefundId: rf.id, freedSeat: false })])
    const flags = (await listRefundFlags()).filter((x) => x.squareRefundId === rf.id)
    expect(flags.map((f) => [f.classId, f.cents]).sort()).toEqual([[a.id, 3270], [b.id, 730]].sort())
    await handleRefund(rf, NOW) // replay
    expect((await getLedger(b.id)).lines[0].refunds).toHaveLength(1)
    expect((await listRefundFlags()).filter((x) => x.squareRefundId === rf.id)).toHaveLength(2)
  })

  it('a split-tender sale: a refund on the second card is ours', async () => {
    const cls = makeClass(); classes.list = [cls]
    const li = lineItem(cls.square.variations['all:person'], 1, 3000)
    const o = order([li], {
      tenders: [
        { id: 'TND_A', type: 'CARD', amount_money: usd(2000), payment_id: 'PAY_A' },
        { id: 'TND_B', type: 'CARD', amount_money: usd(1270), payment_id: 'PAY_B' },
      ],
    })
    await handleOrder(o, NOW)
    const rf = refund('PAY_B', 1270)
    expect(await handleRefund(rf, NOW)).toMatchObject({ action: 'flagged', kind: 'plain-refund', recordedCents: 1270 })
    expect((await getLedger(cls.id)).lines[0].refunds[0]).toMatchObject({ cents: 1270, squareRefundId: rf.id })
  })

  it('refund.updated FAILED on one of our refunds: shown to the owners, the ledger is left alone', async () => {
    const { cls, paymentId } = await posSale(1)
    const [line] = (await getLedger(cls.id)).lines
    const rf = refund(paymentId, 3270)
    await recordRefund(cls.id, [line.id], { cents: 3270, reason: 'Sick', by, freeSeat: true, squareRefundId: rf.id })
    const before = JSON.stringify((await getLedger(cls.id)).lines)
    expect(await handleSquareEvent(refundEvent('refund.updated', { ...rf, status: 'FAILED' }), NOW)).toMatchObject({ action: 'flagged', kind: 'refund-failed' })
    await handleSquareEvent(refundEvent('refund.updated', { ...rf, status: 'FAILED' }), NOW)
    expect((await listRefundFlags()).filter((f) => f.squareRefundId === rf.id)).toEqual([expect.objectContaining({ kind: 'refund-failed', classId: cls.id })])
    expect(JSON.stringify((await getLedger(cls.id)).lines)).toBe(before)
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
    expect(search.query.filter.state_filter.states).toEqual(['COMPLETED', 'OPEN'])
    expect(search.query.filter.date_time_filter.updated_at).toEqual({ start_at: '2026-10-18T15:00:00.000Z', end_at: NOW.toISOString() })
    expect(search.query.sort.sort_field).toBe('UPDATED_AT')
  })

  it('looks up unknown items in the catalog once per run, however many orders', async () => {
    const cls = makeClass(); classes.list = [cls]
    sq.catalog.set('VAR_LATTE', { type: 'ITEM_VARIATION', id: 'VAR_LATTE', item_variation_data: { item_id: 'ITEM_LATTE', sku: '' } })
    sq.catalog.set('ITEM_LATTE', { type: 'ITEM', id: 'ITEM_LATTE', item_data: { name: 'Latte', categories: [{ id: 'CAT_CAFE' }] } })
    sq.catalog.set('VAR_OLD', { type: 'ITEM_VARIATION', id: 'VAR_OLD', item_variation_data: { item_id: 'ITEM_OLD', sku: 'cls_old' } })
    const orders = Array.from({ length: 30 }, (_, i) => order([
      lineItem('VAR_LATTE', 1, 450), lineItem(`VAR_MUFFIN_${i % 5}`, 1, 300), lineItem(cls.square.variations['all:person'], 1, 3000),
      ...(i === 7 ? [lineItem('VAR_OLD', 1, 2500)] : []),
    ]))
    sq.search = [orders.slice(0, 15), orders.slice(15)]; sq.searchCursor = true
    expect(await reconcileClasses(NOW)).toMatchObject({ orders: 30, recorded: 30, unmatched: 1, errors: 0 })
    const lookups = sq.calls.filter((c) => c.path === '/catalog/batch-retrieve')
    expect(lookups).toHaveLength(1)
    expect([...lookups[0].body.object_ids].sort()).toEqual(['VAR_LATTE', 'VAR_MUFFIN_0', 'VAR_MUFFIN_1', 'VAR_MUFFIN_2', 'VAR_MUFFIN_3', 'VAR_MUFFIN_4', 'VAR_OLD'])
  })

  it('asks the catalog for at most 1000 ids per call', async () => {
    classes.list = [makeClass()]
    const lines = Array.from({ length: 1001 }, (_, i) => lineItem(`VAR_X${i}`, 1, 100))
    sq.search = [[order(lines)]]
    await reconcileClasses(NOW)
    const lookups = sq.calls.filter((c) => c.path === '/catalog/batch-retrieve')
    expect(lookups.map((c) => c.body.object_ids.length)).toEqual([1000, 1])
  })

  it('the webhook remembers catalog answers between events', async () => {
    classes.list = [makeClass()]
    sq.catalog.set('VAR_LATTE', { type: 'ITEM_VARIATION', id: 'VAR_LATTE', item_variation_data: { item_id: 'ITEM_LATTE', sku: '' } })
    for (let i = 0; i < 3; i++) {
      const o = order([lineItem('VAR_LATTE', 1, 450)])
      sq.orders.set(o.id, o)
      await handleSquareEvent(orderUpdated(o), NOW)
    }
    expect(sq.calls.filter((c) => c.path === '/catalog/batch-retrieve')).toHaveLength(1)
  })

  it('catches an OPEN counter order whose payment went through; an unpaid OPEN order counts nothing', async () => {
    const cls = makeClass(); classes.list = [cls]
    sq.catalog.set('VAR_OLD', { type: 'ITEM_VARIATION', id: 'VAR_OLD', item_variation_data: { item_id: 'ITEM_OLD', sku: 'cls_old' } })
    const paid = order([lineItem(cls.square.variations['all:person'], 1, 3000)], { state: 'OPEN' })
    sq.payments.set(paid.tenders[0].payment_id, { id: paid.tenders[0].payment_id, status: 'COMPLETED' })
    const unpaid = order([lineItem(cls.square.variations['all:person'], 2, 3000), lineItem('VAR_OLD', 1, 2500)], { state: 'OPEN' })
    sq.payments.set(unpaid.tenders[0].payment_id, { id: unpaid.tenders[0].payment_id, status: 'APPROVED' })
    sq.search = [[paid, unpaid]]
    expect(await reconcileClasses(NOW)).toMatchObject({ orders: 2, recorded: 1, unmatched: 0 })
    expect((await getLedger(cls.id)).lines.map((l) => l.square.orderId)).toEqual([paid.id])
    expect((await listUnmatchedPos()).some((u) => u.orderId === unpaid.id)).toBe(false)
  })

  it('a failed catalog lookup is remembered for the rest of the run (no call per order)', async () => {
    classes.list = [makeClass()]
    sq.fail = /batch-retrieve/
    sq.search = [Array.from({ length: 12 }, (_, i) => order([lineItem(`VAR_CAFE_${i}`, 1, 450)]))]
    expect(await reconcileClasses(NOW)).toMatchObject({ orders: 12, errors: 0 })
    expect(sq.calls.filter((c) => c.path === '/catalog/batch-retrieve')).toHaveLength(1)
  })

  it('an owner refund Square never confirmed is flagged after 24 hours, never retried; the flag goes once it is done', async () => {
    const cls = makeClass(); classes.list = [cls]
    const req = await createRefundRequest({
      id: uid('req').toLowerCase(), inputHash: 'h', classId: cls.id, bookingId: 'bkg_x', paymentId: 'PAY_X', kind: 'custom', freeSeat: false,
      reason: 'Sick', by, role: 'owner', lines: [{ id: 'led_x', cents: 500 }], totalCents: 500, prior: 0, rawKey: 'raw', failures: 0,
      idempotencyKey: 'refund:abc', status: 'pending', squareRefundId: null, answered: false,
      createdAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z',
    })
    expect(await reconcileClasses(new Date('2026-10-19T20:00:00Z'))).toMatchObject({ staleRequests: 0 })
    expect(await reconcileClasses(NOW)).toMatchObject({ staleRequests: 1 })
    const flags = (await listRefundFlags()).filter((f) => f.kind === 'refund-unconfirmed' && f.bookingId === 'bkg_x')
    expect(flags).toEqual([expect.objectContaining({ classId: cls.id, paymentId: 'PAY_X', cents: 500, status: 'pending' })])
    expect(sq.calls.some((c) => c.path.startsWith('/refunds') && c.body)).toBe(false) // nothing sent to Square
    await markRequestDone(cls.id, 'bkg_x', req.id, 'RF_LATE')
    expect((await listRefundFlags()).some((f) => f.kind === 'refund-unconfirmed' && f.bookingId === 'bkg_x')).toBe(false)
  })

  it('catches refunds the webhook missed (ListPaymentRefunds, last 48 hours, every page), once', async () => {
    const cls = makeClass(); classes.list = [cls]
    const li = lineItem(cls.square.variations['all:person'], 2, 3000)
    const sale = order([li])
    await handleOrder(sale, NOW)
    const paymentId = sale.tenders[0].payment_id
    const each = li.total_money.amount / 2
    const ret = {
      id: uid('RET'), location_id: 'LOC1', state: 'COMPLETED',
      returns: [{ uid: uid('R'), source_order_id: sale.id, return_line_items: [{ uid: uid('RLI'), source_line_item_uid: li.uid, catalog_object_id: li.catalog_object_id, quantity: '1', total_money: usd(each) }] }],
    }
    sq.orders.set(ret.id, ret)
    const itemized = refund(paymentId, each, { order_id: ret.id })
    const plain = refund(paymentId, 500)
    const cafe = refund('PAY_CAFE', 450)
    const run = () => { sq.refundPages = [[itemized, cafe], [plain]]; return reconcileClasses(NOW) }
    expect(await run()).toMatchObject({ refunds: 3, errors: 0 })
    let ledger = await getLedger(cls.id)
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(1)
    expect(ledger.lines.flatMap((l) => l.refunds).map((r) => r.squareRefundId).sort()).toEqual([itemized.id, plain.id].sort())
    await run()
    ledger = await getLedger(cls.id)
    expect(ledger.lines.flatMap((l) => l.refunds)).toHaveLength(2)

    const lists = sq.calls.filter((c) => c.path.startsWith('/refunds?')).slice(0, 2).map((c) => new URL(`https://x${c.path}`).searchParams)
    expect(lists[0].get('begin_time')).toBe('2026-10-18T15:00:00.000Z')
    expect(lists[0].get('location_id')).toBe('LOC1')
    expect(lists[0].get('cursor')).toBeNull()
    expect(lists[1].get('cursor')).toBe('RC1')
  })
})

describe('Task 14: decisions on counter sales and Square refunds (R27)', () => {
  async function posSale(qty = 2) {
    const cls = makeClass(); classes.list = [cls]
    const li = lineItem(cls.square.variations['all:person'], qty, 3000)
    const o = order([li])
    sq.orders.set(o.id, o)
    await handleOrder(o, NOW)
    return { cls, o, li, paymentId: o.tenders[0].payment_id as string }
  }
  it('setPosDays moves a counter seat of a pick-your-days pass to the chosen day and takes it off the list', async () => {
    const cls = makeClass(); classes.list = [cls]
    const o = order([lineItem(cls.square.variations['day:person'], 1, 1000)], { closed_at: '2026-10-22T21:00:00.000Z' })
    await handleOrder(o, new Date('2026-10-22T21:01:00Z'))
    const [entry] = (await listPosNeedsDays()).filter((p) => p.orderId === o.id)
    await expect(setPosDays(entry.id, ['ses_a', 'ses_b'], { by, role: 'owner' })).rejects.toThrow('Pick 1 day.')
    await expect(setPosDays(entry.id, ['ses_zz'], { by, role: 'owner' })).rejects.toThrow(/not part of this class/)
    await setPosDays(entry.id, ['ses_a'], { by, role: 'owner' })
    const [line] = (await getLedger(cls.id)).lines
    expect(line.sessionIds).toEqual(['ses_a'])
    expect((await listPosNeedsDays()).some((p) => p.id === entry.id)).toBe(false)
  })

  it('decideRefundFlag: "free a seat" frees it with no money and marks the flag decided; "keep" only marks it', async () => {
    const { cls, o, paymentId } = await posSale(2)
    const rf = refund(paymentId, 1000, { order_id: o.id })
    await handleSquareEvent(refundEvent('refund.created', rf), NOW)
    const [flag] = (await listRefundFlags()).filter((f) => f.squareRefundId === rf.id)
    await expect(decideRefundFlag(flag.id, 'freed-seat', { by, role: 'owner' })).rejects.toThrow('Pick which seat to free.')
    const [first] = (await getLedger(cls.id)).lines
    const done = await decideRefundFlag(flag.id, 'freed-seat', { by, role: 'owner' }, [first.id])
    expect(done.resolved).toMatchObject({ by, action: 'freed-seat' })
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(1)
    // decided once: a second tap changes nothing
    await decideRefundFlag(flag.id, 'freed-seat', { by, role: 'owner' }, [first.id])
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(1)
  })

  it('a half-finished "It went through" (money saved, request not marked done) is flagged for a person; the flag goes once it is done', async () => {
    const cls = makeClass(); classes.list = [cls]
    const req = await createRefundRequest({
      id: uid('req').toLowerCase(), inputHash: 'h2', classId: cls.id, bookingId: 'bkg_hf', paymentId: 'PAY_HF', kind: 'custom', freeSeat: false,
      reason: 'Sick', by, role: 'owner', lines: [{ id: 'led_hf', cents: 500 }], totalCents: 500, prior: 0, rawKey: 'raw', failures: 0,
      idempotencyKey: 'refund:hf', status: 'pending', squareRefundId: null, answered: false,
      createdAt: '2026-10-20T14:00:00.000Z', updatedAt: '2026-10-20T14:00:00.000Z',
    })
    await changeRefundRequest(cls.id, 'bkg_hf', req.id, (r) => ({ ...r, status: 'sent', cleared: { at: '2026-10-20T14:05:00.000Z', by, role: 'owner', outcome: 'went-through', reason: 'Saw it in Square' } }))
    // a check still in progress a minute ago isn't flagged yet
    await flagUnconfirmedRequests(new Date('2026-10-20T14:06:00Z'))
    expect((await listRefundFlags()).some((f) => f.bookingId === 'bkg_hf')).toBe(false)
    await flagUnconfirmedRequests(NOW)
    const flags = (await listRefundFlags()).filter((f) => f.bookingId === 'bkg_hf')
    expect(flags).toEqual([expect.objectContaining({ kind: 'refund-unfinished', classId: cls.id, cents: 500, requestId: req.id })])
    await markRequestDone(cls.id, 'bkg_hf', req.id, null)
    expect((await listRefundFlags()).some((f) => f.bookingId === 'bkg_hf')).toBe(false)
  })
})
