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

import { hold, confirm, release, recordRefund, recordRequestRefund, setNames, getLedger, seatsTaken, extendHold } from '@lib/classes/seat-ledger'
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
const fb = (cls: ScheduledClass, r: Partial<BookingRequest> = {}, o: Record<string, unknown> = {}) =>
  ({ cls, quote: q(cls, r), input: input(o) })
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
    const lines = await confirm(cls.id, 'bkg_c', { orderId: 'ord_1', paymentId: 'pay_1' }, fb(cls, { tickets: { person: 2 } }), NOW)
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(l.state).toBe('confirmed')
      expect(l.holdExpiresAt).toBeNull()
      expect(l.square).toMatchObject({ orderId: 'ord_1', paymentId: 'pay_1' })
    }
    // still counts long after the hold would have expired
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(600))).toBe(2)
    const again = await confirm(cls.id, 'bkg_c', { orderId: 'ord_1', paymentId: 'pay_1' }, fb(cls, { tickets: { person: 2 } }), NOW)
    expect(again).toEqual(lines)
  })

  it('confirm after the hold expired and was swept re-creates the seats as confirmed', async () => {
    const cls = make(3)
    const f = fb(cls, { tickets: { person: 2 } }, { bookingId: 'bkg_late' })
    await hold(cls, f.quote, f.input, NOW)
    await hold(cls, q(cls, { passId: 'day', sessionIds: ['ses_b'] }), input({ passId: 'day' }), later(30)) // sweeps bkg_late
    expect((await getLedger(cls.id)).lines.some((l) => l.bookingId === 'bkg_late')).toBe(false)
    const lines = await confirm(cls.id, 'bkg_late', { orderId: 'ord_l', paymentId: 'pay_l' }, f, later(31))
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(l).toMatchObject({ bookingId: 'bkg_late', state: 'confirmed', holdExpiresAt: null, priceCents: 3000, customer: cust })
      expect(l.square).toMatchObject({ orderId: 'ord_l', paymentId: 'pay_l' })
      expect(l.overCapacity).toBeUndefined()
    }
    expect(lines.map((l) => l.seat)).toEqual([1, 2])
    const led = await getLedger(cls.id)
    expect(seatsTaken(led, 'ses_a', later(31))).toBe(2)
    expect(seatsTaken(led, 'ses_b', later(31))).toBe(3) // full, not over
  })

  it('confirm when the seat was taken meanwhile: confirmed, marked over capacity, capacity + 1 taken', async () => {
    const cls = make(1)
    const f = fb(cls, {}, { bookingId: 'bkg_slow' })
    await hold(cls, f.quote, f.input, NOW)
    const other = await hold(cls, q(cls), input({ bookingId: 'bkg_fast' }), later(11)) // sweeps bkg_slow, takes the seat
    expect(other.ok).toBe(true)
    const lines = await confirm(cls.id, 'bkg_slow', { orderId: 'o', paymentId: 'p' }, f, later(12))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ state: 'confirmed', overCapacity: true })
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(12))).toBe(2)
  })

  it('confirm of an expired but unswept hold that another seat now crowds: confirmed and marked over capacity', async () => {
    const cls = make(1)
    hook.key = `ledger-${cls.id}`
    const f = fb(cls, {}, { bookingId: 'bkg_old' })
    await hold(cls, f.quote, f.input, NOW)
    // another server's hold lands without sweeping (its write keeps bkg_old's expired line)
    const cur = await getLedger(cls.id)
    const stranger = { ...cur.lines[0], id: 'led_x', bookingId: 'bkg_x', holdExpiresAt: later(30).toISOString() }
    hook.compete = async (kv) => { await kv.set(hook.key!, JSON.stringify({ ...cur, lines: [...cur.lines, stranger] })) }
    await setNames(cls.id, [cur.lines[0].id], cust) // a write that loses to the stranger once, then retries
    const lines = await confirm(cls.id, 'bkg_old', { orderId: 'o', paymentId: 'p' }, f, later(11))
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe(cur.lines[0].id) // the original line, converted
    expect(lines[0]).toMatchObject({ state: 'confirmed', overCapacity: true, holdExpiresAt: null })
    expect(seatsTaken(await getLedger(cls.id), 'ses_a', later(11))).toBe(2)
  })

  it('confirm after release still records the paid seats', async () => {
    const cls = make(2)
    const f = fb(cls, {}, { bookingId: 'bkg_rel' })
    await hold(cls, f.quote, f.input, NOW)
    await release(cls.id, 'bkg_rel')
    const lines = await confirm(cls.id, 'bkg_rel', { orderId: 'o', paymentId: 'p' }, f, NOW)
    expect(lines).toHaveLength(1)
    expect(lines[0].state).toBe('confirmed')
    const led = await getLedger(cls.id)
    expect(led.lines.filter((l) => l.bookingId === 'bkg_rel').map((l) => l.state).sort()).toEqual(['confirmed', 'released'])
    expect(seatsTaken(led, 'ses_a', NOW)).toBe(1)
  })

  it('repeated confirm after re-creation adds no duplicates', async () => {
    const cls = make(2)
    const f = fb(cls, { tickets: { person: 2 } }, { bookingId: 'bkg_rep' })
    const a = await confirm(cls.id, 'bkg_rep', { orderId: 'o', paymentId: 'p' }, f, NOW)
    const b2 = await confirm(cls.id, 'bkg_rep', { orderId: 'o', paymentId: 'p' }, f, NOW)
    expect(b2).toEqual(a)
    expect((await getLedger(cls.id)).lines).toHaveLength(2)
  })

  for (const freeSeat of [true, false]) {
    it(`confirm after a refund (freeSeat ${freeSeat}) never rebuilds the seats`, async () => {
      const cls = make(2)
      const f = fb(cls, { tickets: { person: 2 } }, { bookingId: `bkg_rf${freeSeat}` })
      await hold(cls, f.quote, f.input, NOW)
      const paid = await confirm(cls.id, f.input.bookingId as string, { orderId: 'o', paymentId: 'p' }, f, NOW)
      await recordRefund(cls.id, paid.map((l) => l.id), { cents: 3270, reason: 'Sick', by, freeSeat, squareRefundId: 'rf' })
      const before = await getLedger(cls.id)
      const takenBefore = seatsTaken(before, 'ses_a', NOW)
      expect(takenBefore).toBe(freeSeat ? 0 : 2)
      const again = await confirm(cls.id, f.input.bookingId as string, { orderId: 'o', paymentId: 'p' }, f, later(60))
      expect(again.map((l) => l.state)).toEqual(['refunded', 'refunded'])
      const after = await getLedger(cls.id)
      expect(after).toEqual(before)
      expect(seatsTaken(after, 'ses_a', NOW)).toBe(takenBefore)
    })
  }

  it('confirm after a goodwill refund on one seat of two returns both paid seats, no rebuild', async () => {
    const cls = make(2)
    const f = fb(cls, { tickets: { person: 2 } }, { bookingId: 'bkg_gw' })
    await hold(cls, f.quote, f.input, NOW)
    const [l1] = await confirm(cls.id, 'bkg_gw', { orderId: 'o', paymentId: 'p' }, f, NOW)
    await recordRefund(cls.id, [l1.id], { cents: 500, reason: 'Goodwill', by, freeSeat: false, squareRefundId: null })
    const again = await confirm(cls.id, 'bkg_gw', { orderId: 'o', paymentId: 'p' }, f, NOW)
    expect(again.map((l) => l.state).sort()).toEqual(['confirmed', 'refunded'])
    expect((await getLedger(cls.id)).lines).toHaveLength(2)
  })

  it('per-line cents: one refund written unevenly over seats in one go, still refusing more than paid', async () => {
    const cls = make(2)
    const f = fb(cls, { tickets: { person: 2 } }, { bookingId: 'bkg_pl' })
    await hold(cls, f.quote, f.input, NOW)
    const [l1, l2] = await confirm(cls.id, 'bkg_pl', { orderId: 'o', paymentId: 'p' }, f, NOW)
    await expect(recordRefund(cls.id, [l1.id, l2.id], { cents: { [l1.id]: 100, [l2.id]: 99999 }, reason: 'x', by, freeSeat: false, squareRefundId: 'rf_pl0' }))
      .rejects.toThrow(/more than was paid/)
    const out = await recordRefund(cls.id, [l1.id, l2.id], { cents: { [l1.id]: 1000, [l2.id]: 250 }, reason: 'x', by, freeSeat: false, squareRefundId: 'rf_pl' })
    expect(out.map((l) => l.refunds.map((r) => r.cents))).toEqual([[1000], [250]])
  })

  it('a retried refund with the same Square refund id is recorded once', async () => {
    const cls = make(2)
    const f = fb(cls, {}, { bookingId: 'bkg_rr' })
    await hold(cls, f.quote, f.input, NOW)
    const [l] = await confirm(cls.id, 'bkg_rr', { orderId: 'o', paymentId: 'p' }, f, NOW)
    const r = { cents: 2000, reason: 'part', by, freeSeat: false, squareRefundId: 'rf_same' }
    await recordRefund(cls.id, [l.id], r)
    const again = await recordRefund(cls.id, [l.id], r) // 4000 would be over the 3270 paid; skipped, not refused
    expect(again[0].refunds).toHaveLength(1)
    // a different refund id is a new refund
    const third = await recordRefund(cls.id, [l.id], { ...r, cents: 1000, squareRefundId: 'rf_other' })
    expect(third[0].refunds.map((x) => x.squareRefundId)).toEqual(['rf_same', 'rf_other'])
    // null ids are never treated as duplicates
    const fourth = await recordRefund(cls.id, [l.id], { ...r, cents: 100, squareRefundId: null })
    const fifth = await recordRefund(cls.id, [l.id], { ...r, cents: 100, squareRefundId: null })
    expect(fourth[0].refunds).toHaveLength(3)
    expect(fifth[0].refunds).toHaveLength(4)
  })

  it('a saved refund request is written in ONE change (asked seats + spill-over) and never twice for the same request', async () => {
    const cls = make(2)
    const f = fb(cls, { tickets: { person: 2 } }, { bookingId: 'bkg_rq' })
    await hold(cls, f.quote, f.input, NOW)
    const [l1, l2] = await confirm(cls.id, 'bkg_rq', { orderId: 'o', paymentId: 'p' }, f, NOW)
    // seat 2 has only 1000 left, so 500 of its 1500 share spills onto seat 1
    await recordRefund(cls.id, [l2.id], { cents: 2270, reason: 'earlier', by, freeSeat: false, squareRefundId: 'rf_e' })
    const input = { requestId: 'req_1', bookingId: 'bkg_rq', lines: [{ id: l2.id, cents: 1500 }], freeSeat: true, reason: 'Sick', by, squareRefundId: null }
    const out = await recordRequestRefund(cls.id, input)
    expect(out.map((l) => l.id)).toEqual([l2.id])
    let after = Object.fromEntries((await getLedger(cls.id)).lines.map((l) => [l.id, l]))
    expect(after[l2.id].refunds.at(-1)).toMatchObject({ cents: 1000, freedSeat: true, requestId: 'req_1', squareRefundId: null })
    expect(after[l1.id].refunds).toEqual([expect.objectContaining({ cents: 500, freedSeat: false, requestId: 'req_1' })])
    // the same request again (by request id, and again with Square's id now known) writes nothing
    await recordRequestRefund(cls.id, input)
    await recordRequestRefund(cls.id, { ...input, squareRefundId: 'rf_q' })
    after = Object.fromEntries((await getLedger(cls.id)).lines.map((l) => [l.id, l]))
    expect(after[l1.id].refunds).toHaveLength(1)
    expect(after[l2.id].refunds).toHaveLength(2)
  })

  it('a saved refund request whose Square refund id is already on the ledger is not written again', async () => {
    const cls = make(2)
    const f = fb(cls, {}, { bookingId: 'bkg_rq2' })
    await hold(cls, f.quote, f.input, NOW)
    const [l] = await confirm(cls.id, 'bkg_rq2', { orderId: 'o', paymentId: 'p' }, f, NOW)
    const input = { requestId: 'req_2', bookingId: 'bkg_rq2', lines: [{ id: l.id, cents: 1000 }], freeSeat: false, reason: 'x', by, squareRefundId: 'rf_2' }
    await recordRequestRefund(cls.id, input)
    await recordRequestRefund(cls.id, { ...input, requestId: 'req_other' })
    expect((await getLedger(cls.id)).lines[0].refunds).toHaveLength(1)
  })

  it('release frees held seats but never confirmed ones', async () => {
    const cls = make(2)
    await hold(cls, q(cls), input({ bookingId: 'bkg_h' }), NOW)
    await hold(cls, q(cls), input({ bookingId: 'bkg_p' }), NOW)
    await confirm(cls.id, 'bkg_p', { orderId: 'o', paymentId: 'p' }, fb(cls), NOW)
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
    const [l1, l2] = await confirm(cls.id, 'bkg_r', { orderId: 'o', paymentId: 'p' }, fb(cls, { tickets: { person: 2 } }), NOW)
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
    const [l] = await confirm(cls.id, 'bkg_x', { orderId: 'o', paymentId: 'p' }, fb(cls, { seats }, { seats }), NOW)
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

describe('extendHold and the charged amount', () => {
  it('extends only that booking’s held lines; the seats keep counting past the old expiry', async () => {
    const cls = make(3)
    const a = input(), other = input()
    await hold(cls, q(cls), a, NOW)
    await hold(cls, q(cls), other, NOW)
    const until = later(24 * 60).toISOString()
    expect(await extendHold(cls.id, a.bookingId, until)).toBe(1)
    const led = await getLedger(cls.id)
    expect(led.lines.find((l) => l.bookingId === a.bookingId)!.holdExpiresAt).toBe(until)
    expect(led.lines.find((l) => l.bookingId === other.bookingId)!.holdExpiresAt).toBe(later(10).toISOString())
    expect(seatsTaken(led, 'ses_a', later(60))).toBe(1)
  })

  it('leaves confirmed seats alone and answers 0 when nothing is held', async () => {
    const cls = make(3)
    const a = input()
    await hold(cls, q(cls), a, NOW)
    await confirm(cls.id, a.bookingId, { orderId: 'o', paymentId: 'p' }, fb(cls), NOW)
    expect(await extendHold(cls.id, a.bookingId, later(999).toISOString())).toBe(0)
    expect((await getLedger(cls.id)).lines[0].holdExpiresAt).toBeNull()
  })

  it('confirm keeps the booking’s Square total on every line', async () => {
    const cls = make(3)
    const a = input()
    await hold(cls, q(cls, { tickets: { person: 2 } }), a, NOW)
    const lines = await confirm(cls.id, a.bookingId, { orderId: 'o', paymentId: 'p', chargedCents: 6541 }, fb(cls, { tickets: { person: 2 } }), NOW)
    expect(lines.map((l) => l.square.chargedCents)).toEqual([6541, 6541])
  })
})

describe('door seats paid at the counter (Task 14)', () => {
  it('a POS sale of the same pass pays the door-counter seat instead of adding a second one; a replay adds nothing', async () => {
    const { recordPos } = await import('@lib/classes/seat-ledger')
    const cls = make(4)
    const q = quote(cls, { passId: 'day', sessionIds: ['ses_b'], tickets: { person: 1 } }, NOW, 9)
    if (!q.ok) throw new Error(q.error)
    // taken at the door on Fri Oct 23 (the day of ses_b), before it starts
    const TAKEN = new Date('2026-10-23T17:30:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TAKEN)
    const held = await hold(cls, q.value, { bookingId: 'bkg_door1', passId: 'day', source: 'door-counter', customer: cust, ttlMinutes: 10, by }, TAKEN)
    expect(held.ok).toBe(true)
    await confirm(cls.id, 'bkg_door1', { orderId: null, paymentId: null }, { cls, quote: q.value, input: { bookingId: 'bkg_door1', passId: 'day', source: 'door-counter', customer: cust, ttlMinutes: 10 } }, TAKEN)
    vi.useRealTimers()
    const sale = { bookingId: 'bkg_pos_O1', orderId: 'O1', paymentId: 'PAY1', chargedCents: 1090, saleIso: '2026-10-23T19:00:00.000Z', lines: [{ lineUid: 'L1', passId: 'day', ticketTypeId: 'person', sessionIds: ['ses_a'], units: [{ priceCents: 1000, taxCents: 90 }] }] }
    // R32: a sale on another day never pays it; it is its own counter seat
    const other = await recordPos(cls, { ...sale, bookingId: 'bkg_pos_O0', orderId: 'O0', saleIso: '2026-10-22T19:00:00.000Z' }, NOW)
    expect(other.map((l) => l.source)).toEqual(['pos'])
    const got = await recordPos(cls, sale, NOW)
    expect(got).toHaveLength(1)
    let lines = (await getLedger(cls.id)).lines.filter((l) => l.bookingId !== 'bkg_pos_O0')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ bookingId: 'bkg_door1', source: 'door-counter', sessionIds: ['ses_b'], customer: cust, square: { orderId: 'O1', paymentId: 'PAY1', lineUid: 'L1' } })
    expect(await recordPos(cls, sale, NOW)).toEqual([])
    // a second counter sale with no door seat waiting is a new counter seat
    await recordPos(cls, { ...sale, bookingId: 'bkg_pos_O2', orderId: 'O2' }, NOW)
    lines = (await getLedger(cls.id)).lines.filter((l) => l.bookingId !== 'bkg_pos_O0')
    expect(lines.map((l) => l.source)).toEqual(['door-counter', 'pos'])
  })
})

describe('R32/N1/R34: which door seat a counter sale pays', () => {
  async function doorSeat(cls: ScheduledClass, bookingId: string, passId: string, sessionIds: string[], at: Date, who = cust) {
    const qq = quote(cls, { passId, ...(passId === 'day' ? { sessionIds } : {}), tickets: { person: 1 } }, at, 9, { door: true })
    if (!qq.ok) throw new Error(qq.error)
    const inp = { bookingId, passId, source: 'door-counter' as const, customer: who, ttlMinutes: 10 }
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at)
    await hold(cls, qq.value, inp, at)
    await confirm(cls.id, bookingId, { orderId: null, paymentId: null }, { cls, quote: qq.value, input: inp }, at)
    vi.useRealTimers()
  }
  const sale = (orderId: string, passId: string, saleIso: string) => ({
    bookingId: `bkg_pos_${orderId}`, orderId, paymentId: `P_${orderId}`, chargedCents: 3270, saleIso,
    lines: [{ lineUid: `L_${orderId}`, passId, ticketTypeId: 'person', sessionIds: ['ses_a', 'ses_b'], units: [{ priceCents: 3000, taxCents: 270 }] }],
  })

  it('N1: a multi-day door seat taken on day 1 is never paid by someone else’s sale on day 2', async () => {
    const { recordPos } = await import('@lib/classes/seat-ledger')
    const cls = make(4)
    await doorSeat(cls, 'bkg_dora', 'all', ['ses_a', 'ses_b'], new Date('2026-10-22T17:00:00.000Z'))
    const got = await recordPos(cls, sale('W1', 'all', '2026-10-23T17:00:00.000Z'), NOW)
    expect(got.map((l) => l.source)).toEqual(['pos'])
    const dora = (await getLedger(cls.id)).lines.find((l) => l.bookingId === 'bkg_dora')!
    expect(dora.square.orderId).toBeNull()
  })

  it('R34: two unpaid door seats that day: the oldest is paid and marked for a person to check', async () => {
    const { recordPos, markCounterMatchChecked } = await import('@lib/classes/seat-ledger')
    const cls = make(4)
    await doorSeat(cls, 'bkg_first', 'all', ['ses_a', 'ses_b'], new Date('2026-10-22T16:00:00.000Z'))
    await doorSeat(cls, 'bkg_second', 'all', ['ses_a', 'ses_b'], new Date('2026-10-22T16:30:00.000Z'))
    await recordPos(cls, sale('M1', 'all', '2026-10-22T17:00:00.000Z'), NOW)
    const lines = (await getLedger(cls.id)).lines
    const first = lines.find((l) => l.bookingId === 'bkg_first')!
    expect(first.square.orderId).toBe('M1')
    expect(first.counterMatch).toMatchObject({ orderId: 'M1', candidates: 2, checked: null })
    expect(lines.find((l) => l.bookingId === 'bkg_second')!.square.orderId).toBeNull()
    await markCounterMatchChecked(cls.id, first.id, by)
    expect((await getLedger(cls.id)).lines.find((l) => l.id === first.id)!.counterMatch!.checked).toMatchObject({ by })
  })
})
