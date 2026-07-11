import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOrdersCreate = vi.fn()
const mockOrdersUpdate = vi.fn()
const mockPaymentsCreate = vi.fn()
const mockRefundsRefundPayment = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    orders = { create: mockOrdersCreate, update: mockOrdersUpdate }
    payments = { create: mockPaymentsCreate }
    refunds = { refundPayment: mockRefundsRefundPayment }
    constructor(_opts: any) {}
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
}))

import { SquarePaymentProvider } from '../../../src/providers/square/payment'
import type { SquareConfig } from '../../../src/config/site.config'

const testConfig: SquareConfig = {
  accessToken: 'test-token',
  environment: 'sandbox',
  locationId: 'loc-123',
  applicationId: 'app-456',
}

describe('SquarePaymentProvider — refund + cancel', () => {
  let provider: SquarePaymentProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SquarePaymentProvider(testConfig)
  })

  describe('createOrder returns version (LR-2)', () => {
    it('populates version from order.version', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-1',
          state: 'OPEN',
          version: 7,
          totalMoney: { amount: BigInt(5000), currency: 'USD' },
        },
      })

      const result = await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [{ name: 'Kit', quantity: 1, pricePerUnit: 5000 }],
      })

      expect(result.version).toBe(7)
    })
  })

  describe('refundPayment', () => {
    it('calls Square refunds.refundPayment with BigInt amount + idempotency key and unwraps refund', async () => {
      mockRefundsRefundPayment.mockResolvedValue({
        refund: {
          id: 'ref-1',
          paymentId: 'pay-1',
          status: 'PENDING',
          amountMoney: { amount: BigInt(5000), currency: 'USD' },
        },
      })

      const result = await provider.refundPayment({
        paymentId: 'pay-1',
        amountCents: 5000,
        idempotencyKey: 'idem-1',
        reason: 'deposit returned',
      })

      expect(mockRefundsRefundPayment).toHaveBeenCalledWith({
        idempotencyKey: 'idem-1',
        paymentId: 'pay-1',
        amountMoney: { amount: BigInt(5000), currency: 'USD' },
        reason: 'deposit returned',
      })

      expect(result).toEqual({
        id: 'ref-1',
        paymentId: 'pay-1',
        amountCents: 5000,
        status: 'PENDING',
      })
    })

    it('omits reason when not provided', async () => {
      mockRefundsRefundPayment.mockResolvedValue({
        refund: {
          id: 'ref-2',
          paymentId: 'pay-2',
          status: 'COMPLETED',
          amountMoney: { amount: BigInt(2500), currency: 'USD' },
        },
      })

      await provider.refundPayment({
        paymentId: 'pay-2',
        amountCents: 2500,
        idempotencyKey: 'idem-2',
      })

      const callArg = mockRefundsRefundPayment.mock.calls[0][0]
      expect(callArg.reason).toBeUndefined()
      expect(callArg).toEqual({
        idempotencyKey: 'idem-2',
        paymentId: 'pay-2',
        amountMoney: { amount: BigInt(2500), currency: 'USD' },
        reason: undefined,
      })
    })
  })

  describe('cancelOrder', () => {
    it('calls orders.update to set state CANCELED with the order version', async () => {
      mockOrdersUpdate.mockResolvedValue({ order: { id: 'order-1', state: 'CANCELED', version: 4 } })

      await provider.cancelOrder({ orderId: 'order-1', version: 3, locationId: 'loc-123' })

      expect(mockOrdersUpdate).toHaveBeenCalledWith({
        orderId: 'order-1',
        order: {
          locationId: 'loc-123',
          version: 3,
          state: 'CANCELED',
        },
      })
    })

    it('resolves void', async () => {
      mockOrdersUpdate.mockResolvedValue({ order: { id: 'order-2', state: 'CANCELED', version: 2 } })

      const result = await provider.cancelOrder({ orderId: 'order-2', version: 1, locationId: 'loc-123' })

      expect(result).toBeUndefined()
    })
  })
})
