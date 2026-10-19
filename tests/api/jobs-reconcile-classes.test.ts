import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRun = vi.fn()
vi.mock('@lib/classes/square-events', () => ({ reconcileClasses: (...a: any[]) => mockRun(...a) }))

import { POST, reconcileClassesJobKey } from '@pages/api/jobs/reconcile-classes.json'

const SECRET = 'test-secret'
const call = (key: string | null = reconcileClassesJobKey(SECRET)) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/reconcile-classes.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {}, body: '{}' }) } as any)

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  mockRun.mockResolvedValue({ orders: 4, recorded: 1, unmatched: 0, errors: 0 })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('POST /api/jobs/reconcile-classes.json', () => {
  it('needs the job key', async () => {
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
    expect((await call(null)).status).toBe(403)
    expect((await call('nope')).status).toBe(403)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('runs at 3 AM studio time in daylight time (08:00 UTC), not at 4 AM (09:00 UTC)', async () => {
    vi.setSystemTime(new Date('2026-10-19T08:00:20.000Z'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ recorded: 1 })
    vi.setSystemTime(new Date('2026-10-19T09:00:20.000Z'))
    expect((await (await call()).json()).data.skipped).toMatch(/not 3 AM/)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
  it('runs at 3 AM studio time in standard time (09:00 UTC)', async () => {
    vi.setSystemTime(new Date('2026-12-05T08:00:20.000Z'))
    await call()
    expect(mockRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-12-05T09:00:20.000Z'))
    await call()
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
  it('a failed run answers 500', async () => {
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
    mockRun.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
