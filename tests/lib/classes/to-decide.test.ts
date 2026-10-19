// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Square answers from fixtures (read only: orders); the ledger and stores are real (temp dir).
const sq = vi.hoisted(() => ({ orders: new Map<string, any>(), calls: [] as { path: string; method?: string }[] }))
vi.mock('@lib/classes/square-api', () => ({
  SQUARE_API_VERSION: '2026-01-22',
  squareSettings: () => ({ locationId: 'LOC1', classesCategoryId: 'CAT_CLASSES' }),
  squareFetch: async (path: string, init: RequestInit = {}) => {
    sq.calls.push({ path, method: init.method })
    const m = path.match(/^\/orders\/([^/]+)$/)
    if (m) {
      const order = sq.orders.get(decodeURIComponent(m[1]))
      if (!order) throw Object.assign(new Error('not found'), { status: 404 })
      return { order }
    }
    throw new Error(`unexpected Square call ${path}`)
  },
}))
const classes = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => classes.list,
  getClass: async (id: string) => classes.list.find((c) => c.id === id) ?? null,
}))
const audit = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@lib/audit', () => ({ recordAudit: audit }))
const email = vi.hoisted(() => vi.fn(async () => ({ sent: true })))
vi.mock('@lib/email', () => ({ sendRefundEmail: email }))

import { makeKvStore } from '@lib/blob-store'
import { decide, listToDecide, nameCounterSeats, DecideError, MINIMUM_AHEAD_MS } from '@lib/classes/to-decide'
import { getLedger, seatsTaken, type LedgerLine } from '@lib/classes/seat-ledger'
import { changeRefundRequest, createRefundRequest, listRefundRequests } from '@lib/classes/refund-requests'
import { defaultRules } from '@lib/classes/validate'
import { listDoorUnpaid } from '@lib/classes/door-unpaid'
import { groupBookings } from '@lib/classes/admin-actions'
import { paidWay } from '@lib/classes/booking-words'
import type { ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-10-20T15:00:00Z')
const CATHERINE = { id: 'owner-catherine', name: 'Catherine' }
let n = 0
const uid = (p: string) => `${p}${++n}x${Date.now().toString(36)}`
const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')
const flagsKv = makeKvStore('refund-flags', 'refund-flags')
const unmatchedKv = makeKvStore('unmatched-pos', 'unmatched-pos')
const daysKv = makeKvStore('pos-needs-days', 'pos-needs-days')

function makeClass(over: Partial<ScheduledClass> = {}): ScheduledClass {
  const id = `cls_${uid('td')}`
  return {
    id, libraryId: null, libraryVersion: null,
    content: {
      name: `Camp ${n}`, description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'person', label: 'Person' }],
      passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }],
      prices: { all: { person: 3000 }, day: { person: 1000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120,
    },
    sessions: [
      { id: 'ses_a', startIso: '2026-10-22T18:00:00.000Z', endIso: '2026-10-22T20:00:00.000Z', capacity: 8 },
      { id: 'ses_b', startIso: '2026-10-23T18:00:00.000Z', endIso: '2026-10-23T20:00:00.000Z', capacity: 8 },
    ],
    status: 'open', square: { itemId: 'ITEM', variations: {} }, createdAt: '', updatedAt: '', by: CATHERINE, history: [],
    ...over,
  } as ScheduledClass
}
function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    id: uid('led_'), bookingId: 'bkg_1', sessionIds: ['ses_a', 'ses_b'], ticketTypeId: 'person', passId: 'all', seat: 1,
    priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed',
    holdExpiresAt: null, customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0100' },
    square: { orderId: 'o1', paymentId: 'p1', lineUid: null, chargedCents: 6540 }, by: null, refunds: [], at: '2026-10-10T15:00:00.000Z',
    ...over,
  }
}
const seed = (cls: ScheduledClass, lines: LedgerLine[]) => ledgerKv.set(`ledger-${cls.id}`, JSON.stringify({ classId: cls.id, lines }))
const items = async () => (await listToDecide(NOW)).items
const find = async (kind: string) => (await items()).find((i) => i.kind === kind && !i.done)!

beforeEach(() => {
  classes.list = []
  sq.orders.clear()
  sq.calls = []
  audit.mockClear()
  email.mockClear()
})
afterEach(() => vi.useRealTimers())

/** Each test's items are its own: it reads only its kind (the stores keep earlier tests' records). */
describe('To decide: what is waiting', () => {
  it('is empty with nothing on file, and a source that fails is named while the rest show', async () => {
    const { items: list, failed } = await listToDecide(NOW)
    expect(list.filter((i) => !i.done)).toEqual([])
    expect(failed).toEqual([])
  })
})

describe('a counter sale that matched no class', () => {
  async function unmatched(qty = 2) {
    const orderId = uid('ORD')
    const li = { uid: uid('LI'), catalog_object_id: 'VAR_OLD', quantity: String(qty), name: 'Potholder Looms', total_money: { amount: 3270 * qty }, total_tax_money: { amount: 270 * qty } }
    sq.orders.set(orderId, { id: orderId, state: 'COMPLETED', closed_at: '2026-10-22T16:42:00.000Z', line_items: [li], tenders: [{ payment_id: 'PAY_POS' }] })
    await unmatchedKv.set(`unmatched-${orderId}-${li.uid}`, JSON.stringify({ orderId, lineUid: li.uid, name: 'Potholder Looms', qty, at: '2026-10-22T16:42:00.000Z' }))
    return { orderId, li }
  }

  it('Match to a class: counter seats on the class (over capacity allowed), then names; done shows who did it', async () => {
    const cls = makeClass({ sessions: [{ id: 'ses_a', startIso: '2026-10-24T18:00:00.000Z', endIso: '2026-10-24T20:00:00.000Z', capacity: 1 }] })
    cls.content.name = 'Potholder Looms'
    classes.list = [cls]
    await seed(cls, [line({ sessionIds: ['ses_a'] })]) // already full
    const { orderId, li } = await unmatched(2)
    const item = await find('pos-unmatched')
    expect(item).toMatchObject({ title: 'Counter sale to match', hint: 'Match it to a class' })
    expect(item.head).toMatch(/^2 × Potholder Looms rung up at the counter/)
    expect(item.detail.guessClassId).toBe(cls.id)

    const r = await decide(item.id, 'match', { classId: cls.id, passId: 'all', ticketTypeId: 'person' }, CATHERINE, NOW)
    expect(sq.calls.every((c) => c.method === 'GET')).toBe(true) // Square is only read
    expect(r.seats).toHaveLength(2)
    const ledger = await getLedger(cls.id)
    const pos = ledger.lines.filter((l) => l.source === 'pos')
    expect(pos.map((l) => [l.priceCents, l.taxCents, l.square.orderId, l.square.lineUid, l.square.paymentId, l.overCapacity])).toEqual([
      [3000, 270, orderId, li.uid, 'PAY_POS', true], [3000, 270, orderId, li.uid, 'PAY_POS', true],
    ])
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(3)
    expect(r.decided).toMatchObject({ what: 'Added 2 seats to Potholder Looms · Sat Oct 24', by: CATHERINE })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ by: { ...CATHERINE, role: 'owner' }, action: 'to-decide-match' }))

    expect(await nameCounterSeats(cls.id, [{ lineId: pos[0].id, name: 'Erin  Smith' }, { lineId: pos[1].id, name: ' ' }], CATHERINE)).toBe(1)
    const named = (await getLedger(cls.id)).lines.find((l) => l.id === pos[0].id)!
    expect(named.customer).toEqual({ givenName: 'Erin', familyName: 'Smith', email: '', phone: '' })
    await expect(nameCounterSeats(cls.id, [{ lineId: pos[0].id, name: 'Again' }], CATHERINE)).rejects.toThrow(/can’t be named/)

    const after = (await items()).find((i) => i.id === item.id)!
    expect(after).toMatchObject({ done: 'Added 2 seats to Potholder Looms · Sat Oct 24', doneBy: 'Catherine' })
    await expect(decide(item.id, 'match', { classId: cls.id }, CATHERINE, NOW)).rejects.toMatchObject({ status: 409 })
  })

  it('a pick-a-day way to book needs its date; Not for a class leaves it as a counter sale (audited)', async () => {
    const cls = makeClass(); classes.list = [cls]
    await seed(cls, [])
    await unmatched(1)
    const item = await find('pos-unmatched')
    await expect(decide(item.id, 'match', { classId: cls.id, passId: 'day', ticketTypeId: 'person' }, CATHERINE, NOW)).rejects.toThrow('Pick the date.')
    await expect(decide(item.id, 'match', { classId: cls.id, passId: 'day', ticketTypeId: 'person', sessionIds: ['ses_a', 'ses_b'] }, CATHERINE, NOW)).rejects.toThrow('Pick 1 date.')
    const r = await decide(item.id, 'dismiss', {}, CATHERINE, NOW)
    expect(r.decided.what).toBe('Left as a counter sale')
    expect((await getLedger(cls.id)).lines).toEqual([])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'to-decide-dismiss', details: expect.objectContaining({ what: 'Left as a counter sale' }) }))
  })
})

describe('refunds', () => {
  async function flag(kind: string, cls: ScheduledClass, bookingId: string, extra: Record<string, unknown> = {}) {
    const id = `flag-${kind}-${uid('f')}`
    await flagsKv.set(id, JSON.stringify({ id, kind, classId: cls.id, bookingId, paymentId: 'p1', squareRefundId: uid('RF'), cents: 1635, refundCents: 1635, status: 'COMPLETED', at: NOW.toISOString(), resolved: null, ...extra }))
    return id
  }

  it('a plain Square refund: Free a seat asks which when several are held, frees the picked one with no money; Keep their seat only records', async () => {
    const cls = makeClass(); classes.list = [cls]
    const a = line({ bookingId: 'bkg_t', seat: 1 }), b = line({ bookingId: 'bkg_t', seat: 2 })
    await seed(cls, [a, b])
    await flag('plain-refund', cls, 'bkg_t')
    const item = await find('refund-plain')
    expect(item.head).toBe(`$16.35 refunded in Square on Ada Lovelace’s booking (${cls.content.name}). Free a seat?`)
    expect(item.detail.seats).toEqual([{ lineId: a.id, seat: 1, label: 'Person' }, { lineId: b.id, seat: 2, label: 'Person' }])
    await expect(decide(item.id, 'free', {}, CATHERINE, NOW)).rejects.toMatchObject({ status: 409, extra: { needsPick: true } })
    const r = await decide(item.id, 'free', { lineIds: [b.id] }, CATHERINE, NOW)
    expect(r.decided.what).toBe('Freed 1 seat. Back on sale')
    const ledger = await getLedger(cls.id)
    expect(seatsTaken(ledger, 'ses_a', NOW)).toBe(1)
    expect(ledger.lines.find((l) => l.id === b.id)!.refunds).toEqual([expect.objectContaining({ cents: 0, freedSeat: true, squareRefundId: null })])

    const cls2 = makeClass(); classes.list = [cls, cls2]
    await seed(cls2, [line({ bookingId: 'bkg_k' })])
    await flag('plain-refund', cls2, 'bkg_k')
    const keep = (await items()).find((i) => i.kind === 'refund-plain' && i.classId === cls2.id && !i.done)!
    expect((await decide(keep.id, 'keep', {}, CATHERINE, NOW)).decided.what).toBe('Kept their seat')
    expect(seatsTaken(await getLedger(cls2.id), 'ses_a', NOW)).toBe(1)
  })

  it('Square couldn’t finish a refund: Mark as handled records it', async () => {
    const cls = makeClass(); classes.list = [cls]
    await seed(cls, [line({ bookingId: 'bkg_f' })])
    await flag('refund-failed', cls, 'bkg_f', { status: 'FAILED' })
    const item = await find('refund-failed')
    expect(item.head).toBe(`Square couldn’t finish a $16.35 refund for Ada Lovelace (${cls.content.name}).`)
    expect((await decide(item.id, 'handled', {}, CATHERINE, NOW)).decided.what).toBe('Checked in Square')
  })

  async function savedRequest(cls: ScheduledClass, bookingId: string, lineId: string, over: Record<string, unknown> = {}) {
    return createRefundRequest({
      id: uid('req'), inputHash: uid('h'), classId: cls.id, bookingId, paymentId: 'p1', kind: 'custom', freeSeat: false,
      reason: 'Sick', by: CATHERINE, role: 'owner', lines: [{ id: lineId, cents: 500 }], totalCents: 500, prior: 0, rawKey: 'raw', failures: 0,
      idempotencyKey: `refund:${uid('k')}`, status: 'pending', squareRefundId: null, answered: false,
      createdAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z', ...over,
    } as any)
  }

  it('half finished: Finish it puts the money on the ledger once and finishes the request', async () => {
    const cls = makeClass(); classes.list = [cls]
    const l = line({ bookingId: 'bkg_hf' })
    await seed(cls, [l])
    const req = await savedRequest(cls, 'bkg_hf', l.id)
    await changeRefundRequest(cls.id, 'bkg_hf', req.id, (r) => ({ ...r, status: 'sent', cleared: { at: '2026-10-20T14:00:00.000Z', by: CATHERINE, role: 'owner', outcome: 'went-through', reason: 'Saw it' } }))
    await flag('refund-unfinished', cls, 'bkg_hf', { requestId: req.id, squareRefundId: '', status: 'sent' })
    const item = await find('refund-unfinished')
    expect((await decide(item.id, 'finish', {}, CATHERINE, NOW)).decided.what).toBe('Finished the refund')
    expect((await getLedger(cls.id)).lines[0].refunds.map((r) => r.cents)).toEqual([500])
    expect((await listRefundRequests(cls.id, 'bkg_hf'))[0].status).toBe('done')
  })

  it('no answer from Square: It went through saves the refund; It didn’t go through saves nothing', async () => {
    const cls = makeClass(); classes.list = [cls]
    const a = line({ bookingId: 'bkg_u1' }), b = line({ bookingId: 'bkg_u2' })
    await seed(cls, [a, b])
    const r1 = await savedRequest(cls, 'bkg_u1', a.id)
    const r2 = await savedRequest(cls, 'bkg_u2', b.id)
    await flag('refund-unconfirmed', cls, 'bkg_u1', { requestId: r1.id, squareRefundId: '', status: 'pending' })
    await flag('refund-unconfirmed', cls, 'bkg_u2', { requestId: r2.id, squareRefundId: '', status: 'pending' })
    const list = (await items()).filter((i) => i.kind === 'refund-unconfirmed' && !i.done)
    const one = list.find((i) => i.detail.bookingId === 'bkg_u1')!, two = list.find((i) => i.detail.bookingId === 'bkg_u2')!
    expect((await decide(one.id, 'went-through', {}, CATHERINE, NOW)).decided.what).toBe('It went through')
    expect((await decide(two.id, 'did-not-go-through', {}, CATHERINE, NOW)).decided.what).toBe('It didn’t go through')
    const ledger = await getLedger(cls.id)
    expect(ledger.lines.find((l) => l.id === a.id)!.refunds.map((r) => r.cents)).toEqual([500])
    expect(ledger.lines.find((l) => l.id === b.id)!.refunds).toEqual([])
    expect((await listRefundRequests(cls.id, 'bkg_u2'))[0].status).toBe('turned-down')
  })
})

describe('a counter seat of a pick-your-days pass', () => {
  it('Pick the day moves the seat there (setPosDays) and records it', async () => {
    const cls = makeClass(); classes.list = [cls]
    const l = line({ bookingId: 'bkg_pos_X', source: 'pos', passId: 'day', sessionIds: ['ses_a'], customer: null })
    await seed(cls, [l])
    const id = `days-${uid('X')}`
    await daysKv.set(id, JSON.stringify({ id, classId: cls.id, bookingId: 'bkg_pos_X', lineIds: [l.id], orderId: 'X', lineUid: 'L', passId: 'day', sessionIds: ['ses_a'], at: NOW.toISOString() }))
    const item = await find('pos-needs-days')
    expect(item).toMatchObject({ title: 'Counter seat needs its day', hint: 'Pick the day' })
    await expect(decide(item.id, 'set-days', { sessionIds: ['ses_a', 'ses_b'] }, CATHERINE, NOW)).rejects.toThrow('Pick 1 day.')
    expect((await decide(item.id, 'set-days', { sessionIds: ['ses_b'] }, CATHERINE, NOW)).decided.what).toBe('Put on Fri Oct 23')
    expect((await getLedger(cls.id)).lines[0].sessionIds).toEqual(['ses_b'])
  })
})

describe('short of its minimum', () => {
  it('shows within 3 days of its decide-by; Keep it running and Text the people booked are recorded, never a cancel', async () => {
    const decideBy = '2026-10-22T22:00:00.000Z' // Thu 5 PM
    const cls = makeClass({ sessions: [{ id: 'ses_a', startIso: '2026-10-24T18:00:00.000Z', endIso: '2026-10-24T20:00:00.000Z', capacity: 8 }] })
    cls.content.rules = { ...cls.content.rules, minimumToRun: { count: 6, decideByIso: decideBy } }
    classes.list = [cls]
    await seed(cls, [line({ bookingId: 'bkg_m1', sessionIds: ['ses_a'] }), line({ bookingId: 'bkg_m2', sessionIds: ['ses_a'] })])
    const early = new Date(Date.parse(decideBy) - MINIMUM_AHEAD_MS - 60_000)
    expect((await listToDecide(early)).items.some((i) => i.kind === 'below-minimum' && i.classId === cls.id)).toBe(false)
    const item = (await items()).find((i) => i.kind === 'below-minimum' && i.classId === cls.id)!
    expect(item.head).toBe(`${cls.content.name}: 2 of 6 needed by Thu Oct 22 5 PM`)
    const r = await decide(item.id, 'keep-running', {}, CATHERINE, NOW)
    expect(r.decided.what).toBe('Keeping it running')
    expect(cls.status).toBe('open')
    expect((await getLedger(cls.id)).lines.every((l) => l.state === 'confirmed')).toBe(true)
  })
})

describe('a door seat never rung up', () => {
  it('Mark paid at the counter: it leaves the list and reads "Paid at the counter"; Free the seat frees it with no money', async () => {
    const cls = makeClass({ sessions: [{ id: 'ses_a', startIso: '2026-10-18T18:00:00.000Z', endIso: '2026-10-18T20:00:00.000Z', capacity: 8 }] })
    classes.list = [cls]
    const dora = line({ bookingId: 'bkg_door1', source: 'door-counter', sessionIds: ['ses_a'], square: { orderId: null, paymentId: null, lineUid: null }, customer: { givenName: 'Dora', familyName: 'Door', email: '', phone: '' }, at: '2026-10-18T17:00:00.000Z' })
    const ed = line({ bookingId: 'bkg_door2', source: 'door-counter', sessionIds: ['ses_a'], square: { orderId: null, paymentId: null, lineUid: null }, customer: { givenName: 'Ed', familyName: 'Entry', email: '', phone: '' }, at: '2026-10-18T17:05:00.000Z' })
    await seed(cls, [dora, ed])
    const list = (await items()).filter((i) => i.kind === 'door-unpaid' && i.classId === cls.id)
    expect(list.map((i) => i.title)).toEqual(['Not paid at the counter', 'Not paid at the counter'])
    const one = list.find((i) => i.detail.name === 'Dora Door')!, two = list.find((i) => i.detail.name === 'Ed Entry')!
    expect((await decide(one.id, 'paid', {}, CATHERINE, NOW)).decided.what).toBe('Marked paid at the counter')
    expect((await listDoorUnpaid(NOW)).some((u) => u.bookingId === 'bkg_door1')).toBe(false)
    const paid = groupBookings(await getLedger(cls.id), NOW).find((b) => b.bookingId === 'bkg_door1')!
    expect(paidWay(paid as any)).toBe('Paid at the counter')
    expect((await decide(two.id, 'free', {}, CATHERINE, NOW)).decided.what).toBe('Freed 1 seat')
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(1)
  })
})

describe('a counter sale matched to one of several door seats (R34)', () => {
  it('Yes, it was them checks it; picking someone else moves the payment to them and leaves the first unpaid', async () => {
    const cls = makeClass({ sessions: [{ id: 'ses_a', startIso: '2026-10-21T18:00:00.000Z', endIso: '2026-10-21T20:00:00.000Z', capacity: 8 }] })
    classes.list = [cls]
    const unpaid = { orderId: null, paymentId: null, lineUid: null }
    const paidBySale = { orderId: 'ORD_C', paymentId: 'PAY_C', lineUid: 'LI_C', chargedCents: 3270 }
    const matched = line({ bookingId: 'bkg_c1', source: 'door-counter', sessionIds: ['ses_a'], square: paidBySale, customer: { givenName: 'Cara', familyName: 'One', email: '', phone: '' }, at: '2026-10-20T13:00:00.000Z', counterMatch: { orderId: 'ORD_C', candidates: 2, at: '2026-10-20T14:00:00.000Z', checked: null } })
    const other = line({ bookingId: 'bkg_c2', source: 'door-counter', sessionIds: ['ses_a'], square: unpaid, customer: { givenName: 'Dee', familyName: 'Two', email: '', phone: '' }, at: '2026-10-20T13:10:00.000Z', priceCents: 3000, taxCents: 270 })
    await seed(cls, [matched, other])
    const item = (await items()).find((i) => i.kind === 'counter-match-check' && i.classId === cls.id)!
    expect(item.head).toBe(`A counter sale of ${cls.content.name} on Tue Oct 20 was matched to Cara One. Was it them?`)
    expect(item.detail.others).toEqual([{ lineId: other.id, name: 'Dee Two', seat: 1 }])
    await expect(decide(item.id, 'move', { toLineId: 'led_nobody' }, CATHERINE, NOW)).rejects.toThrow('Pick who it was.')
    const r = await decide(item.id, 'move', { toLineId: other.id }, CATHERINE, NOW)
    expect(r.decided.what).toBe('It was Dee Two: the payment moved')
    const ledger = await getLedger(cls.id)
    const was = ledger.lines.find((l) => l.id === matched.id)!, now = ledger.lines.find((l) => l.id === other.id)!
    expect(was.square).toEqual(unpaid)
    expect(was.counterMatch).toBeUndefined()
    expect(now.square).toEqual(paidBySale)
    expect(now.counterMatch?.checked).toMatchObject({ by: CATHERINE })
    // Cara is now the unpaid one: once the class is over she waits under "Not paid at the counter".
    expect((await listDoorUnpaid(new Date('2026-10-22T00:00:00Z'))).map((u) => u.bookingId)).toContain('bkg_c1')
  })

  it('Yes, it was them marks it checked', async () => {
    const cls = makeClass({ sessions: [{ id: 'ses_a', startIso: '2026-10-21T18:00:00.000Z', endIso: '2026-10-21T20:00:00.000Z', capacity: 8 }] })
    classes.list = [cls]
    const matched = line({ bookingId: 'bkg_y1', source: 'door-counter', sessionIds: ['ses_a'], square: { orderId: 'ORD_Y', paymentId: 'PAY_Y', lineUid: 'LI_Y' }, counterMatch: { orderId: 'ORD_Y', candidates: 2, at: '2026-10-20T14:00:00.000Z', checked: null } })
    await seed(cls, [matched])
    const item = (await items()).find((i) => i.kind === 'counter-match-check' && i.classId === cls.id)!
    expect((await decide(item.id, 'confirm', {}, CATHERINE, NOW)).decided.what).toBe('Yes, it was Ada Lovelace')
    expect((await getLedger(cls.id)).lines[0].counterMatch?.checked).toMatchObject({ by: CATHERINE })
  })
})

describe('refusals', () => {
  it('an unknown item, or a choice that isn’t one for its kind', async () => {
    await expect(decide('nope', 'keep', {}, CATHERINE, NOW)).rejects.toBeInstanceOf(DecideError)
    const cls = makeClass(); classes.list = [cls]
    await seed(cls, [line({ bookingId: 'bkg_z' })])
    const id = `flag-refund-failed-${uid('z')}`
    await flagsKv.set(id, JSON.stringify({ id, kind: 'refund-failed', classId: cls.id, bookingId: 'bkg_z', paymentId: 'p1', squareRefundId: 'RF', cents: 100, status: 'FAILED', at: NOW.toISOString(), resolved: null }))
    await expect(decide(id, 'free', {}, CATHERINE, NOW)).rejects.toMatchObject({ status: 400 })
  })
})
