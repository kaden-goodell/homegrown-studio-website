import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@config/providers', () => ({
  providers: { workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] }, booking: { listBookings: async () => [] } },
}))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))
const own = vi.hoisted(() => ({ classes: [] as any[], ledgers: new Map<string, any>(), unmatched: [] as any[], needsDays: [] as any[], flags: [] as any[], fail: false }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => { if (own.fail) throw new Error('blobs down'); return own.classes },
  getClass: async (id: string) => own.classes.find((c) => c.id === id) ?? null,
}))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/seat-ledger')>()),
  getLedger: async (id: string) => own.ledgers.get(id) ?? { classId: id, lines: [] },
}))
vi.mock('@lib/classes/square-events', () => ({
  listUnmatchedPos: async () => own.unmatched,
  listPosNeedsDays: async () => own.needsDays,
  listRefundFlags: async () => own.flags,
}))

import { listWarnings, warningLine, OWNERS_DECIDE } from '@lib/warnings'
import { defaultRules } from '@lib/classes/validate'

const NOW = new Date('2026-10-15T15:00:00.000Z')
const WINDOW = { from: '2026-10-15', to: '2026-10-25' }
const seat = (sessionIds: string[]) => ({
  id: `led_${Math.random()}`, bookingId: 'bkg_x', sessionIds, ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 0, taxCents: 0,
  addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'pos', state: 'confirmed', holdExpiresAt: null, customer: null,
  square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: '',
})
function camp(over: Record<string, any> = {}) {
  return {
    id: 'cls_camp', libraryId: null, libraryVersion: null, status: 'open',
    content: {
      name: 'Clay Camp', description: '', imageUrl: null, instructor: null, rules: { ...defaultRules(), ...(over.rules ?? {}) },
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 1000 } }, questions: [], addOns: [], defaultCapacity: 40, defaultMinutes: 120,
    },
    sessions: [
      { id: 'ses_1', startIso: '2026-10-17T18:00:00.000Z', endIso: '2026-10-17T20:00:00.000Z', capacity: 40 },
      { id: 'ses_2', startIso: '2026-10-18T18:00:00.000Z', endIso: '2026-10-18T20:00:00.000Z', capacity: 40 },
    ],
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
  }
}

beforeEach(() => {
  own.classes = []; own.ledgers.clear(); own.unmatched = []; own.needsDays = []; own.flags = []; own.fail = false
})

describe('warnings for our own classes', () => {
  it('a session with more seats than it holds says "41 of 40" on its own day', async () => {
    own.classes = [camp()]
    own.ledgers.set('cls_camp', { classId: 'cls_camp', lines: [...Array.from({ length: 41 }, () => seat(['ses_2'])), seat(['ses_1'])] })
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'oversold', eventKind: 'workshop', eventId: 'cls_camp', when: '2026-10-18T18:00:00.000Z', action: OWNERS_DECIDE })
    expect(warningLine(list[0])).toBe('Sun Oct 18 · Clay Camp 1:00 PM: 41 of 40 booked. An owner decides on /admin.')
  })

  it('below its minimum before the first session', async () => {
    own.classes = [camp({ rules: { minimumToRun: { count: 6, decideByIso: '2026-10-16T22:00:00.000Z' } } })]
    own.ledgers.set('cls_camp', { classId: 'cls_camp', lines: [seat(['ses_1', 'ses_2']), seat(['ses_1', 'ses_2'])] })
    const [w] = await listWarnings(WINDOW, { now: NOW })
    expect(w).toMatchObject({ code: 'below-minimum', eventId: 'cls_camp' })
    expect(w.detail).toBe('Clay Camp has 2 of the 6 it needs to run, decide by Fri Oct 16 5:00 PM.')
  })

  it('counter sales and Square refunds that need a person, whatever their date; drafts are left out', async () => {
    own.classes = [camp(), { ...camp(), id: 'cls_draft', status: 'draft' }]
    own.unmatched = [{ orderId: 'O1', lineUid: 'L1', name: 'Old camp · Person', qty: 2, at: '2026-10-01T15:00:00.000Z' }]
    own.needsDays = [{ id: 'days-1', classId: 'cls_camp', bookingId: 'b', lineIds: [], orderId: 'O2', lineUid: 'L2', passId: 'day', sessionIds: [], at: '2026-10-14T15:00:00.000Z' }]
    own.flags = [
      { id: 'f1', kind: 'plain-refund', classId: 'cls_camp', bookingId: 'b', paymentId: 'p', squareRefundId: 'r', cents: 1000, refundCents: 1000, status: 'COMPLETED', at: '2026-10-14T16:00:00.000Z', resolved: null },
      { id: 'f2', kind: 'refund-unconfirmed', classId: 'cls_camp', bookingId: 'b', paymentId: 'p', squareRefundId: '', cents: 2500, status: 'pending', at: '2026-10-14T17:00:00.000Z', resolved: null },
    ]
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list.map((w) => [w.code, w.eventId, w.detail])).toEqual([
      ['pos-unmatched', '', 'A counter sale of Old camp · Person ×2 didn’t match a class.'],
      ['pos-needs-days', 'cls_camp', 'A counter sale of Clay Camp needs its day picked.'],
      ['refund-flag', 'cls_camp', 'Clay Camp: $10 was refunded in Square. Should a seat be freed?'],
      ['refund-flag', 'cls_camp', 'Clay Camp: a $25 refund is still waiting on Square.'],
    ])
  })

  it('a class store that can’t be read says so in one line (never an all clear), and the rest still shows', async () => {
    own.fail = true
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list).toEqual([expect.objectContaining({ code: 'classes-unreadable', eventId: '', detail: 'Our classes couldn’t be checked for problems.' })])
  })

  it('R32: a "pay at the counter" seat never rung up is flagged once its session has ended', async () => {
    const past = { ...camp(), sessions: [{ id: 'ses_0', startIso: '2026-10-13T18:00:00.000Z', endIso: '2026-10-13T20:00:00.000Z', capacity: 40 }, ...camp().sessions] }
    own.classes = [past]
    const door = (sessionIds: string[], over: Record<string, any> = {}) => ({ ...seat(sessionIds), source: 'door-counter', bookingId: `bkg_${sessionIds[0]}`, customer: { givenName: 'Dora', familyName: 'Door', email: 'd@x.co', phone: '' }, ...over })
    own.ledgers.set('cls_camp', { classId: 'cls_camp', lines: [
      door(['ses_0']),
      door(['ses_1']), // not over yet: no warning
      door(['ses_0'], { bookingId: 'bkg_paid', square: { orderId: 'O1', paymentId: 'P1', lineUid: 'L1' } }), // paid at the counter
    ] })
    const list = (await listWarnings(WINDOW, { now: NOW })).filter((w) => w.code === 'door-unpaid')
    expect(list.map((w) => w.detail)).toEqual(['Dora Door · Clay Camp · Tue Oct 13 · not paid at the counter yet'])
    expect(list[0]).toMatchObject({ eventId: 'cls_camp', action: OWNERS_DECIDE })
    // the line doesn't repeat the day
    expect(warningLine(list[0])).toBe('Dora Door · Clay Camp · Tue Oct 13 · not paid at the counter yet. An owner decides on /admin.')
  })

  it('R34: a counter sale matched to one of several door seats asks a person to check', async () => {
    own.classes = [camp()]
    own.ledgers.set('cls_camp', { classId: 'cls_camp', lines: [
      { ...seat(['ses_1']), source: 'door-counter', customer: { givenName: 'Dora', familyName: 'Door', email: '', phone: '' }, square: { orderId: 'O1', paymentId: 'P1', lineUid: 'L1' }, counterMatch: { orderId: 'O1', candidates: 2, at: '2026-10-14T20:00:00.000Z', checked: null } },
      { ...seat(['ses_1']), source: 'door-counter', counterMatch: { orderId: 'O2', candidates: 2, at: '2026-10-14T20:00:00.000Z', checked: { at: '', by: { id: 'k', name: 'K' } } } },
      // m8: refunded with the seat freed since: no check needed
      { ...seat(['ses_1']), source: 'door-counter', state: 'refunded', refunds: [{ at: '', cents: 0, reason: 'x', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: null }], counterMatch: { orderId: 'O3', candidates: 2, at: '2026-10-14T20:00:00.000Z', checked: null } },
    ] })
    const list = (await listWarnings(WINDOW, { now: NOW })).filter((w) => w.code === 'counter-match-check')
    expect(list.map((w) => warningLine(w))).toEqual(['Counter sale of Clay Camp on Wed Oct 14 was matched to Dora Door. Check it was them. An owner decides on /admin.'])
  })
})
