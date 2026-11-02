import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@config/providers', () => ({
  providers: { workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] }, booking: { listBookings: async () => [] } },
}))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))
const own = vi.hoisted(() => ({ classes: [] as any[], ledgers: new Map<string, any>(), unmatched: [] as any[], needsDays: [] as any[], flags: [] as any[], paidNoSeat: [] as any[], fail: false }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => { if (own.fail) throw new Error('blobs down'); return own.classes },
  getClass: async (id: string) => own.classes.find((c) => c.id === id) ?? null,
}))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/seat-ledger')>()),
  getLedger: async (id: string) => own.ledgers.get(id) ?? { classId: id, lines: [] },
}))
const reg = vi.hoisted(() => ({ now: null as null | Record<string, string> }))
vi.mock('@lib/classes/register-setup', () => ({ registerInForce: async () => { if (!reg.now) throw new Error('not set'); return reg.now } }))
vi.mock('@lib/classes/square-events', () => ({
  listUnmatchedPos: async () => own.unmatched,
  listPosNeedsDays: async () => own.needsDays,
  listRefundFlags: async () => own.flags,
  openPaidNotSeated: async () => own.paidNoSeat,
}))

import { listWarnings, warningLine, OWNERS_DECIDE, UNDATED_CODES } from '@lib/warnings'
import { mutateWaitlist, type WaitlistEntry } from '@lib/classes/waitlist-store'
import { createReaderSale } from '@lib/classes/reader-store'
import { savePromo } from '@lib/promos/promo-store'
import { defaultRules } from '@lib/classes/validate'
import { createPartyRecord } from '@lib/party-store'

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
    square: { itemId: 'ITEM', variations: { 'all:person': 'V' } }, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
  }
}

beforeEach(() => {
  own.classes = []; own.ledgers.clear(); own.unmatched = []; own.needsDays = []; own.flags = []; own.paidNoSeat = []; own.fail = false
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
    // each carries a stable id, so the daily email can tell a new one from one already shown
    expect(list.map((w) => w.itemId)).toEqual(['unmatched-O1-L1', 'days-1', 'f1', 'f2'])
  })

  it('a refund flag on a party names the party and opens it, never "A class"', async () => {
    const id = `pty_warn${Date.now().toString(36)}`
    await createPartyRecord({
      bookingId: id, hostToken: 't', craftName: 'Pails', startIso: '2026-11-14T19:30:00.000Z', durationMinutes: 90, hostName: 'Stefanie Justice',
      hostEmail: '', guestCount: 12, title: null, dropOff: false, createdAt: '', source: 'ours', status: 'booked',
    })
    own.flags = [{ id: 'fp', kind: 'refund-failed', classId: 'party', bookingId: id, paymentId: 'p', squareRefundId: 'r', cents: 5000, refundCents: 5000, status: 'FAILED', at: '2026-10-14T16:00:00.000Z', resolved: null }]
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list).toEqual([expect.objectContaining({
      code: 'refund-flag', eventKind: 'party', eventId: id, title: 'The Justice party', itemId: 'fp',
      detail: 'The Justice party: Square couldn’t finish a $50 refund.',
    })])
  })

  it('R42: a booking Square shows paid with no seat left is on the panel until an owner sorts it out', async () => {
    own.classes = [camp()]
    own.paidNoSeat = [{ id: 'pns-O1', why: 'no-seats', orderId: 'O1', bookingId: 'bkg_lost', classId: 'cls_camp', paymentId: 'P1', paymentIds: ['P1'], chargedCents: 3270, customerId: null, lines: [], at: '2026-10-14T12:00:00.000Z', resolved: null }]
    const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'paid-not-seated')!
    expect(w).toMatchObject({ eventId: 'cls_camp', itemId: 'pns-O1', action: OWNERS_DECIDE })
    expect(w.detail).toBe('Clay Camp: $32.70 was paid online, but the seats were let go before the booking finished. Nothing was refunded.')
  })

  it('I2: a class whose POS price is still early-bird after it ended is on the panel until it is fixed', async () => {
    const onPos = (prices: Record<string, number>) => ({
      ...camp(), content: { ...camp().content, earlyBird: { untilYmd: '2026-10-14', prices: { all: { person: 800 } } } },
      square: { itemId: 'ITEM', variations: { 'all:person': 'V' }, prices },
    })
    own.classes = [onPos({ 'all:person': 800 })]
    const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'pos-price-stale')!
    expect(w).toMatchObject({ eventId: 'cls_camp', when: '2026-10-17T18:00:00.000Z' })
    expect(warningLine(w)).toBe('Sat Oct 17 · The register still rings the early-bird price for Clay Camp. The early-bird has ended. An owner opens the class in /admin and taps Fix the register price now.')
    // Fixed (the job or a save put the regular price on the POS): gone.
    own.classes = [onPos({ 'all:person': 1000 })]
    expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'pos-price-stale')).toBe(false)
  })

  it('fix 3: a class that should be on the register and isn’t is on the panel with the button to press; drafts and complete ones aren’t', async () => {
    own.classes = [{ ...camp(), square: { itemId: null, variations: {} } }]
    const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'not-on-register')!
    expect(warningLine(w)).toBe('Sat Oct 17 · Clay Camp isn’t on the register yet, so it can’t be booked online. An owner opens the class in /admin and taps Put it on the register.')
    // Missing a seat it now sells counts too.
    own.classes = [{ ...camp(), content: { ...camp().content, ticketTypes: [{ id: 'person', label: 'Person' }, { id: 'kid', label: 'Kid' }], prices: { all: { person: 1000, kid: 500 } } } }]
    expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'not-on-register')).toBe(true)
    own.classes = [{ ...camp(), status: 'draft', square: { itemId: null, variations: {} } }, camp()]
    expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'not-on-register')).toBe(false)
  })

  it('fix 4: a class on the register with an older tax than Register setup is on the panel with Update them all', async () => {
    reg.now = { classTaxId: 'T9', classesCategoryId: 'C1', siteTaxId: 'T85', siteCategoryId: 'C1' }
    try {
      own.classes = [{ ...camp(), square: { ...camp().square, taxId: 'T85', categoryId: 'C1' } }]
      const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'register-old-setup')!
      expect(warningLine(w)).toBe('Sat Oct 17 · The register still has the old tax or category for Clay Camp. An owner taps Update them all in /admin › More › Register setup (or Update the register on the class).')
      own.classes = [{ ...camp(), square: { ...camp().square, taxId: 'T9', categoryId: 'C1' } }]
      expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'register-old-setup')).toBe(false)
    } finally {
      reg.now = null
    }
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

describe('Task 12: stage 4 warnings, each pointing at a button', () => {
  const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
    id: `wle_${Math.random().toString(36).slice(2, 8)}`, createdAt: '2026-10-14T10:00:00.000Z',
    request: { passId: 'all', tickets: { person: 1 } }, sessionIds: ['ses_1', 'ses_2'], seats: 1, maxCents: 1090,
    customer: { givenName: 'Jane', familyName: 'Doe', email: 'j@x.co', phone: '(402) 980-2907' },
    square: { customerId: 'C', cardId: 'ccof:1', brand: 'VISA', last4: '4242', expMonth: 1, expYear: 2030 },
    consent: { textVersion: 'v', text: 't', at: '', ipHash: '' }, leaveHash: 'h', state: 'waiting', attempts: [], history: [],
    ...over,
  })
  const attempt = (outcome: any, at = '2026-10-15T12:00:00.000Z') => ({ n: 1, at, attemptId: 'wl:x:1', bookingId: 'bkg_w', orderId: null, amountCents: null, note: null, outcome })
  const putList = (classId: string, entries: WaitlistEntry[]) => mutateWaitlist(classId, () => ({ next: { classId, entries }, result: null }))

  it('the waitlist stopped (Square refused, the register, Square down) with a seat free: the line names the class sheet’s button', async () => {
    own.classes = [{ ...camp(), id: 'cls_wl1' }]
    await putList('cls_wl1', [entry({ attempts: [attempt('setup')] })])
    const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'waitlist-stopped')!
    expect(w).toMatchObject({ eventId: 'cls_wl1', when: '2026-10-17T18:00:00.000Z' })
    expect(w.action).toBe('An owner opens the class in /admin and taps Try the waitlist again on its waitlist.')
    expect(w.detail).toMatch(/^Clay Camp: The waitlist has stopped because Square refused our request/)
    // the register's price: Update the register
    await putList('cls_wl1', [entry({ attempts: [attempt('register')] })])
    expect((await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'waitlist-stopped')!.action).toMatch(/taps Update the register on its waitlist/)
    // ran fine last time: nothing to say
    await putList('cls_wl1', [entry({ attempts: [attempt('no-seat')] })])
    expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'waitlist-stopped')).toBe(false)
  })

  it('a saved card not confirmed off file an hour after they came off the list: Take the card off now (undated, by entry)', async () => {
    own.classes = [{ ...camp(), id: 'cls_wl2' }]
    const old = entry({ state: 'declined', attempts: [attempt('declined', '2026-10-15T13:00:00.000Z')] })
    const fresh = entry({ state: 'left', attempts: [attempt('declined', '2026-10-15T14:30:00.000Z')] })
    const off = entry({ state: 'added', cardOffAt: '2026-10-15T13:01:00.000Z', attempts: [attempt('paid', '2026-10-15T13:00:00.000Z')] })
    await putList('cls_wl2', [old, fresh, off])
    const list = (await listWarnings(WINDOW, { now: NOW })).filter((x) => x.code === 'waitlist-card-on')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ eventId: 'cls_wl2', itemId: `wl-card-${old.id}` })
    expect(warningLine(list[0])).toMatch(/Jane Doe is off the waitlist, but Square hasn’t confirmed their saved card \(ending 4242\) came off file yet\. Nothing will be charged\. An owner opens the class in \/admin and taps Take the card off now on its waitlist\.$/)
    expect(UNDATED_CODES.has('waitlist-card-on')).toBe(true)
  })

  it('a reader payment that never came back (15 minutes on) or didn’t match: To decide decides it', async () => {
    own.classes = [camp()]
    const sale = (bookingId: string, startedAt: string, problem?: any) => createReaderSale({
      bookingId, classId: 'cls_camp', className: 'Clay Camp', firstStartIso: '2026-10-17T18:00:00.000Z', seatsLabel: '1 seat', seats: 1, amountCents: 1090,
      startedAt, by: { id: 'k', name: 'K' }, customer: { givenName: 'Gia', familyName: 'Winner', email: '', phone: '' }, request: { passId: 'all', tickets: { person: 1 } } as any,
      overCapacity: false, sendEmail: false, quote: {} as any, state: 'waiting', ...(problem ? { problem } : {}),
    })
    await sale('bkg_r1', '2026-10-15T14:00:00.000Z')
    await sale('bkg_r2', '2026-10-15T14:55:00.000Z') // 5 minutes: not yet
    await sale('bkg_r3', '2026-10-15T14:58:00.000Z', { why: 'amount', orderId: 'O', at: '2026-10-15T14:59:00.000Z' })
    const list = (await listWarnings(WINDOW, { now: NOW })).filter((x) => x.code === 'reader-waiting')
    expect(list.map((w) => w.itemId).sort()).toEqual(['reader-bkg_r1', 'reader-bkg_r3'])
    expect(list.find((w) => w.itemId === 'reader-bkg_r1')!.detail).toBe('Clay Camp Sat Oct 17 1:00 PM: Gia Winner’s $10.90 reader payment never came back from the Square app. The seat is held.')
    expect(list.every((w) => w.action === OWNERS_DECIDE)).toBe(true)
  })

  it('no class tax picked while a class needs the register: one Register setup line', async () => {
    reg.now = { classTaxId: '', classesCategoryId: '', siteTaxId: '', siteCategoryId: '' }
    try {
      own.classes = [{ ...camp(), square: { itemId: null, variations: {} } }]
      const w = (await listWarnings(WINDOW, { now: NOW })).find((x) => x.code === 'register-setup-missing')!
      expect(w.action).toBe('An owner opens More › Register setup, picks the 9% tax (or taps Make the 9% class tax) and taps Save.')
      own.classes = [camp()]
      expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'register-setup-missing')).toBe(false)
    } finally {
      reg.now = null
    }
  })

  it('a code that books for free with no use limit is flagged until it has a limit or is off', async () => {
    const by = { id: 'k', name: 'Kaden' }
    const p = await savePromo({ code: 'FREEBIE', label: '', off: { kind: 'percent', percent: 100 }, appliesTo: { kind: 'all' } }, by, null, NOW)
    await savePromo({ code: 'HALF', label: '', off: { kind: 'percent', percent: 50 }, appliesTo: { kind: 'all' } }, by, null, NOW)
    const list = (await listWarnings(WINDOW, { now: NOW })).filter((x) => x.code === 'promo-free-unlimited')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ itemId: 'promo-free-FREEBIE', eventId: '' })
    expect(list[0].action).toBe('An owner opens More › Promotions › the code and taps Edit to set a use limit, or Turn off.')
    await savePromo({ ...p, maxUses: 1 }, by, p.updatedAt, NOW)
    expect((await listWarnings(WINDOW, { now: NOW })).some((x) => x.code === 'promo-free-unlimited')).toBe(false)
  })
})
