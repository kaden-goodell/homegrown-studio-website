// tests/api/admin-magnet-orders.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { statusEmail } = vi.hoisted(() => ({ statusEmail: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('@lib/magnet-emails', () => ({ sendMagnetStatusEmail: statusEmail }))
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => false }))
import { GET, POST } from '../../src/pages/api/admin/magnet-orders.json'
import { GET as PHOTO } from '../../src/pages/api/admin/magnet-photo'
import { adminCookie } from '@lib/admin-auth'
import { saveOrder, savePhoto, newReference, type MagnetOrder } from '@lib/magnet-orders'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const signedIn = () => adminCookie().split(';')[0]
const req = (url: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`https://x.test${url}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } })

let o: MagnetOrder
beforeEach(async () => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-admin-'))
  statusEmail.mockClear()
  const photo = await savePhoto(DRAFT, Buffer.from([0xff, 0xd8, 0xff, 7]))
  o = { id: newReference(), createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: DRAFT, sets: 1, magnets: Array(6).fill(photo),
    delivery: 'pickup', address: null, contact: { name: 'T', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
    amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 }, squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {} }
  await saveOrder(o)
})
afterEach(() => vi.unstubAllEnvs())

describe('admin magnet orders', () => {
  it('needs the owner sign-in', async () => {
    expect((await GET({ request: req('/api/admin/magnet-orders.json') } as any)).status).toBe(401)
    expect((await PHOTO({ request: req('/api/admin/magnet-photo'), url: new URL('https://x.test/api/admin/magnet-photo') } as any)).status).toBe(401)
  })
  it('lists orders', async () => {
    const res = await GET({ request: req('/api/admin/magnet-orders.json', { cookie: signedIn() }) } as any)
    expect((await res.json()).data.orders[0].id).toBe(o.id)
  })
  it('moves to ready and emails the customer', async () => {
    const res = await POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'ready' }) }) } as any)
    expect(res.status).toBe(200)
    expect((await res.json()).data.order.status).toBe('ready')
    expect(statusEmail).toHaveBeenCalledWith(expect.objectContaining({ id: o.id }), 'ready')
  })
  it('does not email twice for the same status', async () => {
    const post = () => POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'ready' }) }) } as any)
    await post(); await post()
    expect(statusEmail).toHaveBeenCalledTimes(1)
  })
  it('hides test orders on the live site', async () => {
    await saveOrder({ ...o, id: newReference(), simulated: true })
    const res = await GET({ request: req('/api/admin/magnet-orders.json', { cookie: signedIn() }) } as any)
    expect((await res.json()).data.orders).toHaveLength(1)
  })
  it('refuses shipped on a pickup order', async () => {
    const res = await POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'shipped' }) }) } as any)
    expect(res.status).toBe(400)
  })
  it('serves a photo to owners', async () => {
    const url = new URL(`https://x.test/api/admin/magnet-photo?draft=${DRAFT}&photo=${o.magnets[0]}`)
    const res = await PHOTO({ request: req(url.pathname + url.search, { cookie: signedIn() }), url } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
  })
})
