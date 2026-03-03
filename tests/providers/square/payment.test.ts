import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOrdersCreate = vi.fn()
const mockPaymentsCreate = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    orders = { create: mockOrdersCreate }
    payments = { create: mockPaymentsCreate }
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

describe('SquarePaymentProvider', () => {
  let provider: SquarePaymentProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SquarePaymentProvider(testConfig)
  })

  describe('createOrder', () => {
    it('maps line items to Square format with BigInt amounts', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-1',
          state: 'OPEN',
          totalMoney: { amount: BigInt(5000), currency: 'USD' },
        },
      })

      const result = await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [
          { name: 'Pottery Class', quantity: 2, pricePerUnit: 2500 },
        ],
      })

      expect(mockOrdersCreate).toHaveBeenCalledWith({
        order: {
          locationId: 'loc-123',
          customerId: 'cust-1',
          lineItems: [
            {
              name: 'Pottery Class',
              quantity: '2',
              basePriceMoney: { amount: BigInt(2500), currency: 'USD' },
            },
          ],
          discounts: undefined,
        },
      })

      expect(result).toEqual({
        id: 'order-1',
        lineItems: [{ name: 'Pottery Class', quantity: 2, pricePerUnit: 2500 }],
        discounts: [],
        totalAmount: 5000,
        currency: 'USD',
        status: 'open',
      })
    })

    it('maps line items with catalogObjectId', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-2',
          state: 'OPEN',
          totalMoney: { amount: BigInt(3000), currency: 'USD' },
        },
      })

      await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [
          { catalogObjectId: 'cat-1', name: 'Ignored Name', quantity: 1, pricePerUnit: 3000 },
        ],
      })

      const callArg = mockOrdersCreate.mock.calls[0][0]
      const squareItem = callArg.order.lineItems[0]
      expect(squareItem.catalogObjectId).toBe('cat-1')
      expect(squareItem.name).toBeUndefined()
    })

    it('maps percent discounts correctly', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-3',
          state: 'OPEN',
          totalMoney: { amount: BigInt(4500), currency: 'USD' },
        },
      })

      await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [{ name: 'Class', quantity: 1, pricePerUnit: 5000 }],
        discounts: [{ name: '10% Off', type: 'percent', value: 10, scope: 'order' }],
      })

      const callArg = mockOrdersCreate.mock.calls[0][0]
      expect(callArg.order.discounts).toEqual([
        {
          name: '10% Off',
          discountType: 'FIXED_PERCENTAGE',
          percentage: '10',
          scope: 'ORDER',
        },
      ])
    })

    it('maps fixed discounts correctly', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-4',
          state: 'OPEN',
          totalMoney: { amount: BigInt(4000), currency: 'USD' },
        },
      })

      await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [{ name: 'Class', quantity: 1, pricePerUnit: 5000 }],
        discounts: [{ name: '$10 Off', type: 'fixed', value: 1000, scope: 'line_item' }],
      })

      const callArg = mockOrdersCreate.mock.calls[0][0]
      expect(callArg.order.discounts).toEqual([
        {
          name: '$10 Off',
          discountType: 'FIXED_AMOUNT',
          amountMoney: { amount: BigInt(1000), currency: 'USD' },
          scope: 'LINE_ITEM',
        },
      ])
    })

    it('maps order status correctly', async () => {
      mockOrdersCreate.mockResolvedValue({
        order: {
          id: 'order-5',
          state: 'COMPLETED',
          totalMoney: { amount: BigInt(5000), currency: 'USD' },
        },
      })

      const result = await provider.createOrder({
        locationId: 'loc-123',
        customerId: 'cust-1',
        lineItems: [{ name: 'Class', quantity: 1, pricePerUnit: 5000 }],
      })

      expect(result.status).toBe('completed')
    })
  })

  describe('processPayment', () => {
    it('processes a successful payment', async () => {
      mockPaymentsCreate.mockResolvedValue({
        payment: {
          id: 'pay-1',
          status: 'COMPLETED',
          receiptUrl: 'https://squareup.com/receipt/1',
        },
      })

      const result = await provider.processPayment({
        orderId: 'order-1',
        paymentToken: 'cnon:card-nonce',
        amount: 5000,
        currency: 'USD',
      })

      expect(mockPaymentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'cnon:card-nonce',
          amountMoney: { amount: BigInt(5000), currency: 'USD' },
          orderId: 'order-1',
        })
      )

      expect(result).toEqual({
        id: 'pay-1',
        orderId: 'order-1',
        amount: 5000,
        status: 'completed',
        receiptUrl: 'https://squareup.com/receipt/1',
      })
    })

    it('processes a failed payment', async () => {
      mockPaymentsCreate.mockResolvedValue({
        payment: {
          id: 'pay-2',
          status: 'FAILED',
        },
      })

      const result = await provider.processPayment({
        orderId: 'order-2',
        paymentToken: 'cnon:bad-nonce',
        amount: 3000,
        currency: 'USD',
      })

      expect(result.status).toBe('failed')
      expect(result.receiptUrl).toBeUndefined()
    })

    it('maps unknown status to pending', async () => {
      mockPaymentsCreate.mockResolvedValue({
        payment: {
          id: 'pay-3',
          status: 'APPROVED',
        },
      })

      const result = await provider.processPayment({
        orderId: 'order-3',
        paymentToken: 'cnon:nonce',
        amount: 2000,
        currency: 'USD',
      })

      expect(result.status).toBe('pending')
    })
  })

  describe('getClientConfig', () => {
    it('returns correct client configuration', () => {
      const config = provider.getClientConfig()

      expect(config).toEqual({
        appId: 'app-456',
        locationId: 'loc-123',
        environment: 'sandbox',
      })
    })
  })
})
