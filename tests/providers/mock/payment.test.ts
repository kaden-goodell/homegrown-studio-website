import { describe, it, expect } from 'vitest'
import { MockPaymentProvider } from '@providers/mock/payment'

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider()

  describe('createOrder', () => {
    it('returns order with correct line items and total', async () => {
      const order = await provider.createOrder({
        locationId: 'loc-1',
        customerId: 'cust-1',
        lineItems: [
          { name: 'Pottery Class', quantity: 2, pricePerUnit: 3500 },
          { name: 'Glazing Add-on', quantity: 1, pricePerUnit: 1500 },
        ],
      })

      expect(order.id).toBeDefined()
      expect(order.lineItems).toHaveLength(2)
      expect(order.totalAmount).toBe(2 * 3500 + 1 * 1500) // 8500
      expect(order.status).toBe('open')
      expect(order.currency).toBe('USD')
      expect(order.discounts).toEqual([])
    })

    it('applies percent discount correctly', async () => {
      const order = await provider.createOrder({
        locationId: 'loc-1',
        customerId: 'cust-1',
        lineItems: [
          { name: 'Pottery Class', quantity: 2, pricePerUnit: 5000 },
        ],
        discounts: [
          { name: '10% Off', type: 'percent', value: 10, scope: 'order' },
        ],
      })

      // 2 * 5000 = 10000, minus 10% = 9000
      expect(order.totalAmount).toBe(9000)
      expect(order.discounts).toHaveLength(1)
    })

    it('applies fixed discount correctly', async () => {
      const order = await provider.createOrder({
        locationId: 'loc-1',
        customerId: 'cust-1',
        lineItems: [
          { name: 'Pottery Class', quantity: 1, pricePerUnit: 10000 },
        ],
        discounts: [
          { name: '$25 Off', type: 'fixed', value: 2500, scope: 'order' },
        ],
      })

      // 10000 - 2500 = 7500
      expect(order.totalAmount).toBe(7500)
    })
  })

  describe('processPayment', () => {
    it('returns completed payment with receiptUrl', async () => {
      const payment = await provider.processPayment({
        orderId: 'order-1',
        paymentToken: 'valid-token',
        amount: 8500,
        currency: 'USD',
      })

      expect(payment.id).toBeDefined()
      expect(payment.orderId).toBe('order-1')
      expect(payment.amount).toBe(8500)
      expect(payment.status).toBe('completed')
      expect(payment.receiptUrl).toContain('https://mock-receipt.example.com/')
    })

    it('returns failed payment when token is FAIL', async () => {
      const payment = await provider.processPayment({
        orderId: 'order-1',
        paymentToken: 'FAIL',
        amount: 8500,
        currency: 'USD',
      })

      expect(payment.status).toBe('failed')
      expect(payment.receiptUrl).toBeUndefined()
    })
  })

  describe('getClientConfig', () => {
    it('returns sandbox config', () => {
      const config = provider.getClientConfig()

      expect(config).toEqual({
        appId: 'mock-app-id',
        locationId: 'mock-location-id',
        environment: 'sandbox',
      })
    })
  })
})
