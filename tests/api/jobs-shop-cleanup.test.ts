// tests/api/jobs-shop-cleanup.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn().mockResolvedValue({ draftsDeleted: 2, ordersCleared: 1, dryRun: false, drafts: [], orders: [] }) }))
vi.mock('@lib/magnet-orders', () => ({ cleanup }))
import { POST, shopCleanupJobKey } from '../../src/pages/api/jobs/shop-cleanup.json'

const call = (key?: string, q = '') => POST({ request: new Request(`https://x.test/api/jobs/shop-cleanup.json${q}`, { method: 'POST', headers: key ? { 'x-job-key': key } : {} }) } as any)
afterEach(() => vi.unstubAllEnvs())

describe('shop cleanup job', () => {
  it('refuses without the job key', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    expect((await call()).status).toBe(403)
    expect((await call('wrong')).status).toBe(403)
  })
  it('runs with the key', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    const res = await call(shopCleanupJobKey('s3cret'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ draftsDeleted: 2, ordersCleared: 1 })
    expect(cleanup).toHaveBeenLastCalledWith(expect.any(Date), { dryRun: false })
  })
  it('passes dryRun through', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    await call(shopCleanupJobKey('s3cret'), '?dryRun=1')
    expect(cleanup).toHaveBeenLastCalledWith(expect.any(Date), { dryRun: true })
  })
})
