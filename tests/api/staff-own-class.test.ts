// @vitest-environment node
/**
 * Task 14: the staff console on the seat ledger. Real class store, seat
 * ledger, waiver and RSVP stores (temp dir); no Square, no email, no texts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  staff: { id: 'sam', name: 'Sam', role: 'crew' } as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: vi.fn(async () => undefined),
  email: vi.fn(async () => ({ sent: true })),
}))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => mocks.staff }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: mocks.email }))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { getWorkshop: vi.fn(async () => { throw new Error('Square must not be asked about our classes') }), listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
    customer: { findOrCreate: vi.fn(async () => { throw new Error('no Square customers for our classes') }) },
  },
}))

import * as compRoute from '@pages/api/staff/comp-seat.json'
import * as rosterRoute from '@pages/api/staff/roster.json'
import * as namesRoute from '@pages/api/staff/class-names.json'
import { createClass } from '@lib/classes/class-store'
import { getLedger, recordPos } from '@lib/classes/seat-ledger'
import { saveWaiverRecord, upsertWaiverInEventIndex } from '@lib/waiver-store'
import { defaultRules } from '@lib/classes/validate'
import { substantiveSince } from '@config/waiver-content'
import type { ClassContent } from '@lib/classes/types'

const NOW = new Date('2026-10-20T15:00:00.000Z') // Tue Oct 20, 10 AM studio time
const by = { id: 'admin', name: 'Owner' }
function content(over: Partial<ClassContent> = {}): ClassContent {
  return {
    name: 'Clay Camp', description: 'Make pots.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    passes: [{ id: 'all', label: 'All three days', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }],
    prices: { all: { adult: 9000, kid: 6000 }, day: { adult: 3500, kid: 2500 } },
    questions: [{ id: 'glaze', label: 'Glaze', choices: ['Blue', 'Green'] }], addOns: [], defaultCapacity: 2, defaultMinutes: 120,
    ...over,
  }
}
// Mon 19 (yesterday), Tue 20 (running at 10–12), Wed 21, studio time.
const sessions = () => [
  { id: 'ses_mon', startIso: '2026-10-19T15:00:00.000Z', endIso: '2026-10-19T17:00:00.000Z', capacity: 2 },
  { id: 'ses_tue', startIso: '2026-10-20T15:00:00.000Z', endIso: '2026-10-20T17:00:00.000Z', capacity: 2 },
  { id: 'ses_wed', startIso: '2026-10-21T15:00:00.000Z', endIso: '2026-10-21T17:00:00.000Z', capacity: 2 },
]
const person = { givenName: 'Gia', familyName: 'Winner', email: 'gia@example.com' }

async function post(route: any, body: unknown) {
  const request = new Request('https://x.test/api/staff/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
async function roster(id: string, day?: string) {
  const request = new Request(`https://x.test/api/staff/roster.json?kind=workshop&id=${id}${day ? `&day=${day}` : ''}`)
  const res: Response = await rosterRoute.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
  mocks.audit.mockClear(); mocks.email.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('Comp a seat on our class', () => {
  it('writes a $0 comp seat on the ledger (no Square), with picks, on a day already running', async () => {
    const cls = await createClass({ content: content(), sessions: sessions(), status: 'open', by })
    const r = await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_tue'], tickets: { kid: 1 }, picks: [{ seat: 1, optionId: 'glaze', choice: 'Green' }] })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ seats: 1, emailSent: false, own: true })
    const [line] = (await getLedger(cls.id)).lines
    expect(line).toMatchObject({ source: 'comp', state: 'confirmed', priceCents: 0, taxCents: 0, sessionIds: ['ses_tue'], answers: { glaze: 'Green' }, by: { id: 'sam', name: 'Sam' } })
    expect(line.customer).toMatchObject({ givenName: 'Gia', email: 'gia@example.com' })
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'seat.comped', target: expect.objectContaining({ id: cls.id }) }))
  })

  it('a full day refuses until the crew squeeze one more in, which shows as over capacity', async () => {
    const cls = await createClass({ content: content(), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 2 }, picks: [{ seat: 1, optionId: 'glaze', choice: 'Blue' }, { seat: 2, optionId: 'glaze', choice: 'Blue' }] }
    expect((await post(compRoute, ask)).status).toBe(200)
    const full = await post(compRoute, { ...ask, tickets: { adult: 1 }, picks: [{ seat: 1, optionId: 'glaze', choice: 'Blue' }] })
    expect(full.status).toBe(409)
    expect(full.body).toMatchObject({ code: 'sold_out', error: expect.stringMatching(/^That class is full on /) })
    const squeezed = await post(compRoute, { ...ask, tickets: { adult: 1 }, picks: [{ seat: 1, optionId: 'glaze', choice: 'Blue' }], overCapacity: true })
    expect(squeezed.status).toBe(200)
    expect(squeezed.body.data.overCapacity).toBe(true)
    const r = await roster(cls.id, '2026-10-21')
    expect(r.body.data.event.capacity - r.body.data.event.seats).toBe(3) // "3 of 2"
  })

  it('a seat with no pick is refused with what is missing', async () => {
    const cls = await createClass({ content: content(), sessions: sessions(), status: 'open', by })
    const r = await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 } })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Seat 1 needs a glaze.')
  })
})

describe('Sell a seat, pay at the counter', () => {
  it('records a door-counter seat owed at the class price; the counter sale pays it instead of adding a seat', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const r = await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, payAtRegister: true, sendEmail: true })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ dueCents: 3815, seats: 1, emailSent: true })
    expect(mocks.email.mock.calls[0][0]).toMatchObject({ dueAtStudioCents: 3815, to: 'gia@example.com' })
    await recordPos(cls, { bookingId: 'bkg_pos_O9', orderId: 'O9', paymentId: 'P9', chargedCents: 3815, lines: [{ lineUid: 'L9', passId: 'day', ticketTypeId: 'adult', sessionIds: ['ses_tue'], units: [{ priceCents: 3500, taxCents: 315 }] }] }, NOW)
    const lines = (await getLedger(cls.id)).lines
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'door-counter', sessionIds: ['ses_wed'], square: { orderId: 'O9', paymentId: 'P9' } })
  })
})

describe('Roster for our class', () => {
  async function signed(classId: string, first: string, email: string) {
    const rec: any = {
      id: `wvr_${first.toLowerCase()}${Date.now().toString(36)}`, agreementVersion: substantiveSince, agreementSha256: 'x', signedAt: NOW.toISOString(),
      validUntil: '2027-10-20T00:00:00.000Z', adult: { firstName: first, lastName: 'Rivera', email, phone: '2565550000', dob: '', ageConfirmed: true, allergies: '' },
      minors: [], emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', photoConsent: true, signature: first,
      squareCustomerId: null, ip: null, userAgent: null,
    }
    await saveWaiverRecord(rec)
    await upsertWaiverInEventIndex('workshop', classId, rec)
    return rec
  }

  it('shows the day’s seats, the bookings with a counter sale unnamed, and names it from a family’s waiver', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    expect((await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_tue'], tickets: { kid: 1 } })).status).toBe(200)
    expect((await post(compRoute, { scheduleId: cls.id, givenName: 'Ben', familyName: 'Lo', email: 'ben@example.com', passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 } })).status).toBe(200)
    // the full-series pass can't be sold once the class has had its first day
    expect((await post(compRoute, { scheduleId: cls.id, ...person, passId: 'all', tickets: { kid: 1 } })).status).toBe(409)
    await recordPos(cls, { bookingId: 'bkg_pos_O1', orderId: 'O1', paymentId: 'P1', chargedCents: 3815, lines: [{ lineUid: 'L1', passId: 'day', ticketTypeId: 'adult', sessionIds: ['ses_tue'], units: [{ priceCents: 3500, taxCents: 315 }] }] }, NOW)
    const fam = await signed(cls.id, 'Rosa', 'rosa@example.com')

    const tue = await roster(cls.id, '2026-10-20')
    expect(tue.status).toBe(200)
    const d = tue.body.data
    expect(d.day).toBe('2026-10-20')
    expect(d.event).toMatchObject({ own: true, capacity: 2, seats: 0, startIso: '2026-10-20T15:00:00.000Z' })
    expect(d.bookings.map((b: any) => [b.name, b.source, b.seatsToday])).toEqual([
      ['Gia Winner', 'comp', 1],
      ['Counter sale, no name yet', 'pos', 1],
    ])
    expect(d.choices.unmatched.map((u: any) => u.name)).toEqual(['Gia Winner', 'Counter sale, no name yet'])
    expect(d.ticketLabels).toEqual({ adult: 'Adult', kid: 'Kid' })

    // Wednesday has only Ben
    const wed = await roster(cls.id, '2026-10-21')
    expect(wed.body.data.bookings.map((b: any) => b.name)).toEqual(['Ben Lo'])
    expect(wed.body.data.event.capacity - wed.body.data.event.seats).toBe(1)

    const counter = d.bookings[1]
    const named = await post(namesRoute, { classId: cls.id, bookingId: counter.bookingId, recordId: fam.id })
    expect(named.status).toBe(200)
    expect(named.body.data).toMatchObject({ named: 1, name: 'Rosa Rivera' })
    const after = await roster(cls.id, '2026-10-20')
    expect(after.body.data.bookings.map((b: any) => b.name)).toEqual(['Gia Winner', 'Rosa Rivera'])
    expect(after.body.data.choices.seatsByEmail['rosa@example.com']).toMatchObject({ seats: 1 })
    // already named: refused, and a family that didn't sign for this class can't be used
    expect((await post(namesRoute, { classId: cls.id, bookingId: counter.bookingId, recordId: fam.id })).status).toBe(409)
    expect((await post(namesRoute, { classId: cls.id, bookingId: counter.bookingId, recordId: 'wvr_nobody' })).status).toBe(409)
  })

  it('staff only', async () => {
    mocks.staff = null
    expect((await roster('cls_whatever')).status).toBe(401)
    expect((await post(namesRoute, {})).status).toBe(401)
  })
})
