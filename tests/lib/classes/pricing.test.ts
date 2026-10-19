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
    expect(ok.ok && ok.value.lines[1]).toMatchObject({ kind: 'addon', cents: 500, taxCents: 45, variationKey: 'addon:add1' })
    expect(ok.ok && ok.value.totalCents).toBe(1500 + 135 + 500 + 45)
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
