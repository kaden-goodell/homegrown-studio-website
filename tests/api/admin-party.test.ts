// @vitest-environment node
/**
 * GET /api/admin/party.json?id=: one party for the /admin Party sheet. Keeps
 * the stage-1 contract (host, guests, craft, time, who said yes) and adds,
 * from stage 2, what the sheet needs to run an own party: status, legacy,
 * end time, items, charges, refunds, what is due, the payment state, when the
 * link went out, the overlap warning and the saved refund requests. Never the
 * host page key or the payment key. Real stores (temp dir); Square is a fake.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ refundPayment: vi.fn() }))
vi.mock('@config/providers', () => ({ providers: { payment: { refundPayment: (...a: any[]) => m.refundPayment(...a) } } }))
vi.mock('@lib/audit', () => ({ recordAudit: async () => undefined }))
vi.mock('@lib/email', async (orig) => ({ ...(await orig<typeof import('@lib/email')>()), sendRefundEmail: async () => ({ sent: true }) }))

import * as partyRoute from '@pages/api/admin/party.json'
import * as refundRoute from '@pages/api/admin/parties/refund.json'
import { adminCookie } from '@lib/admin-auth'
import { createPartyRecord, type PartyRecord } from '@lib/party-store'
import { recordPartyPayment } from '@lib/parties/party-payments'

const cookie = () => adminCookie().split(';')[0]
async function get(id: string, signedIn = true) {
  const request = new Request(`https://x.test/api/admin/party.json?id=${encodeURIComponent(id)}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await partyRoute.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

let n = 0
const uid = () => `${++n}${Date.now().toString(36)}`
const at = '2031-03-01T00:00:00.000Z'
const KADEN = { id: 'owner-kaden', name: 'Kaden' }

function ours(over: Partial<PartyRecord> = {}): PartyRecord {
  const id = `pty_${uid().padStart(16, '0').slice(-16)}`
  return {
    bookingId: id, hostToken: 'host-secret', payToken: 'pay-secret', craftName: 'Tote Bags', craftId: 'craft-1',
    startIso: '2031-03-15T19:00:00.000Z', endIso: '2031-03-15T21:00:00.000Z', durationMinutes: 120,
    hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '(256) 555-0100', guestCount: 12, title: null, dropOff: false,
    createdAt: at, source: 'ours', status: 'booked', packageId: 'pkg_whole',
    items: [
      { id: 'itm_pkg', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: 'chg_1', addedAt: at, by: KADEN },
      { id: 'itm_half', kind: 'addon', refId: 'add_half', label: 'Extra half hour', qty: 1, unitCents: 5000, cents: 5000, extraMinutes: 30, chargeId: null, addedAt: at, by: KADEN },
    ],
    charges: [{ id: 'chg_1', via: 'admin-card', orderId: `ord_${id}`, paymentId: `pay_${id}`, cents: 30000, quotedCents: 30000, itemIds: ['itm_pkg'], receiptUrl: 'https://r/1', at, by: KADEN }],
    refunds: [],
    linkSent: [{ at, by: KADEN, email: true, text: false }],
    paying: null,
    ...over,
  }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  m.refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: `rf_${uid()}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/admin/party.json', () => {
  it('owners only, and needs a plain id', async () => {
    expect((await get('pty_x', false)).status).toBe(401)
    expect((await get('a b')).status).toBe(400)
  })

  it('a party of ours: money, status and end time for the sheet; never the host page key; the payment key only inside the payment link (owners, T12 I2)', async () => {
    const rec = ours()
    await createPartyRecord(rec)
    const r = await get(rec.bookingId)
    expect(r.status).toBe(200)
    expect(r.body.data.party).toMatchObject({
      bookingId: rec.bookingId, hostName: 'Stefanie Justice', hostPhone: '(256) 555-0100', guestCount: 12, craftName: 'Tote Bags',
      status: 'booked', legacy: false, endIso: '2031-03-15T21:00:00.000Z', dueCents: 5000, paymentState: 'partly', overlap: false,
      linkSent: [{ email: true, text: false }], refundRequests: [],
    })
    expect(r.body.data.party.items.map((it: any) => it.id)).toEqual(['itm_pkg', 'itm_half'])
    expect(r.body.data.party.charges).toEqual([expect.objectContaining({ id: 'chg_1', cents: 30000, receiptUrl: 'https://r/1' })])
    expect(JSON.stringify(r.body)).not.toContain('host-secret')
    // The payment link is on the sheet for "Copy payment link" (owner only); the key appears nowhere else.
    expect(r.body.data.party.payUrl).toMatch(/pay-secret/)
    expect(JSON.stringify({ ...r.body.data.party, payUrl: null })).not.toContain('pay-secret')
  })

  it('R6: a party paid after its time was taken carries the overlap warning; a cancelled one says so', async () => {
    const lost = ours({ overlap: true })
    await createPartyRecord(lost)
    expect((await get(lost.bookingId)).body.data.party.overlap).toBe(true)
    const gone = ours({ status: 'cancelled', cancelled: { at, by: KADEN, note: 'They called' } })
    await createPartyRecord(gone)
    expect((await get(gone.bookingId)).body.data.party).toMatchObject({ status: 'cancelled', paymentState: 'cancelled', dueCents: 0 })
  })

  it('shows the party’s refunds and saved refund requests', async () => {
    const rec = ours()
    await createPartyRecord(rec)
    await recordPartyPayment(`pay_${rec.bookingId}`, rec.bookingId, 'chg_1')
    const request = new Request('https://x.test/api/admin/parties/refund.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie() },
      body: JSON.stringify({ partyId: rec.bookingId, chargeId: 'chg_1', cents: 10000, reason: 'Fewer guests', attempt: `tok_${uid()}` }),
    })
    expect((await refundRoute.POST({ request, url: new URL(request.url) } as any)).status).toBe(200)
    const party = (await get(rec.bookingId)).body.data.party
    expect(party.refunds).toEqual([expect.objectContaining({ chargeId: 'chg_1', cents: 10000 })])
    expect(party.refundRequests).toEqual([expect.objectContaining({ chargeId: 'chg_1', cents: 10000 })])
  })

  it('a party booked in Square is read only (legacy) with nothing due here', async () => {
    const id = `sq_${uid()}`
    await createPartyRecord({
      bookingId: id, hostToken: 'host-secret', craftName: 'Pails', startIso: '2031-03-15T19:00:00.000Z', durationMinutes: 90,
      hostName: 'Old Host', hostEmail: 'old@example.com', guestCount: 12, title: null, dropOff: false, createdAt: at,
    } as PartyRecord)
    const party = (await get(id)).body.data.party
    expect(party).toMatchObject({ legacy: true, paymentState: 'legacy', dueCents: 0, status: 'booked', endIso: '2031-03-15T20:30:00.000Z', refundRequests: [] })
  })

  it('no record on file: party null', async () => {
    expect((await get(`sq_none_${uid()}`)).body.data.party).toBeNull()
  })
})
