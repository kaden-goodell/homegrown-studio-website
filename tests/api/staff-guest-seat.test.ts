// @vitest-environment node
/**
 * One-tap "With Shelby Taylor" at check-in, on our own classes (seat ledger)
 * and on Square-era classes (seat-choices). Real class, ledger, seat-choice,
 * waiver and guest-link stores (temp dir); no Square, no email, no texts.
 * The attach is only a link: the ledger and seat records never change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  staff: { id: 'sam', name: 'Sam', role: 'crew' } as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: vi.fn(async (_e: any) => undefined),
  email: vi.fn(async (_x: any) => ({ sent: true })),
}))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => mocks.staff }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: mocks.email }))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { getWorkshop: vi.fn(async () => { throw new Error('Square must not be asked') }), listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
    customer: { findOrCreate: vi.fn(async () => { throw new Error('no Square customers') }) },
    booking: { listBookings: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<typeof import('@lib/party-store')>()), getPartyRecord: vi.fn(async () => null) }))
// A Square-era class (tonight's Door Mat was clssch_iiq49c7upe0jar): its event comes from Square, so stand it in here.
const SQUARE_ID = 'clssch_iiq49c7upe0jar'
vi.mock('@lib/events', async (orig) => {
  const real = await orig<typeof import('@lib/events')>()
  return {
    ...real,
    getEvent: async (kind: any, id: string, opts?: any) => (kind === 'workshop' && id.startsWith('clssch_')
      ? { kind: 'workshop', id, title: 'Door Mat', startIso: '2026-10-20T23:00:00.000Z', days: ['2026-10-20'], dropOff: false, options: [] }
      : real.getEvent(kind, id, opts)),
  }
})

import * as compRoute from '@pages/api/staff/comp-seat.json'
import * as rosterRoute from '@pages/api/staff/roster.json'
import * as guestRoute from '@pages/api/staff/guest-seat.json'
import { createClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { saveSeatChoices, listSeatChoicesByEvent } from '@lib/seat-choices'
import { saveWaiverRecord, upsertWaiverInEventIndex } from '@lib/waiver-store'
import { listGuestLinks, attachGuest } from '@lib/guest-links'
import { defaultRules } from '@lib/classes/validate'
import { substantiveSince } from '@config/waiver-content'
import type { ClassContent } from '@lib/classes/types'

const NOW = new Date('2026-10-20T15:00:00.000Z')
const by = { id: 'admin', name: 'Owner' }
const content = (): ClassContent => ({
  name: 'Door Mat', description: 'Paint a mat.', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'adult', label: 'Adult' }], passes: [{ id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }],
  prices: { day: { adult: 3500 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 120,
})
const sessions = () => [{ id: 'ses_tue', startIso: '2026-10-20T23:00:00.000Z', endIso: '2026-10-21T01:00:00.000Z', capacity: 10 }]

let n = 0
async function signed(classId: string, first: string, last: string, email: string) {
  const rec: any = {
    id: `wvr_${first.toLowerCase()}${++n}`, agreementVersion: substantiveSince, agreementSha256: 'x', signedAt: NOW.toISOString(),
    validUntil: '2027-10-20T00:00:00.000Z', adult: { firstName: first, lastName: last, email, phone: '2565550000', dob: '', ageConfirmed: true, allergies: '' },
    minors: [], emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', photoConsent: true, signature: first,
    squareCustomerId: null, ip: null, userAgent: null,
  }
  await saveWaiverRecord(rec)
  await upsertWaiverInEventIndex('workshop', classId, rec)
  return rec
}
async function post(route: any, body: unknown) {
  const request = new Request('https://x.test/api/staff/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
async function roster(id: string) {
  const request = new Request(`https://x.test/api/staff/roster.json?kind=workshop&id=${id}&day=2026-10-20`)
  const res: Response = await rosterRoute.GET({ request, url: new URL(request.url) } as any)
  return (await res.json()).data
}
const guest = (body: Record<string, unknown>) => post(guestRoute, { kind: 'workshop', day: '2026-10-20', ...body })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
  mocks.audit.mockClear()
})
afterEach(() => vi.useRealTimers())

/** Our class: Shelby comped 2 seats; Shelby and Janea each signed. */
async function ownSetup() {
  const cls = await createClass({ content: content(), sessions: sessions(), status: 'open', by })
  const c = await post(compRoute, { scheduleId: cls.id, givenName: 'Shelby', familyName: 'Taylor', email: 'shelby@example.com', passId: 'day', sessionIds: ['ses_tue'], tickets: { adult: 2 }, reason: 'test' })
  expect(c.status).toBe(200)
  const shelby = await signed(cls.id, 'Shelby', 'Taylor', 'shelby@example.com')
  const janea = await signed(cls.id, 'Janea', 'Boyd', 'janea@example.com')
  const bookingId = (await getLedger(cls.id)).lines[0].bookingId
  return { cls, shelby, janea, bookingId }
}

describe('our class (seat ledger)', () => {
  it('the roster offers Shelby\'s open guest seat to Janea; attach shows her as Shelby\'s guest, seat 2 of 2', async () => {
    const { cls, janea, bookingId } = await ownSetup()
    let d = await roster(cls.id)
    expect(d.choices.seatsByEmail['janea@example.com']).toBeUndefined()
    expect(d.guests.matches).toEqual([{ bookingId, bookerName: 'Shelby Taylor', open: 1 }])

    const ledgerBefore = JSON.stringify(await getLedger(cls.id))
    const r = await guest({ id: cls.id, recordId: janea.id, bookingId, action: 'attach' })
    expect(r.status).toBe(200)
    expect(r.body.data.guestOf).toEqual({ bookingId, bookerName: 'Shelby Taylor', seat: 2, of: 2 })

    d = await roster(cls.id)
    expect(d.guests.guestOf[janea.id]).toEqual({ bookingId, bookerName: 'Shelby Taylor', seat: 2, of: 2 })
    expect(d.guests.matches).toEqual([])
    // Shelby's seats now count Janea (not double counted as a seat of her own)
    expect(d.guests.guestsByEmail['shelby@example.com']).toEqual(['Janea Boyd'])
    // money, seats and Square untouched: the ledger is byte for byte the same
    expect(JSON.stringify(await getLedger(cls.id))).toBe(ledgerBefore)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      by: expect.objectContaining({ id: 'sam', name: 'Sam' }), action: 'guest-seat.attached',
      target: expect.objectContaining({ kind: 'household', id: janea.id }),
    }))
  })

  it('attaching again changes nothing (idempotent)', async () => {
    const { cls, janea, bookingId } = await ownSetup()
    expect((await guest({ id: cls.id, recordId: janea.id, bookingId, action: 'attach' })).status).toBe(200)
    const again = await guest({ id: cls.id, recordId: janea.id, bookingId, action: 'attach' })
    expect(again.status).toBe(200)
    expect(again.body.data.guestOf.seat).toBe(2)
    expect(await listGuestLinks(cls.id)).toHaveLength(1)
  })

  it('"Not with Shelby" undoes it, and the seat is offered again', async () => {
    const { cls, janea, bookingId } = await ownSetup()
    await guest({ id: cls.id, recordId: janea.id, bookingId, action: 'attach' })
    const undo = await guest({ id: cls.id, recordId: janea.id, action: 'detach' })
    expect(undo.status).toBe(200)
    expect(undo.body.data.removed).toBe(true)
    const d = await roster(cls.id)
    expect(d.guests.guestOf[janea.id]).toBeUndefined()
    expect(d.guests.matches).toEqual([{ bookingId, bookerName: 'Shelby Taylor', open: 1 }])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'guest-seat.removed' }))
  })

  it('no open guest seat left: a second friend is refused, in plain words', async () => {
    const { cls, janea, bookingId } = await ownSetup()
    const third = await signed(cls.id, 'Third', 'Friend', 'third@example.com')
    await guest({ id: cls.id, recordId: janea.id, bookingId, action: 'attach' })
    const r = await guest({ id: cls.id, recordId: third.id, bookingId, action: 'attach' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/no open seat/i)
    expect((await listGuestLinks(cls.id)).map((l) => l.recordId)).toEqual([janea.id])
  })

  it('the booker can\'t be her own guest, and a family with its own seat isn\'t matched', async () => {
    const { cls, shelby, bookingId } = await ownSetup()
    const r = await guest({ id: cls.id, recordId: shelby.id, bookingId, action: 'attach' })
    expect(r.status).toBe(409)
    expect(await listGuestLinks(cls.id)).toEqual([])
  })

  it('refuses a booking not in this class, and a family not signed in for it', async () => {
    const { cls, janea } = await ownSetup()
    expect((await guest({ id: cls.id, recordId: janea.id, bookingId: 'bkg_nope', action: 'attach' })).status).toBe(409)
    expect((await guest({ id: cls.id, recordId: 'wvr_stranger', bookingId: 'bkg_nope', action: 'attach' })).status).toBe(404)
  })

  it('a guest who signed through the link shows as a guest with no attach needed; past the cap, a guest with no seat', async () => {
    const { cls, janea, bookingId } = await ownSetup()
    const third = await signed(cls.id, 'Third', 'Friend', 'third@example.com')
    await attachGuest({ eventId: cls.id, bookingId, recordId: janea.id, via: 'link', by: null })
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    await attachGuest({ eventId: cls.id, bookingId, recordId: third.id, via: 'link', by: null })
    const d = await roster(cls.id)
    expect(d.guests.guestOf[janea.id]).toMatchObject({ seat: 2, of: 2 })
    expect(d.guests.guestOf[third.id]).toMatchObject({ bookerName: 'Shelby Taylor', seat: null, of: 2 })
  })

  it('staff only, and bad input is refused', async () => {
    mocks.staff = null
    expect((await guest({ id: 'cls_x', recordId: 'wvr_x', bookingId: 'b', action: 'attach' })).status).toBe(401)
    mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
    expect((await post(guestRoute, { kind: 'party', id: 'p1', recordId: 'wvr_x', bookingId: 'b', action: 'attach' })).status).toBe(400)
    expect((await guest({ id: 'cls_x', recordId: 'wvr_x', bookingId: 'b', action: 'nope' })).status).toBe(400)
  })
})

describe('Square-era class (seat-choices by schedule id)', () => {
  it('Door Mat: matches, attaches and undoes on the seat-choice record, never changing it', async () => {
    await saveSeatChoices({
      eventKind: 'workshop', eventId: SQUARE_ID, bookingId: 'clsbk_shelby', orderId: 'o1',
      customer: { givenName: 'Shelby', familyName: 'Taylor', email: 'shelby@example.com', phone: '' },
      seats: 2, picks: [], at: '2026-10-19T00:00:00.000Z', attemptId: 'a', squareBookingIds: ['clsbk_shelby', 'clsbk_shelby2'],
    })
    await signed(SQUARE_ID, 'Shelby', 'Taylor', 'shelby@example.com')
    const janea = await signed(SQUARE_ID, 'Janea', 'Boyd', 'janea@example.com')
    const before = JSON.stringify(await listSeatChoicesByEvent('workshop', SQUARE_ID))

    let d = await roster(SQUARE_ID)
    expect(d.guests.matches).toEqual([{ bookingId: 'clsbk_shelby', bookerName: 'Shelby Taylor', open: 1 }])

    const r = await guest({ id: SQUARE_ID, recordId: janea.id, bookingId: 'clsbk_shelby', action: 'attach' })
    expect(r.status).toBe(200)
    d = await roster(SQUARE_ID)
    expect(d.guests.guestOf[janea.id]).toEqual({ bookingId: 'clsbk_shelby', bookerName: 'Shelby Taylor', seat: 2, of: 2 })
    expect(JSON.stringify(await listSeatChoicesByEvent('workshop', SQUARE_ID))).toBe(before)

    expect((await guest({ id: SQUARE_ID, recordId: janea.id, action: 'detach' })).body.data.removed).toBe(true)
    expect((await roster(SQUARE_ID)).guests.guestOf[janea.id]).toBeUndefined()
  })
})
