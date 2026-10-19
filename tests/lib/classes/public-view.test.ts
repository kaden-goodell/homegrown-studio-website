import { describe, it, expect } from 'vitest'
import { listedPublicly, toPublicClass, viewableByLink } from '@lib/classes/public-view'
import { classAvailability, ownPriceLabel, sessionsLine, withSeatsSold } from '@lib/classes/public-class'
import { priceLabel, workshopStatus } from '@components/workshops/workshop-status'
import { rowWhen } from '@components/workshops/WorkshopRow'
import { defaultRules } from '@lib/classes/validate'
import type { Ledger, LedgerLine } from '@lib/classes/seat-ledger'
import type { ClassContent, ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-10-20T12:00:00Z')
const sess = (id: string, day: number, capacity = 8) => ({ id, startIso: `2026-10-${day}T18:00:00Z`, endIso: `2026-10-${day}T20:00:00Z`, capacity })

function make(over: Partial<ClassContent> = {}, sessions = [sess('ses_a', 24), sess('ses_b', 25)], status: ScheduledClass['status'] = 'open'): ScheduledClass {
  const content: ClassContent = {
    name: 'Camp', description: 'Paint.\n\nEveryone paints.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [
      { id: 'all', label: 'Full series', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
    ],
    prices: { all: { person: 2500 }, day: { person: 1500 } },
    questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120, ...over,
  }
  return {
    id: 'cls_1', libraryId: null, libraryVersion: null, content, sessions, status,
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
  }
}
const line = (sessionIds: string[], state: LedgerLine['state'] = 'confirmed'): LedgerLine => ({
  id: 'led_x', bookingId: 'bkg_x', sessionIds, ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 0, taxCents: 0,
  addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state, holdExpiresAt: null, customer: null,
  square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: '',
})
const ledger = (lines: LedgerLine[] = []): Ledger => ({ classId: 'cls_1', lines })
const many = (n: number, ids: string[]) => Array.from({ length: n }, () => line(ids))

describe('public view — which classes are listed', () => {
  it('lists open and closed classes; hides drafts, cancelled and link-only', () => {
    expect(listedPublicly(make())).toBe(true)
    expect(listedPublicly(make({}, undefined, 'closed'))).toBe(true)
    expect(listedPublicly(make({}, undefined, 'draft'))).toBe(false)
    expect(listedPublicly(make({}, undefined, 'cancelled'))).toBe(false)
    expect(listedPublicly(make({ rules: { ...defaultRules(), linkOnly: true } }))).toBe(false)
  })
  it('a link-only class is still reachable by its link; a draft is not', () => {
    expect(viewableByLink(make({ rules: { ...defaultRules(), linkOnly: true } }))).toBe(true)
    expect(viewableByLink(make({}, undefined, 'draft'))).toBe(false)
    expect(viewableByLink(make({}, undefined, 'cancelled'))).toBe(false)
  })
})

describe('public view — seats', () => {
  it('counts seats left per session from the ledger', () => {
    const w = toPublicClass(make(), ledger([...many(3, ['ses_a', 'ses_b']), ...many(2, ['ses_b'])]), NOW)
    expect(w.own!.sessions.map((s) => [s.id, s.left])).toEqual([['ses_a', 5], ['ses_b', 3]])
    expect(w.own!.passes.find((p) => p.id === 'all')).toMatchObject({ state: 'open', left: 3, sessionIds: ['ses_a', 'ses_b'] })
    expect(w.remainingSeats).toBe(5) // the roomiest open pass: one day on Sat
  })
  it('released seats are not counted', () => {
    const w = toPublicClass(make(), ledger([line(['ses_a'], 'released')]), NOW)
    expect(w.own!.sessions[0].left).toBe(8)
  })
  it('a full session makes the series pass unavailable but leaves the other day', () => {
    const w = toPublicClass(make(), ledger(many(8, ['ses_b'])), NOW)
    expect(w.own!.sessions.map((s) => s.left)).toEqual([8, 0])
    expect(w.own!.passes.find((p) => p.id === 'all')!.state).toBe('full')
    expect(w.own!.passes.find((p) => p.id === 'day')!.state).toBe('open')
    expect(workshopStatus(w).soldOut).toBe(false)
  })
  it('sold out only when every pass is full', () => {
    const w = toPublicClass(make(), ledger(many(8, ['ses_a', 'ses_b'])), NOW)
    expect(w.remainingSeats).toBe(0)
    expect(workshopStatus(w).status).toBe('Sold out')
  })
  it('a closed class shows sign-ups closed, never sold out', () => {
    const w = toPublicClass(make({}, undefined, 'closed'), ledger(many(8, ['ses_a', 'ses_b'])), NOW)
    expect(w).toMatchObject({ signupClosed: true, remainingSeats: null })
    expect(workshopStatus(w).status).toBe('Sign-ups closed')
  })
  it('a session past its cutoff is closed, and the series with it', () => {
    const c = make({ rules: { ...defaultRules(), signupCutoffHours: 48 } }, [sess('ses_a', 21), sess('ses_b', 25)])
    const w = toPublicClass(c, ledger(), NOW)
    expect(w.own!.sessions.map((s) => s.closed)).toEqual([true, false])
    expect(w.own!.passes.find((p) => p.id === 'all')!.state).toBe('closed')
    expect(w.own!.passes.find((p) => p.id === 'day')!.state).toBe('open')
  })
  it('only sellable passes are listed, priced from the class', () => {
    const w = toPublicClass(make({ prices: { day: { person: 1500 } } }), ledger(), NOW)
    expect(w.own!.passes.map((p) => p.id)).toEqual(['day'])
    expect(w.price).toBe(1500)
    expect(w.taxPercent).toBe(9)
  })
  it('selling seats takes them off the sessions and works the passes out again', () => {
    const w = toPublicClass(make(), ledger(many(6, ['ses_a', 'ses_b'])), NOW)
    const own = withSeatsSold(w.own!, ['ses_a', 'ses_b'], 2)
    expect(own.sessions.map((s) => s.left)).toEqual([0, 0])
    expect(classAvailability(own).remainingSeats).toBe(0)
  })
})

describe('public view — card copy', () => {
  it('"From $15" when there are several prices', () => {
    const w = toPublicClass(make(), ledger(), NOW)
    expect(priceLabel(w)).toBe('From $15')
  })
  it('"$20 adult · $15 kid" with one pass and up to three ticket types', () => {
    const c = make({
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
      prices: { all: { adult: 2000, kid: 1500 } },
    })
    expect(priceLabel(toPublicClass(c, ledger(), NOW))).toBe('$20 adult · $15 kid')
  })
  it('"$15" with one price', () => {
    const c = make({ passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }], prices: { all: { person: 1500 } } })
    expect(ownPriceLabel(toPublicClass(c, ledger(), NOW).own!)).toBe('$15')
  })
  it('a class that meets more than once says how many times and when it starts', () => {
    const c = make({}, [sess('ses_a', 24), sess('ses_b', 25), sess('ses_c', 26), sess('ses_d', 27)])
    const w = toPublicClass(c, ledger(), NOW)
    expect(sessionsLine(w.own!)).toBe('4 sessions · starts Sat Oct 24')
    expect(rowWhen(w)).toBe('4 sessions · starts Sat Oct 24')
  })
  it('a one-session class reads like any other row', () => {
    const w = toPublicClass(make({}, [sess('ses_a', 24)]), ledger(), NOW)
    expect(rowWhen(w)).toBe('Sat, Oct 24 · 1 PM')
    expect(w).toMatchObject({ date: '2026-10-24', startTime: '2026-10-24T18:00:00Z', duration: 120 })
  })
  it('ages and drop-off come from the class rules', () => {
    const c = make({ rules: { ...defaultRules(), ages: 'Ages 8+', dropOff: true } })
    expect(workshopStatus(toPublicClass(c, ledger(), NOW)).meta).toBe('From $15 · Ages 8+ · Drop-off')
  })
})
