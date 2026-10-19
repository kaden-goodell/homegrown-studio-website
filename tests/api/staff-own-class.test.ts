// @vitest-environment node
/**
 * Task 14: the staff console on the seat ledger. Real class store, seat
 * ledger, waiver and RSVP stores (temp dir); no Square, no email, no texts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  staff: { id: 'sam', name: 'Sam', role: 'crew' } as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: vi.fn(async () => undefined),
  email: vi.fn(async (_x: any) => ({ sent: true })),
}))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => mocks.staff }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
// Lets a test make the seat write fail once after the hold went in (a blob error or a timeout).
const confirmFail = vi.hoisted(() => ({ n: 0 }))
vi.mock('@lib/classes/seat-ledger', async (orig) => {
  const real = await orig<typeof import('@lib/classes/seat-ledger')>()
  return { ...real, confirm: (...a: Parameters<typeof real.confirm>) => (confirmFail.n-- > 0 ? Promise.reject(new Error('blob down')) : real.confirm(...a)) }
})
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: mocks.email }))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { getWorkshop: vi.fn(async () => { throw new Error('Square must not be asked about our classes') }), listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
    customer: { findOrCreate: vi.fn(async () => { throw new Error('no Square customers for our classes') }) },
    booking: { listBookings: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<typeof import('@lib/party-store')>()), getPartyRecord: vi.fn(async () => null) }))

import * as compRoute from '@pages/api/staff/comp-seat.json'
import * as rosterRoute from '@pages/api/staff/roster.json'
import * as namesRoute from '@pages/api/staff/class-names.json'
import * as classRoute from '@pages/api/staff/class.json'
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
  confirmFail.n = 0
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
    expect(squeezed.body.data.over).toEqual({ sold: 3, capacity: 2 })
    const r = await roster(cls.id, '2026-10-21')
    expect(r.body.data.event.capacity - r.body.data.event.seats).toBe(3) // "3 of 2"
  })

  it('M2: a retry with the same attempt (a lost reply) adds nothing and sends no second email', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, attempt: 'sheet-attempt-1', sendEmail: true }
    const first = await post(compRoute, ask)
    const again = await post(compRoute, ask)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ bookingId: first.body.data.bookingId, replayed: true, seats: 1 })
    expect((await getLedger(cls.id)).lines).toHaveLength(1)
    expect(mocks.email).toHaveBeenCalledTimes(1)
  })

  it('N2: the seat write failed after the hold: the retry confirms that hold, never "Added" without a seat', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, attempt: 'sheet-attempt-n2a' }
    confirmFail.n = 1
    expect((await post(compRoute, ask)).status).toBe(503)
    expect((await getLedger(cls.id)).lines.map((l) => l.state)).toEqual(['held'])
    const again = await post(compRoute, ask)
    expect(again.status).toBe(200)
    expect(again.body.data.replayed).toBe(true)
    expect((await getLedger(cls.id)).lines.map((l) => l.state)).toEqual(['confirmed'])
  })

  it('N2: the hold ran out before the retry: it is held again from scratch and confirmed, same booking', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, attempt: 'sheet-attempt-n2b' }
    confirmFail.n = 1
    expect((await post(compRoute, ask)).status).toBe(503)
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000)) // the 10-minute hold has run out
    const again = await post(compRoute, ask)
    expect(again.status).toBe(200)
    expect(again.body.data.replayed).toBeUndefined()
    const live = (await getLedger(cls.id)).lines.filter((l) => l.state === 'confirmed')
    expect(live).toHaveLength(1)
    expect(live[0].bookingId).toBe(again.body.data.bookingId)
  })

  it('m3: a hold that ran out is never rebuilt past capacity on a retry: full is refused, unless Add over capacity was ticked', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, attempt: 'sheet-attempt-m3' }
    confirmFail.n = 1
    expect((await post(compRoute, ask)).status).toBe(503)
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000)) // the hold ran out
    // meanwhile someone filled Wednesday
    expect((await post(compRoute, { ...ask, attempt: 'other-sheet', givenName: 'Ben', tickets: { adult: 2 } })).status).toBe(200)
    const full = await post(compRoute, ask)
    expect(full.status).toBe(409)
    expect(full.body).toMatchObject({ code: 'sold_out', error: expect.stringMatching(/^That class is full on /) })
    const squeezed = await post(compRoute, { ...ask, overCapacity: true })
    expect(squeezed.status).toBe(200)
    expect(squeezed.body.data.over).toEqual({ sold: 3, capacity: 2 })
  })

  it('m4: a retry of an add that went in answers Added even after the session has ended', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    const ask = { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_tue'], tickets: { adult: 1 }, attempt: 'sheet-attempt-m4' }
    const first = await post(compRoute, ask)
    expect(first.status).toBe(200)
    vi.setSystemTime(new Date('2026-10-20T18:00:00.000Z')) // Tuesday's session is over
    const again = await post(compRoute, ask)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ replayed: true, bookingId: first.body.data.bookingId, seats: 1 })
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
    const r = await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_tue'], tickets: { adult: 1 }, payAtRegister: true, sendEmail: true })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ dueCents: 3815, seats: 1, emailSent: true })
    expect(mocks.email.mock.calls[0][0]).toMatchObject({ dueAtStudioCents: 3815, to: 'gia@example.com' })
    await recordPos(cls, { bookingId: 'bkg_pos_O9', orderId: 'O9', paymentId: 'P9', chargedCents: 3815, saleIso: '2026-10-20T16:00:00.000Z', lines: [{ lineUid: 'L9', passId: 'day', ticketTypeId: 'adult', sessionIds: ['ses_tue'], units: [{ priceCents: 3500, taxCents: 315 }] }] }, NOW)
    const lines = (await getLedger(cls.id)).lines
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'door-counter', sessionIds: ['ses_tue'], square: { orderId: 'O9', paymentId: 'P9' } })
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

  it('Q-C: an unpaid door seat is "not paid yet" in the not-signed-in list too; once rung up it is not', async () => {
    const cls = await createClass({ content: content({ questions: [] }), sessions: sessions(), status: 'open', by })
    await post(compRoute, { scheduleId: cls.id, ...person, passId: 'day', sessionIds: ['ses_tue'], tickets: { adult: 1 }, payAtRegister: true })
    let r = await roster(cls.id, '2026-10-20')
    expect(r.body.data.choices.unmatched).toEqual([expect.objectContaining({ name: 'Gia Winner', atRegister: true })])
    await recordPos(cls, { bookingId: 'bkg_pos_QC', orderId: 'QC', paymentId: 'PQC', chargedCents: 3815, saleIso: NOW.toISOString(), lines: [{ lineUid: 'LQC', passId: 'day', ticketTypeId: 'adult', sessionIds: ['ses_tue'], units: [{ priceCents: 3500, taxCents: 315 }] }] }, NOW)
    r = await roster(cls.id, '2026-10-20')
    expect(r.body.data.choices.unmatched[0].atRegister).toBeUndefined()
    expect(r.body.data.bookings[0]).toMatchObject({ source: 'door-counter', paidHere: true })
  })

  it('staff only', async () => {
    mocks.staff = null
    expect((await roster('cls_whatever')).status).toBe(401)
    expect((await post(namesRoute, {})).status).toBe(401)
  })
})

describe('the class as the door sees it', () => {
  it('a session running now is still open for a door sale', async () => {
    const cls = await createClass({ content: content(), sessions: sessions(), status: 'open', by })
    const request = new Request(`https://x.test/api/staff/class.json?id=${cls.id}`)
    const res: Response = await classRoute.GET({ request, url: new URL(request.url) } as any)
    const { workshop } = await res.json()
    expect(workshop.own.sessions.map((s: any) => [s.id, s.closed])).toEqual([['ses_mon', true], ['ses_tue', false], ['ses_wed', false]])
    expect(workshop.own.passes.find((p: any) => p.id === 'day').state).toBe('open')
    mocks.staff = null
    expect((await classRoute.GET({ request, url: new URL(request.url) } as any)).status).toBe(401)
  })
})

describe('the crew calendar (read-only)', () => {
  it('staff only; our classes with their status, drafts left out', async () => {
    const calRoute = await import('@pages/api/staff/calendar.json')
    const open = await createClass({ content: content({ name: 'Open Camp' }), sessions: [{ id: 'ses_c1', startIso: '2031-05-06T15:00:00.000Z', endIso: '2031-05-06T17:00:00.000Z', capacity: 4 }], status: 'open', by })
    await createClass({ content: content({ name: 'Draft Camp' }), sessions: [{ id: 'ses_c2', startIso: '2031-05-07T15:00:00.000Z', endIso: '2031-05-07T17:00:00.000Z', capacity: 4 }], status: 'draft', by })
    const request = new Request('https://x.test/api/staff/calendar.json?from=2031-05-05T05:00:00.000Z&to=2031-05-12T04:59:59.999Z')
    const res: Response = await calRoute.GET({ request, url: new URL(request.url) } as any)
    expect(res.status).toBe(200)
    const items = (await res.json()).data.items.filter((i: any) => i.kind === 'class')
    expect(items).toEqual([expect.objectContaining({ id: open.id, label: 'Open Camp', status: 'open', sessionId: 'ses_c1' })])
    mocks.staff = null
    expect((await calRoute.GET({ request, url: new URL(request.url) } as any)).status).toBe(401)
  })
})
