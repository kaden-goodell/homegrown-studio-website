// tests/api/shop-silhouette-order.test.ts
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
const { ids, sil } = vi.hoisted(() => ({ ids: { itemId: 'item', variationId: 'var', shippingVariationId: 'ship-var' }, sil: { itemId: 'sil-item', variationId: 'sil-var' } }))
vi.mock('@config/shop.config', async (orig) => {
  const real: any = await orig()
  return { ...real, shopConfig: { ...real.shopConfig, magnets: { ...real.shopConfig.magnets, square: ids }, silhouettes: { ...real.shopConfig.silhouettes, square: sil } } }
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
import { savePhoto, listOrders } from '@lib/magnet-orders'

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
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'sil-order-'))
  vi.clearAllMocks()
  bypass.mockReturnValue(false)
  photo = await savePhoto(DRAFT, Buffer.from([0xff, 0xd8, 0xff, 1]))
  findOrCreate.mockResolvedValue({ id: 'cust' })
  findOrderPayment.mockResolvedValue(null)
  createOrder.mockImplementation(async ({ lineItems }: any) => ({ id: 'sq-order', version: 1, lineItems, discounts: [], currency: 'USD', status: 'open', totalAmount: squareTotal(lineItems) }))
  processPayment.mockResolvedValue({ id: 'pay', orderId: 'sq-order', amount: 0, status: 'completed', receiptUrl: 'https://r' })
})

const good = () => ({
  product: 'silhouettes', draftId: DRAFT, attemptId: ATTEMPT, sets: 2, magnets: [photo, photo], delivery: 'pickup',
  contact: { name: 'Test Person', email: 'kaden+silhouette@ourhometownstudio.com', phone: '(402) 980-2907' }, paymentToken: 'tok',
})

describe('POST /api/shop/magnet-order.json, framed silhouettes', () => {
  it('charges $25 each with the silhouette line taxed and saves a silhouette order', async () => {
    const res = await call(good())
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems).toEqual([
      { catalogObjectId: 'sil-var', name: 'Framed Silhouette', quantity: 2, pricePerUnit: 2500, tax: { catalogObjectId: 'XKZ3OIRJ3SPPO4TO64UUDFA4', percent: 9 } },
    ])
    expect(processPayment.mock.calls[0][0].amount).toBe(5450)
    const [saved] = await listOrders()
    expect(saved).toMatchObject({ product: 'silhouettes', sets: 2, amounts: { subtotalCents: 5000, taxCents: 450, totalCents: 5450 } })
    expect(saved.magnets).toHaveLength(2)
  })
  it('ships for an untaxed $6', async () => {
    const res = await call({ ...good(), sets: 1, magnets: [photo], delivery: 'ship', address: '123 Main St, Madison, AL 35758' })
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems[1]).toEqual({ catalogObjectId: 'ship-var', name: 'Shipping', quantity: 1, pricePerUnit: 600 })
    expect(processPayment.mock.calls[0][0].amount).toBe(3325)
  })
  it('needs one finished silhouette per item, and at most 6', async () => {
    expect((await call({ ...good(), magnets: [photo] })).status).toBe(400)
    expect((await call({ ...good(), sets: 7, magnets: Array(7).fill(photo) })).status).toBe(400)
    expect((await call({ ...good(), sets: 0, magnets: [] })).status).toBe(400)
    expect(createOrder).not.toHaveBeenCalled()
  })
  it('refuses until the Square item exists', async () => {
    sil.variationId = ''
    try {
      const res = await call(good())
      expect(res.status).toBe(503)
      expect(createOrder).not.toHaveBeenCalled()
    } finally { sil.variationId = 'sil-var' }
  })
  it('still saves a simulated order on previews', async () => {
    bypass.mockReturnValue(true)
    sil.variationId = ''
    try {
      expect((await call(good())).status).toBe(200)
      const [saved] = await listOrders({ includeSimulated: true })
      expect(saved).toMatchObject({ product: 'silhouettes', simulated: true })
    } finally { sil.variationId = 'sil-var' }
  })
})
