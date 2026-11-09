// tests/api/shop-magnet-order.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { bypass } = vi.hoisted(() => ({ bypass: vi.fn().mockReturnValue(false) }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: bypass }))
vi.mock('@lib/magnet-emails', () => ({
  sendMagnetConfirmation: vi.fn().mockResolvedValue({ sent: true }),
  sendMagnetOwnerNotice: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@lib/posthog-server', () => ({ reportBooking: vi.fn().mockResolvedValue(undefined) }))
const { ids } = vi.hoisted(() => ({ ids: { itemId: 'item', variationId: 'var', shippingVariationId: 'ship-var' } }))
vi.mock('@config/shop.config', async (orig) => {
  const real: any = await orig()
  return { ...real, shopConfig: { ...real.shopConfig, magnets: { ...real.shopConfig.magnets, square: ids } } }
})
const createOrder = vi.fn(); const processPayment = vi.fn(); const cancelOrder = vi.fn(); const findOrderPayment = vi.fn(); const findOrCreate = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      createOrder: (...a: any[]) => createOrder(...a), processPayment: (...a: any[]) => processPayment(...a),
      cancelOrder: (...a: any[]) => cancelOrder(...a), findOrderPayment: (...a: any[]) => findOrderPayment(...a),
    },
    customer: { findOrCreate: (...a: any[]) => findOrCreate(...a), appendNote: vi.fn().mockResolvedValue(undefined) },
  },
}))

import { POST } from '../../src/pages/api/shop/magnet-order.json'
import { savePhoto, listOrders, markPending } from '@lib/magnet-orders'
import { makeKvStore } from '@lib/blob-store'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ATTEMPT = '9b2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f'
let ip = 0
const call = (body: unknown) => POST({
  clientAddress: `203.0.113.${++ip}`,
  request: new Request('https://ourhometownstudio.com/api/shop/magnet-order.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
} as any)
/** What Square would total: taxed lines get their tax, others don't (T9a). */
const squareTotal = (lineItems: any[]) => lineItems.reduce((t, l) => t + l.quantity * l.pricePerUnit + (l.tax ? Math.round((l.quantity * l.pricePerUnit * l.tax.percent) / 100) : 0), 0)

let photo: string
beforeEach(async () => {
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-order-'))
  vi.clearAllMocks()
  bypass.mockReturnValue(false)
  photo = await savePhoto(DRAFT, Buffer.from([0xff, 0xd8, 0xff, 1]))
  findOrCreate.mockResolvedValue({ id: 'cust' })
  findOrderPayment.mockResolvedValue(null)
  createOrder.mockImplementation(async ({ lineItems }: any) => ({ id: 'sq-order', version: 1, lineItems, discounts: [], currency: 'USD', status: 'open', totalAmount: squareTotal(lineItems) }))
  processPayment.mockResolvedValue({ id: 'pay', orderId: 'sq-order', amount: 0, status: 'completed', receiptUrl: 'https://r' })
})

const good = () => ({
  draftId: DRAFT, attemptId: ATTEMPT, sets: 1, magnets: Array(6).fill(photo), delivery: 'pickup',
  contact: { name: 'Test Person', email: 'kaden+magnets@ourhometownstudio.com', phone: '(402) 980-2907' }, paymentToken: 'tok',
})
const pendingKeys = () => makeKvStore('magnet-orders', 'magnet-orders').list('pending-')

describe('POST /api/shop/magnet-order.json', () => {
  it('charges the server price with the magnet line taxed and saves the order', async () => {
    const res = await call(good())
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems).toEqual([
      { catalogObjectId: 'var', name: 'Photo Magnets – Set of 6', quantity: 1, pricePerUnit: 1800, tax: { catalogObjectId: 'XKZ3OIRJ3SPPO4TO64UUDFA4', percent: 9 } },
    ])
    expect(processPayment.mock.calls[0][0]).toMatchObject({ amount: 1962, idempotencyKey: `${ATTEMPT}:pay`, paymentToken: 'tok' })
    const [saved] = await listOrders()
    expect(saved).toMatchObject({ sets: 1, delivery: 'pickup', status: 'new', amounts: { totalCents: 1962 }, emailed: {} })
    expect(saved.magnets).toHaveLength(6)
    expect(await pendingKeys()).toEqual([])
  })
  it('adds an untaxed $6 shipping line and needs an address', async () => {
    expect((await call({ ...good(), delivery: 'ship' })).status).toBe(400)
    const res = await call({ ...good(), delivery: 'ship', address: '123 Main St, Madison, AL 35758' })
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems[1]).toEqual({ catalogObjectId: 'ship-var', name: 'Shipping', quantity: 1, pricePerUnit: 600 })
    expect(processPayment.mock.calls[0][0].amount).toBe(2562)
  })
  it('refuses the wrong number of photos, and a photo not in the draft', async () => {
    expect((await call({ ...good(), magnets: Array(5).fill(photo) })).status).toBe(400)
    expect((await call({ ...good(), magnets: [...Array(5).fill(photo), '1700000000000-deadbeef'] })).status).toBe(400)
  })
  it('cancels the Square order when the total does not match', async () => {
    createOrder.mockResolvedValueOnce({ id: 'sq-order', version: 1, totalAmount: 1800, lineItems: [], discounts: [], currency: 'USD', status: 'open' })
    expect((await call(good())).status).toBe(500)
    expect(cancelOrder).toHaveBeenCalled()
    expect(processPayment).not.toHaveBeenCalled()
  })
  it('says declined, cancels, and clears the marker on a failed payment', async () => {
    processPayment.mockResolvedValueOnce({ id: 'pay', orderId: 'sq-order', amount: 0, status: 'failed' })
    expect((await call(good())).status).toBe(402)
    expect(cancelOrder).toHaveBeenCalled()
    expect(await listOrders()).toEqual([])
    expect(await pendingKeys()).toEqual([])
  })
  it('says unknown (not "not charged") and keeps the photos when the charge outcome is unclear', async () => {
    processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await call(good())
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('unknown_outcome')
    expect(await pendingKeys()).toEqual([`pending-${DRAFT}`])
  })
  it('uses an earlier payment on retry instead of charging again', async () => {
    findOrderPayment.mockResolvedValueOnce({ id: 'pay-earlier', orderId: 'sq-order', amount: 1962, status: 'completed', receiptUrl: 'https://r' })
    expect((await call(good())).status).toBe(200)
    expect(processPayment).not.toHaveBeenCalled()
    expect((await listOrders())[0].paymentId).toBe('pay-earlier')
  })
  it('finds the earlier payment when a new attempt follows an unclear one, and does not charge again', async () => {
    await markPending(DRAFT, { attemptId: '1c2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f', email: 'kaden+magnets@ourhometownstudio.com', squareOrderId: 'sq-old' })
    findOrderPayment.mockImplementation(async (id: string) => (id === 'sq-old' ? { id: 'pay-earlier', orderId: 'sq-old', amount: 1962, status: 'completed', receiptUrl: 'https://r' } : null))
    const res = await call(good())
    expect(res.status).toBe(200)
    expect(createOrder).not.toHaveBeenCalled()
    expect(processPayment).not.toHaveBeenCalled()
    const [saved] = await listOrders()
    expect(saved).toMatchObject({ paymentId: 'pay-earlier', squareOrderId: 'sq-old' })
    expect(await pendingKeys()).toEqual([])
  })
  it('carries on normally when the earlier order was never paid', async () => {
    await markPending(DRAFT, { attemptId: '1c2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f', email: 'kaden+magnets@ourhometownstudio.com', squareOrderId: 'sq-old' })
    expect((await call(good())).status).toBe(200)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(processPayment).toHaveBeenCalledTimes(1)
  })
  it('answers with the existing order when the draft is already ordered', async () => {
    await call(good())
    const again = await call({ ...good(), attemptId: '1c2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f' })
    expect(again.status).toBe(200)
    expect((await again.json()).data.already).toBe(true)
    expect(processPayment).toHaveBeenCalledTimes(1)
  })
  it('simulates without Square ids on previews', async () => {
    bypass.mockReturnValue(true)
    Object.assign(ids, { variationId: '', shippingVariationId: '' })
    const res = await call({ ...good(), paymentToken: undefined })
    Object.assign(ids, { variationId: 'var', shippingVariationId: 'ship-var' })
    expect(res.status).toBe(200)
    expect(createOrder).not.toHaveBeenCalled()
    expect((await listOrders({ includeSimulated: true }))[0].simulated).toBe(true)
  })
})

describe('earlier payment lookup fails', () => {
  it('refuses with unknown_outcome instead of charging again', async () => {
    const { markPending } = await import('@lib/magnet-orders')
    await markPending(DRAFT, { attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'kaden+magnets@ourhometownstudio.com', squareOrderId: 'sq-old' })
    findOrderPayment.mockRejectedValueOnce(new Error('timeout'))
    const res = await call(good())
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('unknown_outcome')
    expect(createOrder).not.toHaveBeenCalled()
    expect(processPayment).not.toHaveBeenCalled()
  })
})
