// tests/lib/magnet-orders.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  savePhoto, getPhoto, draftPhotoIds, saveOrder, getOrder, listOrders, setOrderStatus, cleanup,
  isDraftId, newReference, orderForDraft, markPending, clearPending, markEmailed,
} from '@lib/magnet-orders'
import { STATUSES, type MagnetOrder } from '@lib/magnet-status'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

beforeEach(() => { process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-')) })

function order(over: Partial<MagnetOrder> = {}): MagnetOrder {
  return {
    id: newReference(), createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: DRAFT,
    sets: 1, magnets: [], delivery: 'pickup', address: null,
    contact: { name: 'Test Person', email: 'kaden+magnets@ourhometownstudio.com', phone: '4029802907' },
    amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 },
    squareOrderId: 'sq', paymentId: 'pay', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {}, ...over,
  }
}

describe('photos', () => {
  it('saves and reads a photo under its draft', async () => {
    const id = await savePhoto(DRAFT, jpeg, new Date('2026-11-09T12:00:00Z'))
    expect(await getPhoto(DRAFT, id)).toEqual(jpeg)
    expect(await draftPhotoIds(DRAFT)).toEqual([id])
  })
  it('only accepts uuid draft ids', () => {
    expect(isDraftId(DRAFT)).toBe(true)
    expect(isDraftId('../x')).toBe(false)
  })
})

describe('orders', () => {
  it('saves, lists newest first, finds by draft, and hides simulated unless asked', async () => {
    const a = order({ createdAt: '2026-11-08T12:00:00.000Z', draftId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' })
    const b = order({ createdAt: '2026-11-09T12:00:00.000Z' })
    const sim = order({ createdAt: '2026-11-10T12:00:00.000Z', simulated: true, draftId: '6fa459ea-ee8a-3ca4-894e-db77e160355e' })
    await saveOrder(a); await saveOrder(b); await saveOrder(sim)
    expect((await listOrders()).map((o) => o.id)).toEqual([b.id, a.id])
    expect((await listOrders({ includeSimulated: true })).map((o) => o.id)).toEqual([sim.id, b.id, a.id])
    expect(await getOrder(a.id)).toEqual(a)
    expect((await orderForDraft(DRAFT))?.id).toBe(b.id)
  })
  it('skips a corrupt record instead of failing the list', async () => {
    await saveOrder(order())
    const { makeKvStore } = await import('@lib/blob-store')
    await makeKvStore('magnet-orders', 'magnet-orders').set('order-M-BROKEN', '{nope')
    expect(await listOrders()).toHaveLength(1)
  })
  it('refuses ready for a shipped order and shipped for a pickup order', async () => {
    const p = order(); const s = order({ delivery: 'ship', address: '1 Main St, Madison AL', draftId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' })
    await saveOrder(p); await saveOrder(s)
    expect(await setOrderStatus(p.id, 'shipped')).toBe('wrong_delivery')
    expect(await setOrderStatus(s.id, 'ready')).toBe('wrong_delivery')
  })
  it('same status is no change; done stamps doneAt; moving back clears it', async () => {
    const p = order(); await saveOrder(p)
    expect(await setOrderStatus(p.id, 'new')).toMatchObject({ changed: false })
    const done = await setOrderStatus(p.id, 'picked_up', new Date('2026-11-10T00:00:00Z'))
    expect(typeof done === 'object' && done.order.doneAt).toBe('2026-11-10T00:00:00.000Z')
    const back = await setOrderStatus(p.id, 'made')
    expect(typeof back === 'object' && back.order.doneAt).toBeNull()
  })
  it('will not move off a done state once photos are deleted', async () => {
    const p = order({ status: 'picked_up', doneAt: '2026-10-01T00:00:00.000Z', photosDeletedAt: '2026-11-01T00:00:00.000Z' })
    await saveOrder(p)
    expect(await setOrderStatus(p.id, 'made')).toBe('photos_deleted')
  })
  it('records an email once', async () => {
    const p = order(); await saveOrder(p)
    expect(await markEmailed(p.id, 'ready', new Date('2026-11-10T00:00:00Z'))).toBe(true)
    expect(await markEmailed(p.id, 'ready')).toBe(false)
  })
  it('lists the statuses in order', () => {
    expect(STATUSES).toEqual(['new', 'made', 'ready', 'shipped', 'picked_up', 'cancelled'])
  })
})

describe('cleanup', () => {
  const NOW = new Date('2026-11-09T12:00:00Z')
  it('deletes abandoned drafts after 24h and finished orders photos after 30 days', async () => {
    const old = new Date('2026-11-01T00:00:00Z')
    const orphan = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    await savePhoto(orphan, jpeg, old)
    const kept = await savePhoto(DRAFT, jpeg, old)
    const o = order({ magnets: [kept], status: 'picked_up', doneAt: '2026-10-01T00:00:00.000Z' })
    await saveOrder(o)
    const fresh = '6fa459ea-ee8a-3ca4-894e-db77e160355e'
    await savePhoto(fresh, jpeg, new Date('2026-11-09T11:00:00Z'))

    expect(await cleanup(NOW, { dryRun: true })).toMatchObject({ draftsDeleted: 1, ordersCleared: 1, dryRun: true })
    expect(await draftPhotoIds(orphan)).toHaveLength(1)

    expect(await cleanup(NOW)).toMatchObject({ draftsDeleted: 1, ordersCleared: 1 })
    expect(await draftPhotoIds(orphan)).toEqual([])
    expect(await draftPhotoIds(DRAFT)).toEqual([])
    expect((await getOrder(o.id))?.photosDeletedAt).toBe('2026-11-09T12:00:00.000Z')
    expect(await draftPhotoIds(fresh)).toHaveLength(1)
  })
  it('keeps a draft with a pending marker (paid but not saved)', async () => {
    const d = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    await savePhoto(d, jpeg, new Date('2026-11-01T00:00:00Z'))
    await markPending(d, { attemptId: 'a', email: 'kaden+m@ourhometownstudio.com' }, new Date('2026-11-01T00:00:00Z'))
    await cleanup(NOW)
    expect(await draftPhotoIds(d)).toHaveLength(1)
    await clearPending(d)
    await cleanup(NOW)
    expect(await draftPhotoIds(d)).toEqual([])
  })
})
