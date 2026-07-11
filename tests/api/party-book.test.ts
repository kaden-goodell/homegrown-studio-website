import { describe, it, expect, vi, beforeEach } from 'vitest'
import { partyConfig } from '@config/party.config'

// --- Module mocks set up before any import ---

// Mock party-availability so we can control isStartOpen per test
vi.mock('@lib/party-availability', () => ({
  isStartOpen: vi.fn().mockResolvedValue(true),
  openPartyStarts: vi.fn().mockResolvedValue([]),
  studioDateOf: vi.fn().mockReturnValue('2026-09-01'),
}))

// Mock email so no real SMTP calls are made
vi.mock('@lib/email', () => ({
  sendPartyConfirmationEmail: vi.fn().mockResolvedValue({ sent: false }),
}))

// Mock party-store so we don't write to Netlify Blobs
const mockGetPartyRecord = vi.fn()
vi.mock('@lib/party-store', () => ({
  savePartyRecord: vi.fn().mockResolvedValue(undefined),
  newHostToken: vi.fn().mockReturnValue('mock-host-token'),
  getPartyRecord: (...args: any[]) => mockGetPartyRecord(...args),
}))

// Mock dev-flags so payment bypass is always disabled in tests
vi.mock('@lib/dev-flags', () => ({
  paymentBypassEnabled: vi.fn().mockReturnValue(false),
}))

// Mock kit-store — the themed-table claims ledger. The party flow reserves a
// theme-week before charging and confirms/releases around the outcome (LR-1).
const mockClaimWeek = vi.fn()
const mockConfirmWeekClaim = vi.fn()
const mockReleaseWeekClaim = vi.fn()
const mockListKitOrders = vi.fn()
vi.mock('@lib/kit-store', () => ({
  claimWeek: (...args: any[]) => mockClaimWeek(...args),
  confirmWeekClaim: (...args: any[]) => mockConfirmWeekClaim(...args),
  releaseWeekClaim: (...args: any[]) => mockReleaseWeekClaim(...args),
  listKitOrders: (...args: any[]) => mockListKitOrders(...args),
  kitOrderToLedgerRecord: () => null,
}))

// --- Mutable provider spies (shared across tests, reset in beforeEach) ---
const mockCreateBooking = vi.fn()
const mockCancelBooking = vi.fn()
const mockFindOrCreate = vi.fn()
const mockCreateOrder = vi.fn()
const mockProcessPayment = vi.fn()
const mockNotify = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    booking: {
      createBooking: (...args: any[]) => mockCreateBooking(...args),
      cancelBooking: (...args: any[]) => mockCancelBooking(...args),
    },
    payment: {
      createOrder: (...args: any[]) => mockCreateOrder(...args),
      processPayment: (...args: any[]) => mockProcessPayment(...args),
    },
    customer: {
      findOrCreate: (...args: any[]) => mockFindOrCreate(...args),
    },
    notification: {
      send: (...args: any[]) => mockNotify(...args),
    },
  },
}))

// Package price for the serves-10 tier — matches kit.config's real tiers.
const GILDED_10_PRICE_CENTS = 7500

/** Seed kit config so themed tables are enabled + "seeded" for the theme tests. */
async function enableThemedTables() {
  const { siteConfig } = await import('@config/site.config')
  ;(siteConfig.features as any).kits = { enabled: true }
  const { kitConfig } = await import('@config/kit.config')
  Object.assign(kitConfig.square, {
    assemblyItemId: 'assembly-item',
    assemblyVariationId: 'assembly-var',
    packageItemId: 'pkg-item',
    depositItemId: 'dep-item',
  })
  ;(kitConfig.square.packageVariations as any).gilded = { 10: 'g10', 15: 'g15', 20: 'g20' }
  ;(kitConfig.square.depositVariations as any)[10] = 'd10'
  ;(kitConfig.square.depositVariations as any)[15] = 'd15'
  ;(kitConfig.square.depositVariations as any)[20] = 'd20'
}

// --- Helpers ---

function makeBody(overrides: Record<string, any> = {}) {
  return {
    startTime: '2026-09-01T16:00:00.000Z',
    serviceVariationId: 'var-abc',
    serviceVariationVersion: 1234567890,
    durationMinutes: 150,
    craft: { id: 'craft-1', name: 'Tote Bag', perHeadCents: 2000 },
    people: partyConfig.minGuests,
    customer: {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      phone: '256-555-1234',
    },
    paymentToken: 'cnon:card-nonce-ok',
    ...overrides,
  }
}

function createMockContext(body: any, url = 'http://localhost/api/party/book.json') {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request, url: new URL(url), params: {}, redirect: () => new Response(), locals: {} } as any
}

const basePriceCents = partyConfig.basePriceCents

function makeMockBooking(id = 'booking-xyz') {
  return {
    id,
    status: 'confirmed',
    slot: { id: 'slot-1', startAt: '2026-09-01T16:00:00.000Z', endAt: '2026-09-01T18:30:00.000Z', duration: 150, locationId: 'loc-1', available: false },
    customerId: 'cust-1',
    eventType: 'party',
    createdAt: new Date().toISOString(),
    version: 1,
  }
}

function makeMockOrder(totalAmount: number = basePriceCents) {
  return { id: 'order-1', lineItems: [], discounts: [], totalAmount, currency: 'USD', status: 'open' }
}

function makeMockPayment(status: 'completed' | 'failed' = 'completed') {
  return { id: 'pay-1', orderId: 'order-1', amount: basePriceCents, status, receiptUrl: 'https://receipt.example.com/pay-1' }
}

// --- Tests ---

describe('POST /api/party/book.json', () => {
  let POST: any
  let isStartOpen: any
  let sendPartyConfirmationEmail: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Re-import the module after clearing mocks
    vi.resetModules()

    // Re-require mocks after resetModules
    const avail = await import('@lib/party-availability')
    isStartOpen = vi.mocked(avail.isStartOpen)
    isStartOpen.mockResolvedValue(true)

    const emailMod = await import('@lib/email')
    sendPartyConfirmationEmail = vi.mocked(emailMod.sendPartyConfirmationEmail)
    sendPartyConfirmationEmail.mockResolvedValue({ sent: false })

    mockFindOrCreate.mockResolvedValue({ id: 'cust-1', email: 'alice@example.com', givenName: 'Alice', familyName: 'Smith' })
    mockCreateBooking.mockResolvedValue(makeMockBooking())
    mockCancelBooking.mockResolvedValue(undefined)
    mockCreateOrder.mockResolvedValue(makeMockOrder())
    mockProcessPayment.mockResolvedValue(makeMockPayment())
    mockNotify.mockResolvedValue(undefined)

    mockClaimWeek.mockResolvedValue('ok')
    mockConfirmWeekClaim.mockResolvedValue('ok')
    mockReleaseWeekClaim.mockResolvedValue(undefined)
    mockListKitOrders.mockResolvedValue([])
    mockGetPartyRecord.mockResolvedValue(null)

    await enableThemedTables()

    const mod = await import('@pages/api/party/book.json')
    POST = mod.POST
  })

  // ── (1) slot not open → 409, processPayment never called ─────────────────
  it('returns 409 when slot is already taken and never calls processPayment', async () => {
    isStartOpen.mockResolvedValue(false)

    const ctx = createMockContext(makeBody())
    const res = await POST(ctx)

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.detail).toMatch(/just booked|not charged/i)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  // ── (2) createBooking throws → card not charged copy, processPayment never called
  it('returns error saying card was not charged when createBooking throws', async () => {
    mockCreateBooking.mockRejectedValue(new Error('Square 503'))

    const ctx = createMockContext(makeBody())
    const res = await POST(ctx)

    expect(res.status).toBeGreaterThanOrEqual(400)
    const json = await res.json()
    expect(json.detail).toMatch(/not charged/i)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  // ── (3) processPayment returns 'failed' → cancelBooking called, 402 with date released copy
  it('cancels booking and returns 402 when processPayment fails', async () => {
    const booking = makeMockBooking('booking-to-cancel')
    mockCreateBooking.mockResolvedValue(booking)
    mockProcessPayment.mockResolvedValue(makeMockPayment('failed'))

    const ctx = createMockContext(makeBody())
    const res = await POST(ctx)

    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.detail).toMatch(/released|declined/i)
    expect(mockCancelBooking).toHaveBeenCalledWith('booking-to-cancel', expect.anything())
  })

  // ── (4) happy path → returns bookingId, hostToken, emailSent, no orderIdRef in createBooking
  it('happy path returns bookingId, hostToken, emailSent and never passes orderIdRef to createBooking', async () => {
    const ctx = createMockContext(makeBody())
    const res = await POST(ctx)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeDefined()
    expect(typeof json.data.bookingId).toBe('string')
    expect(typeof json.data.hostToken).toBe('string')
    expect(typeof json.data.emailSent).toBe('boolean')

    // createBooking must NOT have been called with orderIdRef
    expect(mockCreateBooking).toHaveBeenCalledTimes(1)
    const callArg = mockCreateBooking.mock.calls[0][0]
    expect(callArg).not.toHaveProperty('orderIdRef')
  })

  // ── (5) serviceVariationVersion: 0 passes validation
  it('accepts serviceVariationVersion of 0 (falsy but valid)', async () => {
    const ctx = createMockContext(makeBody({ serviceVariationVersion: 0 }))
    const res = await POST(ctx)

    // Should NOT be a 400 validation error
    expect(res.status).not.toBe(400)
  })

  // ── (5b) lastName is required — but the server must never fabricate one
  // (the old client duplicated firstName into lastName, creating "Ari Ari"
  // Square customers; requiring the field is the honest fix).
  it('rejects an empty lastName with 400', async () => {
    const body = makeBody({ customer: { firstName: 'Alice', lastName: '', email: 'alice@example.com', phone: '256-555-1234' } })
    const ctx = createMockContext(body)
    const res = await POST(ctx)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.detail).toMatch(/full name/i)
    expect(mockFindOrCreate).not.toHaveBeenCalled()
  })

  // ── (5c) phone is required — the studio's day-of contact channel
  it('rejects a missing or short phone with 400', async () => {
    const body = makeBody({ customer: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '555-1234' } })
    const ctx = createMockContext(body)
    const res = await POST(ctx)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.detail).toMatch(/phone/i)
    expect(mockFindOrCreate).not.toHaveBeenCalled()
  })

  // ── (6) order-total mismatch → cancelBooking called, 500, card not charged + date released
  it('cancels booking and returns 500 on order total mismatch', async () => {
    const booking = makeMockBooking('booking-mismatch')
    mockCreateBooking.mockResolvedValue(booking)
    // Return an order total that doesn't match the expected basePriceCents
    mockCreateOrder.mockResolvedValue(makeMockOrder(basePriceCents + 1))

    const ctx = createMockContext(makeBody())
    const res = await POST(ctx)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.detail).toMatch(/not charged|released/i)
    expect(mockCancelBooking).toHaveBeenCalledWith('booking-mismatch', expect.anything())
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  // ── Themed-table add-on ───────────────────────────────────────────────────

  // (T1) theme happy path → package line item, amount guard includes package,
  // claim placed as kind:'party', claim confirmed after payment.
  it('accepts a themed table: adds the package line item, guards the combined total, confirms the claim', async () => {
    const total = basePriceCents + GILDED_10_PRICE_CENTS
    mockCreateOrder.mockResolvedValue(makeMockOrder(total))

    const ctx = createMockContext(makeBody({ theme: { themeId: 'gilded', serves: 10 } }))
    const res = await POST(ctx)

    expect(res.status).toBe(200)

    // A package line item carrying the server-derived variation id was added.
    const orderArg = mockCreateOrder.mock.calls[0][0]
    const pkgLine = orderArg.lineItems.find((l: any) => l.catalogObjectId === 'g10')
    expect(pkgLine).toBeDefined()
    expect(pkgLine.pricePerUnit).toBe(GILDED_10_PRICE_CENTS)

    // Claim reserved as a party, then confirmed after a successful charge.
    expect(mockClaimWeek).toHaveBeenCalledTimes(1)
    expect(mockClaimWeek.mock.calls[0][0]).toMatchObject({ ledgerThemeId: 'gilded', serves: 10, kind: 'party' })
    expect(mockConfirmWeekClaim).toHaveBeenCalledTimes(1)
    expect(mockReleaseWeekClaim).not.toHaveBeenCalled()
  })

  // (T2) theme serves must equal the guest tier (ceil-5). serves 15 with 10 guests → 400.
  it('rejects a theme whose serves tier does not match the guest count', async () => {
    const ctx = createMockContext(makeBody({ people: 10, theme: { themeId: 'gilded', serves: 15 } }))
    const res = await POST(ctx)

    expect(res.status).toBe(400)
    expect(mockClaimWeek).not.toHaveBeenCalled()
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  // (T3) unstocked themes are never bookable.
  it('rejects an unstocked theme', async () => {
    const ctx = createMockContext(makeBody({ theme: { themeId: 'sterling', serves: 10 } }))
    const res = await POST(ctx)

    expect(res.status).toBe(400)
    expect(mockClaimWeek).not.toHaveBeenCalled()
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  // (T4) claim comes back 'full' → 409, and nothing is booked or charged.
  it('returns 409 when the theme week is fully claimed', async () => {
    mockClaimWeek.mockResolvedValue('full')

    const ctx = createMockContext(makeBody({ theme: { themeId: 'gilded', serves: 10 } }))
    const res = await POST(ctx)

    expect(res.status).toBe(409)
    expect(mockCreateBooking).not.toHaveBeenCalled()
    expect(mockProcessPayment).not.toHaveBeenCalled()
    expect(mockConfirmWeekClaim).not.toHaveBeenCalled()
  })

  // (T5) failed charge with a theme releases BOTH the booking and the claim.
  it('releases the claim and the booking when the charge fails', async () => {
    const total = basePriceCents + GILDED_10_PRICE_CENTS
    mockCreateOrder.mockResolvedValue(makeMockOrder(total))
    mockProcessPayment.mockResolvedValue(makeMockPayment('failed'))

    const ctx = createMockContext(makeBody({ theme: { themeId: 'gilded', serves: 10 } }))
    const res = await POST(ctx)

    expect(res.status).toBe(402)
    expect(mockReleaseWeekClaim).toHaveBeenCalledTimes(1)
    expect(mockCancelBooking).toHaveBeenCalledTimes(1)
    expect(mockConfirmWeekClaim).not.toHaveBeenCalled()
  })
})

// --- Cancellation frees the themed-table claim ------------------------------

describe('POST /api/booking/cancel.json — themed-table release', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const avail = await import('@lib/party-availability')
    vi.mocked(avail.studioDateOf).mockReturnValue('2026-09-01')

    mockCancelBooking.mockResolvedValue(undefined)
    mockNotify.mockResolvedValue(undefined)
    mockReleaseWeekClaim.mockResolvedValue(undefined)
    mockGetPartyRecord.mockResolvedValue(null)

    const mod = await import('@pages/api/booking/cancel.json')
    POST = mod.POST
  })

  it('releases the theme-week claim after a successful cancel', async () => {
    mockGetPartyRecord.mockResolvedValue({
      bookingId: 'booking-xyz',
      startIso: '2026-09-01T16:00:00.000Z',
      theme: { themeId: 'gilded', displayName: 'The Gilded Table', serves: 10, claimRef: 'party-abc123' },
    })

    const req = new Request('http://localhost/api/booking/cancel.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'booking-xyz', bookingVersion: 1 }),
    })
    const res = await POST({ request: req } as any)

    expect(res.status).toBe(200)
    expect(mockCancelBooking).toHaveBeenCalledWith('booking-xyz', 1)
    // weekKeyFor(studioDateOf('2026-09-01...')) → the Thursday on/before Sep 1 = Aug 27.
    expect(mockReleaseWeekClaim).toHaveBeenCalledWith('gilded', '2026-08-27', 'party-abc123')
  })

  it('does not release anything for a theme-less party', async () => {
    mockGetPartyRecord.mockResolvedValue({ bookingId: 'b2', startIso: '2026-09-01T16:00:00.000Z' })

    const req = new Request('http://localhost/api/booking/cancel.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: 'b2', bookingVersion: 1 }),
    })
    const res = await POST({ request: req } as any)

    expect(res.status).toBe(200)
    expect(mockReleaseWeekClaim).not.toHaveBeenCalled()
  })
})
