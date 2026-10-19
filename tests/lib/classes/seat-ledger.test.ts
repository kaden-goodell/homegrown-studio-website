import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wrap the kv store so a test can make the first conditional write of a key
// lose: the hook runs a competing write first, then the write reports false.
const hook = vi.hoisted(() => ({
  key: null as string | null,
  compete: null as null | ((kv: { get(k: string): Promise<string | null>; set(k: string, j: string): Promise<void> }) => Promise<void>),
  loseAll: 0,
}))
vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (...a: Parameters<typeof real.makeKvStore>) => {
      const kv = real.makeKvStore(...a)
      return {
        ...kv,
        setIfMatch: async (...b: Parameters<typeof kv.setIfMatch>) => {
          if (hook.loseAll > 0) { hook.loseAll--; return false }
          if (hook.compete && b[0] === hook.key) {
            const run = hook.compete
            hook.compete = null // once
            await run(kv)
            return false
          }
          return kv.setIfMatch(...b)
        },
      }
    },
  }
})

import { hold, confirm, release, recordRefund, setNames, getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { quote, type BookingRequest } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass, ClassContent } from '@lib/classes/types'

const NOW = new Date('2026-10-20T12:00:00Z')
const by = { id: 'k', name: 'Kaden' }
const cust = { givenName: 'Ann', familyName: 'Lee', email: 'ann@example.com', phone: '4029802907' }
const sess = (id: string, day: number, capacity: number) => ({
  id, startIso: `2026-10-${day}T18:00:00.000Z`, endIso: `2026-10-${day}T20:00:00.000Z`, capacity,
})
let n = 0
function make(capacity = 2, over: Partial<ClassContent> = {}): ScheduledClass {
  const content: ClassContent = {
    name: 'Camp', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [
      { id: 'all', label: 'Full series', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
    ],
    prices: { all: { person: 3000 }, day: { person: 1000 } },
    questions: [], addOns: [], defaultCapacity: capacity, defaultMinutes: 120, ...over,
  }
  return {
    id: `cls_ledgertest${++n}${Date.now().toString(36)}`, libraryId: null, libraryVersion: null, content,
    sessions: [sess('ses_a', 22, capacity), sess('ses_b', 23, capacity)], status: 'open',
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by, history: [],
  }
}
function q(cls: ScheduledClass, r: Partial<BookingRequest> = {}) {
  const res = quote(cls, { passId: 'all', tickets: { person: 1 }, ...r }, NOW, 9)
  if (!res.ok) throw new Error(res.error)
  return res.value
}
let b = 0
const input = (o: Record<string, unknown> = {}) => ({
  bookingId: `bkg_t${++b}`, passId: 'all', source: 'online' as const, customer: cust, ttlMinutes: 10, ...o,
})
const later = (min: number) => new Date(NOW.getTime() + min * 60_000)

beforeEach(() => { hook.key = null; hook.compete = null; hook.loseAll = 0 })

describe('seat ledger', () => {
  it('capacity 2: two holds of 1 are ok, a third is sold out', async () => {
    const cls = make(2)
    const a = await hold(cls, q(cls), input(), NOW)
    const b2 = await hold(cls, q(cls), input(), NOW)
    expect(a.ok && b2.ok).toBe(true)
    const c = await hold(cls, q(cls), input(), NOW)
    expect(c).toEqual({ ok: false, reason: 'sold_out', sessionId: 'ses_a', left: 0 })
    const led = await getLedger(cls.id)
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(2)
    expect(seatsTaken(led, 'ses_b', NOW)).toBe(2)
  })

  it('a hold of 2 against 1 left is sold out and reports what is left', async () => {
    const cls = make(2)
    await hold(cls, q(cls), input(), NOW)
    const r = await hold(cls, q(cls, { tickets: { person: 2 } }), input(), NOW)
    expect(r).toEqual({ ok: false, reason: 'sold_out', sessionId: 'ses_a', left: 1 })
  })

  it('writes one line per seat with the quote money, 1-based seats, per-seat answers and folded add-ons', async () => {
    const cls = make(5, {
      questions: [{ id: 'q_col', label: 'Color', choices: ['Red', 'Blue'] }],
      addOns: [{ id: 'add_frame', label: 'Frame', priceCents: 500, maxPerSeat: 3 }],
    })
    const seats: { answers: Record<string, string>; addOns: Record<string, number> }[] = [
      { answers: { q_col: 'Red' }, addOns: { add_frame: 2 } }, { answers: { q_col: 'Blue' }, addOns: {} },
    ]
    const quoteV = q(cls, { tickets: { person: 2 }, seats })
    const r = await hold(cls, quoteV, input({ bookingId: 'bkg_money', seats, by }), NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(r.lines).toHaveLength(2)
    const [s1, s2] = r.lines
    expect(s1.id).toMatch(/^led_/)
    expect(s1).toMatchObject({
      bookingId: 'bkg_money', sessionIds: ['ses_a', 'ses_b'], ticketTypeId: 'person', passId: 'all', seat: 1,
      priceCents: 3000, taxCents: 270, addOns: { add_frame: 2 }, addOnCents: 1000, addOnTaxCents: 90,
      answers: { q_col: 'Red' }, source: 'online', state: 'held', holdExpiresAt: later(10).toISOString(),
      customer: cust, square: { orderId: null, paymentId: null, lineUid: null }, by, refunds: [],
    })
    expect(s2).toMatchObject({ seat: 2, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: { q_col: 'Blue' } })
  })

  it('concurrent holds on the last seat: the loser retries, sees the winner, and is sold out', async () => {
    const cls = make(1)
    hook.key = `ledger-${cls.id}`
    // Between the loser's read and its write, another buyer's hold lands on the last seat.
    hook.compete = async (kv) => {
      const cur = JSON.parse((await kv.get(hook.key!)) ?? JSON.stringify({ classId: cls.id, lines: [] }))
      cur.lines.push({
        id: 'led_winner', bookingId: 'bkg_winner', sessionIds: ['ses_a', 'ses_b'], ticketTypeId: 'person', passId: 'all',
        seat: 1, priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {},
        source: 'online', state: 'held', holdExpiresAt: later(10).toISOString(), customer: cust,
        square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: NOW.toISOString(),
      })
      await kv.set(hook.key!, JSON.stringify(cur))
    }
    const loser = await hold(cls, q(cls), input({ bookingId: 'bkg_loser' }), NOW)
    expect(hook.compete).toBeNull() // the race fired
    expect(loser).toEqual({ ok: false, reason: 'sold_out', sessionId: 'ses_a', left: 0 })
    const led = await getLedger(cls.id)
    expect(led.lines.filter((l) => l.state === 'held')).toHaveLength(1)
    expect(led.lines[0].bookingId).toBe('bkg_winner')
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(1)
  })

  it('a lost race with a seat still free retries and keeps both holds', async () => {
    const cls = make(2)
    hook.key = `ledger-${cls.id}`
    hook.compete = async (kv) => {
      const first = await hold(make(2), q(cls), input(), NOW) // unrelated class, just to get a well-formed line
      if (!first.ok) throw new Error('x')
      await kv.set(hook.key!, JSON.stringify({ classId: cls.id, lines: [{ ...first.lines[0], bookingId: 'bkg_other' }] }))
    }
    const r = await hold(cls, q(cls), input({ bookingId: 'bkg_mine' }), NOW)
    expect(r.ok).toBe(true)
    expect((await getLedger(cls.id)).lines.map((l) => l.bookingId).sort()).toEqual(['bkg_mine', 'bkg_other'])
  })

  it('two holds started together on the last seat: exactly one ok', async () => {
    const cls = make(1)
    const rs = await Promise.all([hold(cls, q(cls), input(), NOW), hold(cls, q(cls), input(), NOW)])
    // same server: the in-process lock serialises them; the CAS tests above cover two servers
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(1)
  })

  it('three lost races throws a plain retry error', async () => {
    const cls = make(2)
    hook.loseAll = 3
    await expect(hold(cls, q(cls), input(), NOW)).rejects.toThrow('Concurrent update — please retry')
  })

  it('an expired hold frees the seat and is dropped from the stored ledger on the next hold', async () => {
    const cls = make(1)
    const a = await hold(cls, q(cls), input({ bookingId: 'bkg_old' }), NOW)
    expect(a.ok).toBe(true)
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(9))).toBe(1)
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(10))).toBe(0)
    const b2 = await hold(cls, q(cls), input({ bookingId: 'bkg_new' }), later(11))
    expect(b2.ok).toBe(true)
    const led = await getLedger(cls.id)
    expect(led.lines.map((l) => l.bookingId)).toEqual(['bkg_new'])
  })

  it('confirm moves held to confirmed, clears expiry, records Square, and is idempotent', async () => {
    const cls = make(2)
    await hold(cls, q(cls, { tickets: { person: 2 } }), input({ bookingId: 'bkg_c' }), NOW)
    const lines = await confirm(cls.id, 'bkg_c', { orderId: 'ord_1', paymentId: 'pay_1' })
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(l.state).toBe('confirmed')
      expect(l.holdExpiresAt).toBeNull()
      expect(l.square).toMatchObject({ orderId: 'ord_1', paymentId: 'pay_1' })
    }
    // still counts long after the hold would have expired
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(600))).toBe(2)
    const again = await confirm(cls.id, 'bkg_c', { orderId: 'ord_1', paymentId: 'pay_1' })
    expect(again).toEqual(lines)
  })

  it('confirm of an unknown booking throws a plain sentence', async () => {
    const cls = make(2)
    await expect(confirm(cls.id, 'bkg_nope', { orderId: 'o', paymentId: null })).rejects.toThrow(/hold/)
  })

  it('release frees held seats but never confirmed ones', async () => {
    const cls = make(2)
    await hold(cls, q(cls), input({ bookingId: 'bkg_h' }), NOW)
    await hold(cls, q(cls), input({ bookingId: 'bkg_p' }), NOW)
    await confirm(cls.id, 'bkg_p', { orderId: 'o', paymentId: 'p' })
    await release(cls.id, 'bkg_h')
    await release(cls.id, 'bkg_p')
    const led = await getLedger(cls.id)
    expect(led.lines.find((l) => l.bookingId === 'bkg_h')!.state).toBe('released')
    expect(led.lines.find((l) => l.bookingId === 'bkg_p')!.state).toBe('confirmed')
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(1)
  })

  it('refund with freeSeat true frees the seat; false keeps it taken', async () => {
    const cls = make(2)
    await hold(cls, q(cls, { tickets: { person: 2 } }), input({ bookingId: 'bkg_r' }), NOW)
    const [l1, l2] = await confirm(cls.id, 'bkg_r', { orderId: 'o', paymentId: 'p' })
    const r1 = await recordRefund(cls.id, [l1.id], { cents: 3270, reason: 'Sick', by, freeSeat: true, squareRefundId: 'rf_1' })
    expect(r1[0].state).toBe('refunded')
    expect(r1[0].refunds[0]).toMatchObject({ cents: 3270, reason: 'Sick', by, freedSeat: true, squareRefundId: 'rf_1' })
    await recordRefund(cls.id, [l2.id], { cents: 500, reason: 'Goodwill', by, freeSeat: false, squareRefundId: null })
    const led = await getLedger(cls.id)
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(1)
  })

  it('refuses refunding more than the line was paid, counting earlier refunds', async () => {
    const cls = make(2, { addOns: [{ id: 'add_f', label: 'Frame', priceCents: 500, maxPerSeat: 1 }] })
    const seats = [{ answers: {}, addOns: { add_f: 1 } }]
    await hold(cls, q(cls, { seats }), input({ bookingId: 'bkg_x', seats }), NOW)
    const [l] = await confirm(cls.id, 'bkg_x', { orderId: 'o', paymentId: 'p' })
    // paid 3000 + 270 + 500 + 45 = 3815
    await recordRefund(cls.id, [l.id], { cents: 3000, reason: 'part', by, freeSeat: false, squareRefundId: null })
    await expect(recordRefund(cls.id, [l.id], { cents: 816, reason: 'rest', by, freeSeat: true, squareRefundId: null }))
      .rejects.toThrow(/more than/)
    const ok = await recordRefund(cls.id, [l.id], { cents: 815, reason: 'rest', by, freeSeat: true, squareRefundId: null })
    expect(ok[0].refunds).toHaveLength(2)
  })

  it('refuses refunding a seat that is only held', async () => {
    const cls = make(2)
    const r = await hold(cls, q(cls), input(), NOW)
    if (!r.ok) throw new Error('x')
    await expect(recordRefund(cls.id, [r.lines[0].id], { cents: 1, reason: 'x', by, freeSeat: true, squareRefundId: null }))
      .rejects.toThrow()
  })

  it('multi-session pass takes a seat on every session; a one-day pass only on its day', async () => {
    const cls = make(3)
    await hold(cls, q(cls), input(), NOW)
    await hold(cls, q(cls, { passId: 'day', sessionIds: ['ses_b'] }), input({ passId: 'day' }), NOW)
    const led = await getLedger(cls.id)
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(1)
    expect(seatsTaken(led, 'ses_b', NOW)).toBe(2)
  })

  it('allowOverCapacity lets it reach 41 of 40', async () => {
    const cls = make(40)
    for (let i = 0; i < 4; i++) {
      const r = await hold(cls, q(cls, { tickets: { person: 10 } }), input({ source: 'pos', customer: null }), NOW)
      expect(r.ok).toBe(true)
    }
    expect((await hold(cls, q(cls), input(), NOW)).ok).toBe(false)
    const over = await hold(cls, q(cls), input({ source: 'door-counter', allowOverCapacity: true, by }), NOW)
    expect(over.ok).toBe(true)
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', NOW)).toBe(41)
  })

  it('setNames fills in a POS sale with no name', async () => {
    const cls = make(2)
    const r = await hold(cls, q(cls), input({ source: 'pos', customer: null }), NOW)
    if (!r.ok) throw new Error('x')
    await setNames(cls.id, [r.lines[0].id], cust)
    expect((await getLedger(cls.id)).lines[0].customer).toEqual(cust)
  })

  it('an empty ledger reads as no lines', async () => {
    expect(await getLedger('cls_never')).toEqual({ classId: 'cls_never', lines: [] })
  })
})
