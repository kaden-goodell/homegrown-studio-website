// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ party: vi.fn(), parties: vi.fn(), waivers: vi.fn(), rsvps: vi.fn() }))
vi.mock('@lib/party-store', () => ({ getPartyRecord: mocks.party, listParties: mocks.parties }))
vi.mock('@lib/waiver-store', () => ({ listWaiversByEvent: mocks.waivers }))
vi.mock('@lib/rsvp-store', () => ({ listRsvpsByEvent: mocks.rsvps }))

import * as toDecide from '@pages/api/admin/to-decide.json'
import * as reports from '@pages/api/admin/reports.json'
import * as partyRoute from '@pages/api/admin/party.json'
import { adminActor, adminCookie } from '@lib/admin-auth'
import { ownerOf, OWNERS } from '@lib/admin-who'
import type { LedgerLine } from '@lib/classes/seat-ledger'

const cookie = () => adminCookie().split(';')[0]
const get = async (route: any, url: string, signedIn = true) => {
  const request = new Request(`https://x.test${url}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.party.mockReset().mockResolvedValue(null)
  mocks.parties.mockReset().mockResolvedValue([])
  mocks.waivers.mockReset().mockResolvedValue([])
  mocks.rsvps.mockReset().mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('owners', () => {
  it('the fixed list is Catherine and Kaden; adminActor believes only them', () => {
    expect(OWNERS).toEqual(['Catherine', 'Kaden'])
    expect(ownerOf(' catherine ')).toBe('Catherine')
    expect(ownerOf('Owner')).toBeNull()
    const req = (who?: string) => new Request('https://x.test/', { headers: who ? { 'X-Admin-Who': who } : {} })
    expect(adminActor(req('KADEN'))).toEqual({ id: 'owner-kaden', name: 'Kaden' })
    expect(adminActor(req('Someone'))).toEqual({ id: 'admin', name: 'Owner' })
    expect(adminActor(req())).toEqual({ id: 'admin', name: 'Owner' })
  })
})

describe('to-decide.json', () => {
  it('is an empty list for now, to owners only', async () => {
    expect((await get(toDecide, '/api/admin/to-decide.json', false)).status).toBe(401)
    expect(await get(toDecide, '/api/admin/to-decide.json')).toEqual({ status: 200, body: { data: { items: [] } } })
  })
})

describe('reports', () => {
  const line = (over: Partial<LedgerLine>): LedgerLine => ({
    id: 'led', bookingId: 'bkg', sessionIds: [], ticketTypeId: 'person', passId: 'all', seat: 1,
    priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 500, addOnTaxCents: 45, answers: {}, source: 'online',
    state: 'confirmed', holdExpiresAt: null, customer: null, square: { orderId: null, paymentId: null, lineUid: null },
    by: null, refunds: [], at: '2026-10-05T18:00:00Z', ...over,
  })
  it('counts this month (studio time): seats sold, what they paid, refunds, parties booked', () => {
    const now = new Date('2026-10-19T15:00:00Z')
    const r = reports.monthReport(
      [{
        classId: 'cls_a',
        lines: [
          line({}),
          line({ state: 'refunded', refunds: [{ at: '2026-10-10T15:00:00Z', cents: 1635, reason: '', by: { id: 'a', name: 'A' }, freedSeat: true, squareRefundId: 'r' }] }),
          line({ state: 'held' }),
          line({ state: 'released' }),
          line({ at: '2026-09-30T23:30:00Z' }), // 6:30 PM Sep 30 in Alabama: last month
          line({ at: '2026-11-01T04:30:00Z', refunds: [{ at: '2026-10-02T00:00:00Z', cents: 0, reason: '', by: { id: 'a', name: 'A' }, freedSeat: true, squareRefundId: null }] }),
        ],
      }],
      [{ createdAt: '2026-10-03T12:00:00Z' }, { createdAt: '2026-09-28T12:00:00Z' }] as any,
      now,
    )
    // Nov 1 04:30Z is Oct 31 11:30 PM studio time: this month.
    expect(r).toEqual({ month: '2026-10', seatsSold: 3, classSalesCents: 3 * 3815, refunds: 1, refundedCents: 1635, partiesBooked: 1 })
  })
  it('owners only; a storage failure is a 503 with a sentence', async () => {
    expect((await get(reports, '/api/admin/reports.json', false)).status).toBe(401)
    mocks.parties.mockRejectedValue(new Error('blobs down'))
    const r = await get(reports, '/api/admin/reports.json')
    expect(r.status).toBe(503)
    expect(r.body.error).toBe("The numbers couldn't be loaded. Try again.")
  })
})

describe('party.json', () => {
  const record = {
    bookingId: 'bk_1', hostToken: 'secret', craftName: 'Beaded Necklace', startIso: '2031-03-15T19:00:00Z', durationMinutes: 90,
    hostName: 'Sam Host', hostEmail: 'sam@example.com', hostPhone: '(256) 555-0100', guestCount: 14, title: null, dropOff: false, createdAt: '2031-03-01T00:00:00Z',
  }
  const waiver = (id: string, first: string, minors: number, over: any = {}) => ({
    id, signedAt: `2031-03-0${minors + 1}T00:00:00Z`, validUntil: '2099-01-01T00:00:00Z', agreementVersion: 'v1',
    adult: { firstName: first, lastName: 'Guest' }, minors: Array.from({ length: minors }, () => ({ name: 'Kid' })), ...over,
  })

  it('reads the party record and who said yes, never the host token', async () => {
    mocks.party.mockResolvedValue(record)
    mocks.waivers.mockResolvedValue([waiver('w2', 'Bea', 2), waiver('w1', 'Ann', 0, { validUntil: '2020-01-01T00:00:00Z' })])
    mocks.rsvps.mockResolvedValue([{ waiverId: 'w2', attending: ['adult', 'child:0'] }])
    const r = await get(partyRoute, '/api/admin/party.json?id=bk_1')
    expect(r.status).toBe(200)
    expect(r.body.data.party).toMatchObject({ hostName: 'Sam Host', hostPhone: '(256) 555-0100', guestCount: 14, craftName: 'Beaded Necklace' })
    expect(JSON.stringify(r.body)).not.toContain('secret')
    expect(r.body.data.guests).toEqual([
      { name: 'Ann Guest', kids: 0, coming: 1, waiver: 'expired' },
      { name: 'Bea Guest', kids: 2, coming: 2, waiver: 'current' },
    ])
    expect(mocks.waivers).toHaveBeenCalledWith('party', 'bk_1')
  })

  it('a party with no record on file, and guests that cannot be read, still answer', async () => {
    mocks.waivers.mockRejectedValue(new Error('down'))
    const r = await get(partyRoute, '/api/admin/party.json?id=bk_2')
    expect(r.body).toEqual({ data: { party: null, guests: null } })
  })

  it('owners only, and needs a plain id', async () => {
    expect((await get(partyRoute, '/api/admin/party.json?id=bk_1', false)).status).toBe(401)
    expect((await get(partyRoute, '/api/admin/party.json?id=a%20b')).status).toBe(400)
  })
})
