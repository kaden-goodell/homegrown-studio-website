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
vi.mock('@lib/party-store', () => ({
  savePartyRecord: vi.fn().mockResolvedValue(undefined),
  newHostToken: vi.fn().mockReturnValue('mock-host-token'),
}))

// Mock dev-flags so payment bypass is always disabled in tests
vi.mock('@lib/dev-flags', () => ({
  paymentBypassEnabled: vi.fn().mockReturnValue(false),
}))

// --- Mutable provider spies (shared across tests, reset in beforeEach) ---
const mockCreateBooking = vi.fn()
const mockCancelBooking = vi.fn()
const mockFindOrCreate = vi.fn()
const mockCreateOrder = vi.fn()
const mockProcessPayment = vi.fn()

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
  },
}))

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
      phone: '555-1234',
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

function makeMockOrder(totalAmount = basePriceCents) {
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

  // ── (5b) empty lastName passes validation — no last-name duplication
  it('accepts an empty lastName (only firstName + email required)', async () => {
    const body = makeBody({ customer: { firstName: 'Alice', lastName: '', email: 'alice@example.com', phone: '' } })
    const ctx = createMockContext(body)
    const res = await POST(ctx)

    // Should NOT be a 400 validation error — lastName is optional
    expect(res.status).not.toBe(400)
    // findOrCreate must have been called with the actual (empty) lastName, not a duplicate of firstName
    expect(mockFindOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ givenName: 'Alice', familyName: '' })
    )
  })

  // ── (5c) missing lastName passes validation
  it('accepts a missing lastName', async () => {
    const { lastName: _omitted, ...customerNoLastName } = makeBody().customer
    const body = makeBody({ customer: customerNoLastName })
    const ctx = createMockContext(body)
    const res = await POST(ctx)

    expect(res.status).not.toBe(400)
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
})
