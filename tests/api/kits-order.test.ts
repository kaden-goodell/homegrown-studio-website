import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { pickupThursdayFor } from '@lib/kit-dates'

// --- Module mocks set up before any import ---

// Email: no real SMTP.
vi.mock('@lib/email', () => ({
  sendKitConfirmationEmail: vi.fn().mockResolvedValue({ sent: false }),
}))

// Dev-flags: payment bypass always off in tests.
vi.mock('@lib/dev-flags', () => ({
  paymentBypassEnabled: vi.fn().mockReturnValue(false),
}))

// Craft catalog: the server-side price authority. Tests tamper with the BODY's
// perHeadCents; this fixture is what the endpoint must trust instead.
const { mockFetchPartyCrafts } = vi.hoisted(() => ({ mockFetchPartyCrafts: vi.fn() }))
vi.mock('@lib/craft-catalog', () => ({
  fetchPartyCrafts: (...a: any[]) => mockFetchPartyCrafts(...a),
}))

// kit.config: the real config ships with empty Square ids (unseeded → 503). Mock
// a seeded config so the order endpoint runs. tiers/lead time mirror the real file
// (kit-dates + kit-ledger read this same module).
vi.mock('@config/kit.config', () => ({
  kitConfig: {
    assemblyFeeCents: 5000,
    tiers: [
      { serves: 10, packagePriceCents: 7500, kitPackagePriceCents: 12500, depositCents: 5000 },
      { serves: 15, packagePriceCents: 10000, kitPackagePriceCents: 15000, depositCents: 7500 },
      { serves: 20, packagePriceCents: 12500, kitPackagePriceCents: 17500, depositCents: 10000 },
    ],
    minGuests: 10,
    maxGuests: 20,
    leadTimeDays: 7,
    bookingWindowDays: 90,
    returnWindow: '4–6 PM',
    timezone: 'America/Chicago',
    square: {
      assemblyItemId: 'assembly-item',
      assemblyVariationId: 'assembly-var',
      packageItemId: 'package-item',
      depositItemId: 'deposit-item',
      packageVariations: {
        gilded: { 10: 'pv-g10', 15: 'pv-g15', 20: 'pv-g20' },
        prism: { 10: 'pv-p10', 15: 'pv-p15', 20: 'pv-p20' },
        'sweet-sixteen': { 10: 'pv-s10', 15: 'pv-s15', 20: 'pv-s20' },
      },
      depositVariations: { 10: 'dv-10', 15: 'dv-15', 20: 'dv-20' },
    },
  },
}))

// --- Mutable provider spies ---
const mockFindOrCreate = vi.fn()
const mockAppendNote = vi.fn()
const mockCreateOrder = vi.fn()
const mockProcessPayment = vi.fn()
const mockCancelOrder = vi.fn()
const mockNotify = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      createOrder: (...a: any[]) => mockCreateOrder(...a),
      processPayment: (...a: any[]) => mockProcessPayment(...a),
      cancelOrder: (...a: any[]) => mockCancelOrder(...a),
    },
    customer: {
      findOrCreate: (...a: any[]) => mockFindOrCreate(...a),
      appendNote: (...a: any[]) => mockAppendNote(...a),
    },
    notification: { send: (...a: any[]) => mockNotify(...a) },
  },
}))

// kit-store stays REAL (real CAS claims for the concurrency test) EXCEPT
// createKitOrder, which we replace with a controllable spy so the persist-retry
// path can be exercised. Everything else (claimWeek/confirm/release/getWeekClaims/
// listKitOrders/_setKitKvForTests) is the genuine article via ...actual, sharing
// the same injected in-memory kv.
const { mockCreateKitOrder } = vi.hoisted(() => ({ mockCreateKitOrder: vi.fn() }))
vi.mock('@lib/kit-store', async (importActual) => {
  const actual = await importActual<typeof import('@lib/kit-store')>()
  return { ...actual, createKitOrder: (...a: any[]) => mockCreateKitOrder(...a) }
})
import {
  _setKitKvForTests,
  claimWeek,
  confirmWeekClaim,
  getWeekClaims,
  listKitOrders,
} from '@lib/kit-store'

/** In-memory blob store with true CAS — mirrors kit-store.test.ts. */
function makeCasBlobStore() {
  const data = new Map<string, { value: string; etag: string }>()
  let seq = 0
  return {
    async get(key: string) {
      return data.get(key)?.value ?? null
    },
    async getWithMetadata(key: string) {
      const e = data.get(key)
      return e ? { data: e.value, etag: e.etag, metadata: {} } : null
    },
    async set(key: string, value: string, opts?: any) {
      const cur = data.get(key)
      if (opts?.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false }
      if (opts?.onlyIfNew && cur) return { modified: false }
      const etag = `e${++seq}`
      data.set(key, { value, etag })
      return { modified: true, etag }
    },
    async list() {
      return { blobs: [...data.keys()].map((key) => ({ key })), directories: [] }
    },
  }
}

// A party date comfortably beyond the 7-day lead time, on a Saturday.
const PARTY_DATE = '2027-06-05'
const WEEK_KEY = pickupThursdayFor(PARTY_DATE) // '2027-06-03'

function makeBody(overrides: Record<string, any> = {}) {
  return {
    crafts: [{ craftId: 'craft-1', name: 'Tote Bag', perHeadCents: 2000 }],
    guests: 10,
    theme: { themeId: 'gilded', serves: 10 },
    partyDate: PARTY_DATE,
    contact: {
      name: 'Alice Smith',
      email: 'alice@example.com',
      phone: '256-555-1234',
      address: '12 Oak Street, Madison AL',
    },
    rentalTermsAccepted: true,
    paymentToken: 'cnon:card-nonce-ok',
    ...overrides,
  }
}

// Unique client address per call — the rate limiter keeps module-level state,
// so tests must not share a budget (and concurrent orders need separate ones).
let ipSeq = 0
function ctx(body: any, url = 'http://localhost/api/kits/order.json') {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request, url: new URL(url), params: {}, redirect: () => new Response(), locals: {}, clientAddress: `10.0.${Math.floor(ipSeq / 256)}.${ipSeq++ % 256}` } as any
}

describe('POST /api/kits/order.json', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    _setKitKvForTests(makeKvStore('kits', 'kits', { _blobStore: makeCasBlobStore() }))

    mockCreateKitOrder.mockResolvedValue(undefined)
    mockFetchPartyCrafts.mockResolvedValue([
      { id: 'craft-1', name: 'Tote Bag', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null, personalized: false, popular: false },
    ])
    mockFindOrCreate.mockResolvedValue({ id: 'cust-1', email: 'alice@example.com', givenName: 'Alice', familyName: 'Smith' })
    mockAppendNote.mockResolvedValue(undefined)
    mockCancelOrder.mockResolvedValue(undefined)
    mockNotify.mockResolvedValue(undefined)
    // Sum the line items exactly like the real providers, so the amount guard passes.
    mockCreateOrder.mockImplementation(async ({ lineItems }: any) => ({
      id: 'order-1',
      version: 3,
      lineItems,
      discounts: [],
      totalAmount: lineItems.reduce((s: number, li: any) => s + li.quantity * li.pricePerUnit, 0),
      currency: 'USD',
      status: 'open',
    }))
    mockProcessPayment.mockResolvedValue({ id: 'pay-1', orderId: 'order-1', amount: 0, status: 'completed', receiptUrl: 'https://receipt.example.com/pay-1' })

    const mod = await import('@pages/api/kits/order.json')
    POST = mod.POST
  })

  it('happy path with theme: creates order with PICKUP fulfillment + all line items, confirms the claim, 200', async () => {
    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.data.orderId).toBe('string')
    expect(typeof json.data.reference).toBe('string')
    expect(json.data.summary.pickupDate).toBe(WEEK_KEY)
    expect(json.data.summary.depositCents).toBe(5000)
    // Deposit-only: $50 charged today; the rest of the quote is a POS balance.
    expect(json.data.summary.totalChargedCents).toBe(5000)
    expect(json.data.summary.quoteTotalCents).toBe(2000 * 10 + 5000 + 7500 + 5000)
    expect(json.data.summary.balanceDueCents).toBe(2000 * 10 + 5000 + 7500)

    // createOrder: PICKUP fulfillment; ONLY the rental-deposit line is charged
    // online (return-time refunds must hit this very payment).
    const call = mockCreateOrder.mock.calls[0][0]
    expect(call.fulfillment).toMatchObject({ type: 'PICKUP', recipientName: 'Alice Smith' })
    const catIds = call.lineItems.map((li: any) => li.catalogObjectId)
    expect(catIds).toEqual(['dv-10'])
    expect(mockProcessPayment).toHaveBeenCalledOnce()
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(5000)

    // Claim confirmed for the theme-week.
    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims).toHaveLength(1)
    expect(claims[0].status).toBe('confirmed')
  })

  it('happy path crafts-only: assembly fee charged as the deposit, no ledger claim, 200', async () => {
    const res = await POST(ctx(makeBody({ theme: undefined, rentalTermsAccepted: undefined })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.summary.depositCents).toBeFalsy()
    expect(json.data.summary.totalChargedCents).toBe(5000)
    expect(json.data.summary.quoteTotalCents).toBe(2000 * 10 + 5000)
    expect(json.data.summary.balanceDueCents).toBe(2000 * 10)

    const call = mockCreateOrder.mock.calls[0][0]
    const catIds = call.lineItems.map((li: any) => li.catalogObjectId)
    expect(catIds).toEqual(['assembly-var'])

    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims).toHaveLength(0)
  })

  it('rejects guests below the minimum with 400, no charge', async () => {
    const res = await POST(ctx(makeBody({ guests: 8, theme: undefined })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects guests above the max with 400', async () => {
    const res = await POST(ctx(makeBody({ guests: 25, theme: undefined })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects a non-tier guest count (kits come in sizes of 5) with 400', async () => {
    const res = await POST(ctx(makeBody({ guests: 12, theme: undefined })))
    expect(res.status).toBe(400)
    expect((await res.json()).detail).toMatch(/sizes of 10, 15, 20/)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects a theme whose serves does not match the guest tier with 400', async () => {
    const res = await POST(ctx(makeBody({ guests: 15, theme: { themeId: 'gilded', serves: 10 } })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects a short-notice party date with 400', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const res = await POST(ctx(makeBody({ partyDate: soon, theme: undefined })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects missing rental-terms acceptance when a theme is selected with 400', async () => {
    const res = await POST(ctx(makeBody({ rentalTermsAccepted: false })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects a missing/short address with 400', async () => {
    const res = await POST(ctx(makeBody({ contact: { name: 'Alice Smith', email: 'alice@example.com', phone: '256-555-1234', address: 'x' } })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('rejects a tampered craft price with 409 — no claim, no order, no charge', async () => {
    // Catalog says $20/head; the body claims $0.01. The catalog must win.
    const res = await POST(ctx(makeBody({ crafts: [{ craftId: 'craft-1', name: 'Tote Bag', perHeadCents: 1 }] })))
    expect(res.status).toBe(409)
    expect(mockCreateOrder).not.toHaveBeenCalled()
    expect(mockProcessPayment).not.toHaveBeenCalled()
    expect(await getWeekClaims('gilded', WEEK_KEY)).toHaveLength(0)
  })

  it('rejects a personalized craft without the made-to-order acknowledgment, 400 pre-charge', async () => {
    mockFetchPartyCrafts.mockResolvedValue([
      { id: 'craft-1', name: 'Tote Bag', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null, personalized: true, popular: false },
    ])
    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(400)
    expect((await res.json()).detail).toMatch(/made-to-order/)
    expect(mockCreateOrder).not.toHaveBeenCalled()
    expect(await getWeekClaims('gilded', WEEK_KEY)).toHaveLength(0)
  })

  it('accepts a personalized craft WITH the acknowledgment and stamps the record', async () => {
    mockFetchPartyCrafts.mockResolvedValue([
      { id: 'craft-1', name: 'Tote Bag', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null, personalized: true, popular: false },
    ])
    const res = await POST(ctx(makeBody({ personalizedAck: true })))
    expect(res.status).toBe(200)
    expect(mockCreateKitOrder.mock.calls[0][0].crafts[0].personalized).toBe(true)
  })

  it('rejects a craft id that is not in the catalog with 400', async () => {
    const res = await POST(ctx(makeBody({ crafts: [{ craftId: 'not-a-craft', name: 'Fake', perHeadCents: 2000 }] })))
    expect(res.status).toBe(400)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('returns 502 without charging when the catalog lookup fails', async () => {
    mockFetchPartyCrafts.mockRejectedValue(new Error('square down'))
    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(502)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  it('quotes with the CATALOG price and name, not the client’s', async () => {
    mockFetchPartyCrafts.mockResolvedValue([
      { id: 'craft-1', name: 'Tote Bag (2026)', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null, personalized: false, popular: false },
    ])
    // Client price agrees; client NAME is stale — the catalog name is what the
    // record (and the pickup-balance quote) must carry.
    const res = await POST(ctx(makeBody({ crafts: [{ craftId: 'craft-1', name: 'Old Name', perHeadCents: 2000 }] })))
    expect(res.status).toBe(200)
    const record = mockCreateKitOrder.mock.calls[0][0]
    expect(record.crafts[0]).toMatchObject({ name: 'Tote Bag (2026)', qty: 10, perHeadCents: 2000 })
    expect(record.quoteTotalCents).toBe(2000 * 10 + 5000 + 7500 + 5000)
    expect(record.balanceDueCents).toBe(record.quoteTotalCents - 5000)
  })

  it('rejects a taken theme-week with 409', async () => {
    // Fill all 3 gilded hero sets for the week → no tier offerable.
    for (const ref of ['r1', 'r2', 'r3']) {
      await claimWeek({ ledgerThemeId: 'gilded', weekKey: WEEK_KEY, serves: 10, kind: 'kit', ref, today: '2027-01-01' })
      await confirmWeekClaim({ ledgerThemeId: 'gilded', weekKey: WEEK_KEY, ref, serves: 10, kind: 'kit' })
    }
    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(409)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('failed charge: cancels the order with its version, releases the claim, returns 402', async () => {
    mockProcessPayment.mockResolvedValue({ id: 'pay-x', orderId: 'order-1', amount: 0, status: 'failed' })

    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(402)
    expect(mockCancelOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', version: 3 }))

    // Claim released — the week is free again.
    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims).toHaveLength(0)
  })

  it('amount-guard mismatch: cancels order, releases claim, 500, no charge', async () => {
    mockCreateOrder.mockImplementation(async ({ lineItems }: any) => ({
      id: 'order-1', version: 9, lineItems, discounts: [],
      totalAmount: lineItems.reduce((s: number, li: any) => s + li.quantity * li.pricePerUnit, 0) + 1,
      currency: 'USD', status: 'open',
    }))
    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(500)
    expect(mockCancelOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', version: 9 }))
    expect(mockProcessPayment).not.toHaveBeenCalled()
    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims).toHaveLength(0)
  })

  it('two concurrent orders for the last slot: exactly one 200 and one 409', async () => {
    // Pre-fill 2 of 3 hero sets → one serves-10 slot remains.
    for (const ref of ['pre1', 'pre2']) {
      await claimWeek({ ledgerThemeId: 'gilded', weekKey: WEEK_KEY, serves: 10, kind: 'kit', ref, today: '2027-01-01' })
      await confirmWeekClaim({ ledgerThemeId: 'gilded', weekKey: WEEK_KEY, ref, serves: 10, kind: 'kit' })
    }

    const [a, b] = await Promise.all([
      POST(ctx(makeBody({ contact: { name: 'A One', email: 'a@example.com', phone: '256-555-0001', address: '1 Road Street' } }))),
      POST(ctx(makeBody({ contact: { name: 'B Two', email: 'b@example.com', phone: '256-555-0002', address: '2 Road Street' } }))),
    ])
    const codes = [a.status, b.status].sort()
    expect(codes).toEqual([200, 409])
  })

  it('persist throws once then succeeds: single charge, claim confirmed, 200', async () => {
    mockCreateKitOrder.mockRejectedValueOnce(new Error('blob 503'))

    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(200)
    expect(mockCreateKitOrder).toHaveBeenCalledTimes(2) // failed once, retried
    expect(mockProcessPayment).toHaveBeenCalledOnce() // never re-charged
    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims[0].status).toBe('confirmed')
  })

  it('persist fails twice: 500 acknowledging the charge, order NOT voided, claim NOT released', async () => {
    mockCreateKitOrder.mockRejectedValue(new Error('blob down'))

    const res = await POST(ctx(makeBody()))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.detail).toMatch(/charged|reserved|receipt/i)
    // Money reality wins: paid order stays, pending claim stays (ages out via TTL).
    expect(mockCancelOrder).not.toHaveBeenCalled()
    const claims = await getWeekClaims('gilded', WEEK_KEY)
    expect(claims).toHaveLength(1)
    expect(claims[0].status).toBe('pending')
  })
})
