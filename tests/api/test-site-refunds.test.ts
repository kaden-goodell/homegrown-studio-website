// @vitest-environment node
/**
 * Final security review I1: R41 covers money too. On a deploy preview or
 * branch deploy with no STORE_NAMESPACE (it shares the live stores and the
 * live Square), every refund path (class, party, reader, paid-not-seated,
 * paid-elsewhere), the refund-request store, the party store and staff
 * gift-card making are refused BEFORE Square is called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ctx = vi.hoisted(() => ({ value: 'dev' as string }))
vi.mock('@lib/deploy-context', async (orig) => {
  const real = await orig<typeof import('@lib/deploy-context')>()
  return { ...real, deployContext: () => ctx.value, isPreviewOrDev: () => ctx.value !== 'production' && ctx.value !== 'unknown' }
})
const mocks = vi.hoisted(() => ({
  refundPayment: vi.fn(async (i: any) => ({ id: 'rf_x', paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' })),
  readPayment: vi.fn(async (paymentId: string) => ({ id: paymentId, orderId: null, status: 'COMPLETED', amountCents: 3270, refundedCents: 0, refunds: [], createdAt: null })),
  mint: vi.fn(async () => ({ id: 'sq1', gan: '7783000011112222', balanceCents: 2500, state: 'ACTIVE' })),
  staff: { id: 'sam', name: 'Sam', role: 'crew' as 'owner' | 'crew' },
}))
vi.mock('@config/providers', () => ({
  providers: {
    payment: { refundPayment: mocks.refundPayment, readPayment: mocks.readPayment },
    giftcard: { mint: mocks.mint, get: vi.fn() },
  },
}))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock('@lib/email', () => ({ sendRefundEmail: vi.fn(async () => ({ sent: true })) }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: vi.fn(async () => ({ sent: 0 })) }))
vi.mock('@lib/staff-auth', async (orig) => {
  const real = await orig<typeof import('@lib/staff-auth')>()
  return { ...real, staffAuthorized: async () => mocks.staff, byOf: (m: any) => ({ id: m.id, name: m.name }) }
})

import * as adminClassRefund from '@pages/api/admin/classes/refund.json'
import * as staffClassRefund from '@pages/api/staff/class-refund.json'
import * as adminPartyRefund from '@pages/api/admin/parties/refund.json'
import * as staffPartyRefund from '@pages/api/staff/party-refund.json'
import * as giftCards from '@pages/api/staff/gift-cards.json'
import { adminCookie } from '@lib/admin-auth'
import { createClass } from '@lib/classes/class-store'
import { makeKvStore } from '@lib/blob-store'
import { createPartyRecord, updatePartyRecord, getPartyRecord, type PartyRecord } from '@lib/party-store'
import { listRefundRequests, saveRefundRequest } from '@lib/classes/refund-requests'
import { NO_TEST_STORE, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { refundReaderPayments } from '@lib/classes/reader-refund'
import { refundPaidNotSeated } from '@lib/classes/paid-not-seated-refund'
import { refundPaidElsewhere } from '@lib/parties/paid-elsewhere'
import type { ClassContent } from '@lib/classes/types'
import type { LedgerLine } from '@lib/classes/seat-ledger'

const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')
const cookie = () => adminCookie().split(';')[0]
async function post(route: any, body: unknown) {
  const request = new Request('https://deploy-preview-9--site.netlify.app/api/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie() }, body: JSON.stringify(body),
  })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

const content = (): ClassContent => ({
  name: 'Candles', description: '', imageUrl: null, instructor: null,
  rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
  prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
})
const line = (): LedgerLine => ({
  id: 'led_t1', bookingId: 'bkg_t1', sessionIds: ['ses_t1'], ticketTypeId: 'person', passId: 'all', seat: 1,
  priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
  state: 'confirmed', holdExpiresAt: null,
  customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '4029802907' },
  square: { orderId: 'o1', paymentId: 'pay_t1', lineUid: null }, by: null, refunds: [], at: new Date().toISOString(),
})
async function paidClass(): Promise<string> {
  const start = Date.now() + 7 * 864e5
  const cls = await createClass({
    content: content(), status: 'open', by: { id: 'admin', name: 'Owner' },
    sessions: [{ id: 'ses_t1', startIso: new Date(start).toISOString(), endIso: new Date(start + 5400e3).toISOString(), capacity: 12 }],
  })
  await ledgerKv.set(`ledger-${cls.id}`, JSON.stringify({ classId: cls.id, lines: [line()] }))
  return cls.id
}
let n = 0
async function paidParty(): Promise<PartyRecord> {
  const id = `pty_ts${++n}${Date.now().toString(36)}`
  const rec: PartyRecord = {
    bookingId: id, hostToken: 'tok', craftName: 'Pails', startIso: '2031-11-14T19:30:00.000Z', durationMinutes: 90,
    hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '4029802907', guestCount: 12, title: null, dropOff: false,
    createdAt: '2026-10-19T00:00:00.000Z', source: 'ours', status: 'booked', endIso: '2031-11-14T21:00:00.000Z', packageId: 'pkg_whole',
    items: [{ id: 'itm_pkg', kind: 'package', refId: 'pkg_whole', label: 'Studio fee', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: 'chg_1', addedAt: '2026-10-19T00:00:00.000Z', by: null }],
    charges: [{ id: 'chg_1', via: 'online', orderId: `ord_${id}`, paymentId: `pay_${id}`, cents: 30000, quotedCents: 30000, itemIds: ['itm_pkg'], receiptUrl: null, at: '2026-10-19T00:00:00.000Z', by: null }],
    refunds: [], paying: null,
  } as PartyRecord
  await createPartyRecord(rec)
  return rec
}

beforeEach(() => {
  ctx.value = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STORE_NAMESPACE', '')
  mocks.refundPayment.mockClear(); mocks.readPayment.mockClear(); mocks.mint.mockClear()
})
afterEach(() => { ctx.value = 'dev'; vi.unstubAllEnvs() })

describe('I1: refunds on a test site with no store of its own', () => {
  for (const context of ['deploy-preview', 'branch-deploy']) {
    it(`${context}: class refunds (owner and crew) → 503, Square never called, nothing saved`, async () => {
      const classId = await paidClass()
      ctx.value = context
      for (const route of [adminClassRefund, staffClassRefund]) {
        const r = await post(route, { classId, bookingId: 'bkg_t1', kind: 'booking', reason: 'Testing it', attempt: `a_${++n}` })
        expect(r.status).toBe(503)
        expect(r.body).toMatchObject({ error: NO_TEST_STORE, code: 'NO_TEST_STORE' })
      }
      expect(mocks.refundPayment).not.toHaveBeenCalled()
      expect(mocks.readPayment).not.toHaveBeenCalled()
      ctx.value = 'dev'
      expect(await listRefundRequests(classId, 'bkg_t1')).toEqual([])
    })

    it(`${context}: party refunds (owner and crew) → 503, Square never called, party unchanged`, async () => {
      const p = await paidParty()
      ctx.value = context
      for (const route of [adminPartyRefund, staffPartyRefund]) {
        const r = await post(route, { partyId: p.bookingId, chargeId: 'chg_1', cents: 1000, reason: 'Testing it', attempt: `a_${++n}` })
        expect(r.status).toBe(503)
        expect(r.body).toMatchObject({ error: NO_TEST_STORE, code: 'NO_TEST_STORE' })
      }
      expect(mocks.refundPayment).not.toHaveBeenCalled()
      ctx.value = 'dev'
      expect((await getPartyRecord(p.bookingId))!.refunds).toEqual([])
    })
  }

  it('reader, paid-not-seated and paid-elsewhere refunds refuse before any Square call', async () => {
    ctx.value = 'deploy-preview'
    const by = { id: 'kaden', name: 'Kaden' }
    await expect(refundReaderPayments('bkg_x', 'ord_x', ['pay_x'], 'r', by)).rejects.toBeInstanceOf(TestSiteStoreError)
    await expect(refundPaidNotSeated('pns_x', 'r', by)).rejects.toBeInstanceOf(TestSiteStoreError)
    await expect(refundPaidElsewhere('ord_x', 'r', by)).rejects.toBeInstanceOf(TestSiteStoreError)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    expect(mocks.readPayment).not.toHaveBeenCalled()
  })

  it('the stores refuse too (defence in depth): refund requests, party create and update', async () => {
    const p = await paidParty()
    ctx.value = 'unknown'
    vi.stubEnv('NETLIFY', 'true')
    await expect(saveRefundRequest({ id: 'r1', classId: 'c', bookingId: 'b' } as any, { seen: [], againOf: null })).rejects.toBeInstanceOf(TestSiteStoreError)
    await expect(createPartyRecord({ ...p, bookingId: 'pty_new_ts' })).rejects.toBeInstanceOf(TestSiteStoreError)
    await expect(updatePartyRecord(p.bookingId, (r) => ({ ...r, guestCount: 3 }), 'test', null)).rejects.toBeInstanceOf(TestSiteStoreError)
  })

  it('staff gift-card making → 503, Square never asked to make a card', async () => {
    ctx.value = 'branch-deploy'
    const r = await post(giftCards, { amountDollars: 25, forWhom: 'Megan' })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe(NO_TEST_STORE)
    expect(mocks.mint).not.toHaveBeenCalled()
  })

  it('a deploy with its own STORE_NAMESPACE refunds as normal', async () => {
    ctx.value = 'deploy-preview'
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    const classId = await paidClass()
    const r = await post(adminClassRefund, { classId, bookingId: 'bkg_t1', kind: 'booking', reason: 'ok', attempt: `a_${++n}` })
    expect(r.status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
  })
})
