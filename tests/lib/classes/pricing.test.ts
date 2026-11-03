import { describe, it, expect } from 'vitest'
import { quote, sessionsForPass, type BookingRequest } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass, ClassContent } from '@lib/classes/types'

const NOW = new Date('2026-10-20T12:00:00Z')
const sess = (id: string, day: number) => ({
  id, startIso: `2026-10-${day}T18:00:00Z`, endIso: `2026-10-${day}T20:00:00Z`, capacity: 8,
})

function make(over: Partial<ClassContent> = {}, sessions = [sess('ses_a', 22), sess('ses_b', 23), sess('ses_c', 24), sess('ses_d', 25)]): ScheduledClass {
  const content: ClassContent = {
    name: 'Camp', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [
      { id: 'all', label: 'Full series', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
      { id: 'rest', label: 'Rest', covers: { kind: 'remaining' } },
    ],
    prices: { all: { person: 1500 }, day: { person: 500 }, rest: { person: 300 } },
    questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120, ...over,
  }
  return {
    id: 'cls_1', libraryId: null, libraryVersion: null, content, sessions, status: 'open',
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
  }
}
const req = (o: Partial<BookingRequest> = {}): BookingRequest => ({ passId: 'all', tickets: { person: 1 }, ...o })

describe('quote', () => {
  it('3 people at $15, 9%: per-line tax 135, total 4905', () => {
    const r = quote(make(), req({ tickets: { person: 3 } }), NOW, 9)
    expect(r.ok && r.value.lines.map((l) => l.taxCents)).toEqual([135, 135, 135])
    expect(r.ok && r.value.totalCents).toBe(4905)
    expect(r.ok && r.value.seats).toBe(3)
    expect(r.ok && r.value.lines[0].variationKey).toBe('all:person')
  })
  it('adult and kid cells, seats in ticket type order', () => {
    const c = make({
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      prices: { all: { adult: 2000, kid: 1000 } },
    })
    const r = quote(c, req({ tickets: { kid: 2, adult: 1 } }), NOW, 0)
    expect(r.ok && r.value.lines.map((l) => [l.ticketTypeId, l.cents])).toEqual([['adult', 2000], ['kid', 1000], ['kid', 1000]])
    expect(r.ok && r.value.totalCents).toBe(4000)
  })
  it('full series vs one-day pass', () => {
    const c = make()
    const all = quote(c, req(), NOW, 9)
    expect(all.ok && all.value.sessionIds).toEqual(['ses_a', 'ses_b', 'ses_c', 'ses_d'])
    const day = quote(c, req({ passId: 'day', sessionIds: ['ses_c'] }), NOW, 9)
    expect(day.ok && day.value.sessionIds).toEqual(['ses_c'])
    expect(day.ok && day.value.subtotalCents).toBe(500)
  })
  it('refuses a not-sold cell', () => {
    const c = make({ ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }], prices: { all: { adult: 2000 } } })
    const r = quote(c, req({ tickets: { kid: 1 } }), NOW, 9)
    expect(!r.ok && r.error).toBe("Kid tickets aren't sold for this pass.")
  })
  it('refuses zero people and too many', () => {
    expect(quote(make(), req({ tickets: { person: 0 } }), NOW, 9).ok).toBe(false)
    expect(quote(make(), req({ tickets: { person: 11 } }), NOW, 9).ok).toBe(false)
    expect(quote(make(), req({ tickets: { person: 10 } }), NOW, 9).ok).toBe(true)
  })
  it('add-ons are their own taxed lines and respect maxPerSeat', () => {
    const c = make({ addOns: [{ id: 'add1', label: 'Extra glaze', priceCents: 250, maxPerSeat: 2 }] })
    const ok = quote(c, req({ seats: [{ addOns: { add1: 2 } }] }), NOW, 9)
    expect(ok.ok && ok.value.lines.slice(1)).toHaveLength(2)
    for (const i of [1, 2]) expect(ok.ok && ok.value.lines[i]).toMatchObject({ kind: 'addon', label: 'Extra glaze', cents: 250, variationKey: 'addon:add1' })
    // Square rounds the order's tax once, half to even (tax-square-rounding fixtures): 135 + 22.5 + 22.5 = 180, shared 135/22/23.
    expect(ok.ok && ok.value.lines.map((l) => l.taxCents)).toEqual([135, 22, 23])
    expect(ok.ok && ok.value.totalCents).toBe(1500 + 500 + 180)
    const three = quote(make({ addOns: [{ id: 'add1', label: 'Extra glaze', priceCents: 250, maxPerSeat: 3 }] }), req({ seats: [{ addOns: { add1: 3 } }] }), NOW, 9)
    expect(three.ok && three.value.lines.slice(1).reduce((n, l) => n + l.taxCents, 0)).toBe(67) // 135 + 67.5 = 202.5 → 202 on the order (half to even), as Square
    expect(quote(c, req({ seats: [{ addOns: { add1: 3 } }] }), NOW, 9).ok).toBe(false)
    expect(quote(c, req(), NOW, 9).ok).toBe(false) // seats array required when add-ons exist
  })
  it('required answers name the seat', () => {
    const c = make({ questions: [{ id: 'q1', label: 'Pumpkin color', choices: ['Orange', 'White'] }] })
    const r = quote(c, req({ tickets: { person: 2 }, seats: [{ answers: { q1: 'Orange' } }, { answers: {} }] }), NOW, 9)
    expect(!r.ok && r.error).toBe('Seat 2 needs a pumpkin color.')
    const bad = quote(c, req({ seats: [{ answers: { q1: 'Blue' } }] }), NOW, 9)
    expect(bad.ok).toBe(false)
    expect(quote(c, req({ seats: [{ answers: { q1: 'White' } }] }), NOW, 9).ok).toBe(true)
  })
  it('non-taxable class has no tax', () => {
    const c = make({ rules: { ...defaultRules(), taxable: false } })
    const r = quote(c, req(), NOW, 9)
    expect(r.ok && r.value.taxCents).toBe(0)
    expect(r.ok && r.value.totalCents).toBe(1500)
  })
  it('refuses an unknown pass or ticket type', () => {
    expect(quote(make(), req({ passId: 'nope' }), NOW, 9).ok).toBe(false)
    expect(quote(make(), req({ tickets: { ghost: 1 } }), NOW, 9).ok).toBe(false)
  })
})

describe('sessionsForPass', () => {
  it('choose needs exactly N distinct sessions of this class', () => {
    const c = make({ passes: [{ id: 'two', label: 'Two', covers: { kind: 'choose', count: 2 } }], prices: {} })
    expect(sessionsForPass(c, 'two', ['ses_a'], NOW).ok).toBe(false)
    expect(sessionsForPass(c, 'two', ['ses_a', 'ses_a'], NOW).ok).toBe(false)
    expect(sessionsForPass(c, 'two', ['ses_a', 'ses_zzz'], NOW).ok).toBe(false)
    expect(sessionsForPass(c, 'two', undefined, NOW).ok).toBe(false)
    const r = sessionsForPass(c, 'two', ['ses_b', 'ses_a'], NOW)
    expect(r.ok && r.value).toEqual(['ses_a', 'ses_b'])
  })
  it('remaining returns only sessions after now', () => {
    const later = new Date('2026-10-23T19:00:00Z') // a and b started, c and d not
    const c = make({ rules: { ...defaultRules(), joinPartway: true } })
    const r = sessionsForPass(c, 'rest', undefined, later)
    expect(r.ok && r.value).toEqual(['ses_c', 'ses_d'])
  })
  it('remaining refused when joinPartway is false and class started', () => {
    const later = new Date('2026-10-23T19:00:00Z')
    const r = sessionsForPass(make({ rules: { ...defaultRules(), joinPartway: false } }), 'rest', undefined, later)
    expect(!r.ok && r.error).toBe('This class has already started.')
    // before it starts, it is fine
    expect(sessionsForPass(make({ rules: { ...defaultRules(), joinPartway: false } }), 'rest', undefined, NOW).ok).toBe(true)
  })
  it('remaining refused when none remain', () => {
    const c = make({ rules: { ...defaultRules(), joinPartway: true } })
    expect(sessionsForPass(c, 'rest', undefined, new Date('2026-11-01T00:00:00Z')).ok).toBe(false)
  })
  it('all and fixed refused once their first session has started', () => {
    const later = new Date('2026-10-23T19:00:00Z')
    const c = make({ passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }, { id: 'fx', label: 'Weekend', covers: { kind: 'fixed', sessionIds: ['ses_c', 'ses_d'] } }] })
    const a = sessionsForPass(c, 'all', undefined, later)
    expect(!a.ok && a.error).toBe('Sign-ups for this have closed.')
    const f = sessionsForPass(c, 'fx', undefined, later)
    expect(f.ok && f.value).toEqual(['ses_c', 'ses_d'])
  })
})

describe('R28: no joining partway closes every pass at the first session', () => {
  const later = new Date('2026-10-23T19:00:00Z') // a and b started, c and d not
  const closed = make({
    rules: { ...defaultRules(), joinPartway: false },
    passes: [
      { id: 'all', label: 'All', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
      { id: 'fx', label: 'Weekend', covers: { kind: 'fixed', sessionIds: ['ses_c', 'ses_d'] } },
    ],
    prices: { all: { person: 1500 }, day: { person: 500 }, fx: { person: 800 } },
  })
  it('a single-day (choose) pass is refused once the class has started', () => {
    const r = sessionsForPass(closed, 'day', ['ses_d'], later)
    expect(!r.ok && r.error).toBe('Sign-ups for this have closed.')
  })
  it('a fixed pass on later days is refused once the class has started', () => {
    const r = sessionsForPass(closed, 'fx', undefined, later)
    expect(!r.ok && r.error).toBe('Sign-ups for this have closed.')
  })
  it('before the first session every pass still sells', () => {
    expect(sessionsForPass(closed, 'day', ['ses_d'], NOW).ok).toBe(true)
    expect(sessionsForPass(closed, 'fx', undefined, NOW).ok).toBe(true)
  })
  it('joining partway allowed: later single days still sell', () => {
    const open = make({ ...closed.content, rules: { ...defaultRules(), joinPartway: true } })
    expect(sessionsForPass(open, 'day', ['ses_d'], later).ok).toBe(true)
  })
  it('the sign-up cutoff counts from the class’s first session for every pass', async () => {
    const { cutoffRefusal } = await import('@lib/classes/checkout')
    const madeAhead = { ...closed, content: { ...closed.content, rules: { ...closed.content.rules, signupCutoffHours: 24 } } }
    // 2026-10-21T19:00Z is under 24 h before ses_a (Oct 22 18:00Z), days before ses_d
    const at = new Date('2026-10-21T19:00:00Z')
    expect(cutoffRefusal(madeAhead, ['ses_d'], at)).not.toBeNull()
    const partway = { ...madeAhead, content: { ...madeAhead.content, rules: { ...madeAhead.content.rules, joinPartway: true } } }
    expect(cutoffRefusal(partway, ['ses_d'], at)).toBeNull()
  })
})

describe('door sales (crew at the door)', () => {
  const during = new Date('2026-10-22T18:30:00Z') // ses_a running
  it('a session already running can still be sold at the door, not online', () => {
    const c = make()
    expect(sessionsForPass(c, 'day', ['ses_a'], during).ok).toBe(false)
    expect(sessionsForPass(c, 'day', ['ses_a'], during, { door: true }).ok).toBe(true)
    const q = quote(c, req({ passId: 'all' }), during, 9, { door: true })
    expect(q.ok && q.value.sessionIds).toEqual(['ses_a', 'ses_b', 'ses_c', 'ses_d'])
  })
  it('a session that has ended can’t be sold at the door', () => {
    const after = new Date('2026-10-22T20:30:00Z')
    expect(sessionsForPass(make(), 'day', ['ses_a'], after, { door: true }).ok).toBe(false)
  })
})

// ── Stage 4: discounts per line ──────────────────────────────────────────────
import { splitAmount } from '@lib/classes/pricing'
import type { PromoCode } from '@lib/promos/types'

const promo = (over: Partial<PromoCode> = {}): PromoCode => ({
  code: 'FALLFRIENDS', label: '', off: { kind: 'percent', percent: 10 }, per: 'booking', appliesTo: { kind: 'all' },
  includeExtras: false, endsYmd: null, maxUses: null, active: true, createdAt: '', updatedAt: '', by: { id: 'c', name: 'C' }, history: [], ...over,
})
const one = (over: Partial<ClassContent> = {}) => make({ passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }], prices: { all: { person: 1500 } }, ...over })
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value }

describe('splitAmount', () => {
  it('largest remainder, ties to the earlier line', () => {
    expect(splitAmount(500, [1500, 1500, 1500])).toEqual([167, 167, 166])
    expect(splitAmount(100, [1000, 3000])).toEqual([25, 75])
    expect(splitAmount(1, [100, 100, 100])).toEqual([1, 0, 0])
  })
  it('never above a line; zero lines take nothing', () => {
    expect(splitAmount(300, [100, 200])).toEqual([100, 200])
    expect(splitAmount(50, [0, 100])).toEqual([0, 50])
    expect(splitAmount(0, [100])).toEqual([0])
    expect(splitAmount(10, [])).toEqual([])
    expect(splitAmount(999, [100, 200])).toEqual([100, 200]) // capped at the lines' sum
  })
  it('always adds up', () => {
    for (const [t, ls] of [[777, [333, 444, 555]], [5, [1, 1, 1, 1, 1, 1, 1]], [1234, [999, 1, 2000]]] as [number, number[]][]) {
      const out = splitAmount(t, ls)
      expect(out.reduce((s, x) => s + x, 0)).toBe(Math.min(t, ls.reduce((s, x) => s + x, 0)))
      out.forEach((x, i) => expect(x).toBeLessThanOrEqual(ls[i]))
    }
  })
})

describe('quote — discounts per line (stage 4)', () => {
  it('no discount: list = net, no discounts, totals as before', () => {
    const q = ok(quote(make(), req({ tickets: { person: 3 } }), NOW, 9))
    expect(q.lines.every((l) => l.listCents === l.cents && l.discounts.length === 0)).toBe(true)
    expect(q.discountCents).toBe(0)
    expect(q.promo).toBeNull()
    expect(q.totalCents).toBe(4905)
  })
  it('early-bird before and after its Chicago end', () => {
    const c = one({ earlyBird: { untilYmd: '2026-10-20', prices: { all: { person: 1200 } } } })
    const before = ok(quote(c, req(), new Date('2026-10-21T04:59:00Z'), 9)) // 11:59 PM CDT Oct 20
    expect(before.lines[0]).toMatchObject({ listCents: 1500, cents: 1200, taxCents: 108, discounts: [{ kind: 'early-bird', name: 'Early-bird', cents: 300 }] })
    expect(before.totalCents).toBe(1308)
    const after = ok(quote(c, req(), new Date('2026-10-21T05:00:00Z'), 9))
    expect(after.lines[0]).toMatchObject({ listCents: 1500, cents: 1500, discounts: [] })
  })
  it('10% of $15 = $1.50 off, tax on $13.50', () => {
    const q = ok(quote(one(), req(), NOW, 9, { promo: promo() }))
    expect(q.lines[0]).toMatchObject({ listCents: 1500, cents: 1350, taxCents: 122, discounts: [{ kind: 'promo', name: 'Code FALLFRIENDS', cents: 150 }] })
    expect(q.promo).toEqual({ code: 'FALLFRIENDS', cents: 150 })
    expect(q.discountCents).toBe(150)
    expect(q.subtotalCents).toBe(1350)
    expect(q.totalCents).toBe(1472)
  })
  it('split pennies: $5 per booking over 3 × $15 → 167/167/166, the add-on untouched', () => {
    const c = one({ addOns: [{ id: 'glaze', label: 'Glaze', priceCents: 400, maxPerSeat: 1 }] })
    const r = req({ tickets: { person: 3 }, seats: [{ addOns: { glaze: 1 } }, {}, {}] })
    const q = ok(quote(c, r, NOW, 9, { promo: promo({ off: { kind: 'amount', cents: 500 } }) }))
    expect(q.lines.map((l) => [l.kind, l.cents, l.discounts.map((d) => d.cents)])).toEqual([
      ['seat', 1333, [167]], ['addon', 400, []], ['seat', 1333, [167]], ['seat', 1334, [166]],
    ])
    expect(q.promo).toEqual({ code: 'FALLFRIENDS', cents: 500 })
    // With extras: the add-on shares the $5 by its size.
    const x = ok(quote(c, r, NOW, 9, { promo: promo({ off: { kind: 'amount', cents: 500 }, includeExtras: true }) }))
    expect(x.lines.map((l) => l.discounts[0]?.cents ?? 0)).toEqual([153, 41, 153, 153])
    expect(x.promo!.cents).toBe(500)
  })
  it('$20 per booking on a $15 total → $15 off, a $0 line with no tax', () => {
    const q = ok(quote(one(), req(), NOW, 9, { promo: promo({ off: { kind: 'amount', cents: 2000 } }) }))
    expect(q.lines[0]).toMatchObject({ cents: 0, taxCents: 0, discounts: [{ kind: 'promo', cents: 1500 }] })
    expect(q.totalCents).toBe(0)
    expect(q.promo!.cents).toBe(1500)
  })
  it('$ off each person: per seat, never below 0; extras too only when switched on', () => {
    const c = make({ passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }], ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }], prices: { all: { adult: 2000, kid: 300 } } })
    const q = ok(quote(c, req({ tickets: { adult: 1, kid: 1 } }), NOW, 9, { promo: promo({ off: { kind: 'amount', cents: 500 }, per: 'seat' }) }))
    expect(q.lines.map((l) => [l.cents, l.discounts[0]?.cents])).toEqual([[1500, 500], [0, 300]])
    expect(q.promo!.cents).toBe(800)
  })
  it('early-bird + 50% code stack: the code comes off the early-bird price', () => {
    const c = one({ earlyBird: { untilYmd: '2026-10-30', prices: { all: { person: 1200 } } } })
    const q = ok(quote(c, req(), NOW, 9, { promo: promo({ off: { kind: 'percent', percent: 50 } }) }))
    expect(q.lines[0]).toMatchObject({
      listCents: 1500, cents: 600, taxCents: 54,
      discounts: [{ kind: 'early-bird', name: 'Early-bird', cents: 300 }, { kind: 'promo', name: 'Code FALLFRIENDS', cents: 600 }],
    })
    expect(q.discountCents).toBe(900)
  })
  it('a percent that makes a half-cent tax rounds as Square does (half to even)', () => {
    // 30% off $15 = $10.50; 9% of 1050 = 94.5 → 94 (sandbox E2E scenario 49: Square charged $11.44)
    const q = ok(quote(one(), req(), NOW, 9, { promo: promo({ off: { kind: 'percent', percent: 30 } }) }))
    expect(q.lines[0]).toMatchObject({ cents: 1050, taxCents: 94 })
    expect(q.totalCents).toBe(1144)
  })
  it('a code that is off, ended or not for this class is not applied by quote()', () => {
    expect(ok(quote(one(), req(), NOW, 9, { promo: promo({ active: false }) })).promo).toBeNull()
    expect(ok(quote(one(), req(), NOW, 9, { promo: promo({ endsYmd: '2026-10-19' }) })).promo).toBeNull()
    expect(ok(quote(one(), req(), NOW, 9, { promo: promo({ appliesTo: { kind: 'classes', libraryIds: [], classIds: ['cls_other'] } }) })).promo).toBeNull()
  })
  it('a not-taxable class: discounts, no tax', () => {
    const c = one({ rules: { ...one().content.rules, taxable: false } })
    const q = ok(quote(c, req(), NOW, 9, { promo: promo() }))
    expect(q.lines[0]).toMatchObject({ cents: 1350, taxCents: 0 })
  })
})

import { agreedLinesOf, atAgreedPrices } from '@lib/classes/pricing'

describe('atAgreedPrices (D6)', () => {
  const two = { ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }], prices: { all: { adult: 2000, kid: 1000 } } }
  it('each line is charged min(today, agreed); the difference is a "Waitlist price" discount; tax on what is charged', () => {
    const then = quote(make(two), req({ tickets: { adult: 1, kid: 1 } }), NOW, 9)
    if (!then.ok) throw new Error()
    const agreed = agreedLinesOf(then.value)
    // Adult went up to $25, kid went down to $8.
    const now = quote(make({ ...two, prices: { all: { adult: 2500, kid: 800 } } }), req({ tickets: { adult: 1, kid: 1 } }), NOW, 9)
    if (!now.ok) throw new Error()
    const q = atAgreedPrices(make(two), now.value, agreed, 9)
    expect(q.lines.map((l) => l.cents)).toEqual([2000, 800])
    expect(q.lines[0].discounts).toEqual([{ kind: 'waitlist', name: 'Waitlist price', cents: 500 }])
    expect(q.lines[1].discounts).toEqual([])
    expect(q.lines.map((l) => l.taxCents)).toEqual([180, 72])
    expect(q.totalCents).toBe(3052)
    expect(q.discountCents).toBe(500)
  })
  it('lines that don’t match what was agreed (other tickets) → unchanged', () => {
    const now = quote(make(two), req({ tickets: { adult: 2 } }), NOW, 9)
    if (!now.ok) throw new Error()
    expect(atAgreedPrices(make(two), now.value, [{ key: 'all:adult', seat: 0, cents: 100 }], 9)).toBe(now.value)
    expect(atAgreedPrices(make(two), now.value, null, 9)).toBe(now.value)
  })
})
