/**
 * End-to-end integration tests for the booking flow.
 * Tests the full wizard flow using mock providers via API routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock providers module — all routes import from @config/providers
const mockSearchAvailability = vi.fn()
const mockCreateBooking = vi.fn()
const mockGetEventTypes = vi.fn()
const mockGetAddOns = vi.fn()
const mockCreateOrder = vi.fn()
const mockProcessPayment = vi.fn()
const mockFindOrCreate = vi.fn()
const mockNotificationSend = vi.fn()
const mockGetAvailableCapacity = vi.fn()
const mockGetClientConfig = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    booking: {
      searchAvailability: mockSearchAvailability,
      createBooking: mockCreateBooking,
    },
    catalog: {
      getEventTypes: mockGetEventTypes,
      getAddOns: mockGetAddOns,
    },
    payment: {
      createOrder: mockCreateOrder,
      processPayment: mockProcessPayment,
      getClientConfig: mockGetClientConfig,
    },
    customer: {
      findOrCreate: mockFindOrCreate,
    },
    capacity: {
      getAvailableCapacity: mockGetAvailableCapacity,
    },
    notification: {
      send: mockNotificationSend,
    },
  },
}))

// Mock coupons module used by the validate-coupon route
const mockValidateCoupon = vi.fn()
vi.mock('@lib/coupons', () => ({
  validateCoupon: (...args: any[]) => mockValidateCoupon(...args),
}))

// Import API routes after mocking
const workshopList = await import('../../src/pages/api/workshops/list.json')
const workshopAvailability = await import('../../src/pages/api/workshops/availability.json')
const bookingCreate = await import('../../src/pages/api/booking/create.json')
const customerFindOrCreate = await import('../../src/pages/api/customer/find-or-create.json')
const checkoutCreateOrder = await import('../../src/pages/api/checkout/create-order.json')
const checkoutProcessPayment = await import('../../src/pages/api/checkout/process-payment.json')
const checkoutValidateCoupon = await import('../../src/pages/api/checkout/validate-coupon.json')

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Booking flow integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes full wizard flow: browse → select slot → create customer → order → pay → book', async () => {
    // Step 1: Browse event types
    mockGetEventTypes.mockResolvedValue([
      {
        id: 'EVT1',
        name: 'Pottery Workshop',
        description: 'Learn pottery basics',
        category: 'Workshops',
        variations: [{ id: 'VAR1', name: 'Standard', priceAmount: 4500, priceCurrency: 'USD' }],
        modifiers: [],
        flow: 'booking',
        duration: 120,
      },
    ])
    // Capacity returns null (unlimited) for all slots
    mockGetAvailableCapacity.mockResolvedValue(new Map())

    const listCtx = { request: new Request('http://localhost/api/workshops/list.json') } as any
    const listRes = await workshopList.GET(listCtx)
    const listData = await listRes.json()
    expect(listData.data).toHaveLength(1)
    expect(listData.data[0].name).toBe('Pottery Workshop')

    // Step 2: Search availability
    mockSearchAvailability.mockResolvedValue([
      {
        id: '2026-03-15T10:00:00Z',
        startAt: '2026-03-15T10:00:00Z',
        endAt: '2026-03-15T12:00:00Z',
        duration: 120,
        locationId: 'LOC1',
        available: true,
      },
      {
        id: '2026-03-15T14:00:00Z',
        startAt: '2026-03-15T14:00:00Z',
        endAt: '2026-03-15T16:00:00Z',
        duration: 120,
        locationId: 'LOC1',
        available: true,
      },
    ])

    const availCtx = {
      request: makeRequest({
        eventTypeId: 'EVT1',
        startDate: '2026-03-15',
        endDate: '2026-03-22',
      }),
    } as any
    const availRes = await workshopAvailability.POST(availCtx)
    const availData = await availRes.json()
    expect(availData.data).toHaveLength(2)

    // Step 3: Create or find customer
    mockFindOrCreate.mockResolvedValue({
      id: 'CUST1',
      email: 'test@example.com',
      name: 'Jane Doe',
    })

    const custCtx = {
      request: makeRequest({ givenName: 'Jane', familyName: 'Doe', email: 'test@example.com' }),
    } as any
    const custRes = await customerFindOrCreate.POST(custCtx)
    const custData = await custRes.json()
    expect(custData.data.id).toBe('CUST1')

    // Step 4: Create order
    mockCreateOrder.mockResolvedValue({
      id: 'ORD1',
      lineItems: [{ name: 'Pottery Workshop', quantity: 1, pricePerUnit: 4500 }],
      discounts: [],
      totalAmount: 4500,
      currency: 'USD',
      status: 'open',
    })

    const orderCtx = {
      request: makeRequest({
        customerId: 'CUST1',
        lineItems: [{ name: 'Pottery Workshop', quantity: 1, pricePerUnit: 4500 }],
      }),
    } as any
    const orderRes = await checkoutCreateOrder.POST(orderCtx)
    const orderData = await orderRes.json()
    expect(orderData.data.id).toBe('ORD1')
    expect(orderData.data.totalAmount).toBe(4500)

    // Step 5: Process payment
    mockProcessPayment.mockResolvedValue({
      id: 'PAY1',
      orderId: 'ORD1',
      amount: 4500,
      status: 'completed',
      receiptUrl: 'https://squareup.com/receipt/1',
    })

    const payCtx = {
      request: makeRequest({
        orderId: 'ORD1',
        paymentToken: 'cnon:card-nonce',
        amount: 4500,
        currency: 'USD',
      }),
    } as any
    const payRes = await checkoutProcessPayment.POST(payCtx)
    const payData = await payRes.json()
    expect(payData.data.status).toBe('completed')

    // Step 6: Create booking
    mockCreateBooking.mockResolvedValue({
      id: 'BK1',
      status: 'confirmed',
      slot: availData.data[0],
      customerId: 'CUST1',
      eventType: 'EVT1',
      createdAt: '2026-03-14T08:00:00Z',
    })

    const bookCtx = {
      request: makeRequest({
        slotId: '2026-03-15T10:00:00Z',
        customerId: 'CUST1',
        eventType: 'EVT1',
        guestCount: 4,
        orderIdRef: 'ORD1',
      }),
    } as any
    const bookRes = await bookingCreate.POST(bookCtx)
    const bookData = await bookRes.json()
    expect(bookData.data.id).toBe('BK1')
    expect(bookData.data.status).toBe('confirmed')
  })

  it('validates coupon flow end-to-end', async () => {
    // Valid coupon
    mockValidateCoupon.mockReturnValue({
      valid: true,
      description: '20% off your order',
      discount: { name: 'SAVE20', type: 'percent', value: 20, scope: 'order' },
    })

    const validCtx = {
      request: makeRequest({ code: 'SAVE20' }),
    } as any
    const validRes = await checkoutValidateCoupon.POST(validCtx)
    const validData = await validRes.json()
    expect(validData.data.valid).toBe(true)
    expect(validData.data.discount.value).toBe(20)

    // Invalid coupon
    mockValidateCoupon.mockReturnValue({ valid: false, error: 'Invalid coupon code' })

    const invalidCtx = {
      request: makeRequest({ code: 'FAKECODE' }),
    } as any
    const invalidRes = await checkoutValidateCoupon.POST(invalidCtx)
    const invalidData = await invalidRes.json()
    expect(invalidData.data.valid).toBe(false)
  })

  it('handles API errors gracefully with notifications', async () => {
    mockCreateBooking.mockRejectedValue(new Error('Square API unavailable'))
    mockNotificationSend.mockResolvedValue(undefined)

    const bookCtx = {
      request: makeRequest({
        slotId: '2026-03-15T10:00:00Z',
        customerId: 'CUST1',
        eventType: 'EVT1',
      }),
    } as any
    const bookRes = await bookingCreate.POST(bookCtx)
    expect(bookRes.status).toBe(500)

    const errorData = await bookRes.json()
    expect(errorData.error).toBeTruthy()

    // Should have sent a failure notification
    expect(mockNotificationSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api-failure',
        severity: 'warning',
      })
    )
  })
})
