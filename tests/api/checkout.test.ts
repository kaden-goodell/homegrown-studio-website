import { describe, it, expect } from 'vitest'
import { POST as createOrder } from '@pages/api/checkout/create-order.json'
import { POST as processPayment } from '@pages/api/checkout/process-payment.json'
import { POST as validateCoupon } from '@pages/api/checkout/validate-coupon.json'
import { GET as clientConfig } from '@pages/api/checkout/client-config.json'

function createMockContext(options: { method?: string; body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/checkout/create-order.json')
  const request = new Request(url, {
    method: options.method || 'GET',
    ...(options.body ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
    } : {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('checkout API routes', () => {
  it('POST /create-order.json returns order with totalAmount', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/checkout/create-order.json',
      body: {
        locationId: 'loc-1',
        customerId: 'cust-1',
        lineItems: [{ name: 'Candle Workshop', quantity: 2, pricePerUnit: 3500 }],
      },
    })
    const response = await createOrder(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.totalAmount).toBe(7000)
  })

  it('POST /process-payment.json returns completed payment', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/checkout/process-payment.json',
      body: {
        orderId: 'order-1',
        paymentToken: 'cnon:card-nonce-ok',
        amount: 7000,
        currency: 'USD',
      },
    })
    const response = await processPayment(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.status).toBe('completed')
  })

  it('POST /process-payment.json with FAIL token returns failed payment', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/checkout/process-payment.json',
      body: {
        orderId: 'order-1',
        paymentToken: 'FAIL',
        amount: 7000,
        currency: 'USD',
      },
    })
    const response = await processPayment(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.status).toBe('failed')
  })

  it('POST /validate-coupon.json with WELCOME10 returns valid=true', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/checkout/validate-coupon.json',
      body: { code: 'WELCOME10' },
    })
    const response = await validateCoupon(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.valid).toBe(true)
  })

  it('POST /validate-coupon.json with FAKECODE returns valid=false', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/checkout/validate-coupon.json',
      body: { code: 'FAKECODE' },
    })
    const response = await validateCoupon(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.valid).toBe(false)
  })

  it('GET /client-config.json returns appId and locationId', async () => {
    const ctx = createMockContext({
      url: 'http://localhost/api/checkout/client-config.json',
    })
    const response = await clientConfig(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.appId).toBeDefined()
    expect(body.data.locationId).toBeDefined()
  })
})
