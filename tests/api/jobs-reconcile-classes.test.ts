import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRun = vi.fn()
const unfinished = vi.fn(async () => false)
vi.mock('@lib/classes/square-events', () => ({ reconcileClasses: (...a: any[]) => mockRun(...a), reconcileUnfinished: () => unfinished() }))

import { POST, reconcileClassesJobKey, CALL_BUDGET_MS } from '@pages/api/jobs/reconcile-classes.json'
import { adminCookie } from '@lib/admin-auth'

const SECRET = 'test-secret'
const call = (key: string | null = reconcileClassesJobKey(SECRET)) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/reconcile-classes.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {}, body: '{}' }) } as any)
/** An owner's manual run: POST ?force=1 with the /admin cookie (or none). */
const ownerRun = (opts: { cookie?: boolean; force?: boolean } = {}) => {
  const url = `https://ourhometownstudio.com/api/jobs/reconcile-classes.json${opts.force === false ? '' : '?force=1'}`
  const headers: Record<string, string> = opts.cookie === false ? {} : { cookie: adminCookie().split(';')[0] }
  const request = new Request(url, { method: 'POST', headers, body: '{}' })
  return POST({ request, url: new URL(url) } as any)
}

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  mockRun.mockResolvedValue({ orders: 4, recorded: 1, unmatched: 0, errors: 0, more: false })
  unfinished.mockResolvedValue(false)
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
  it('an owner can run it now with ?force=1, whatever the hour', async () => {
    vi.setSystemTime(new Date('2026-10-19T17:30:00.000Z')) // 12:30 PM in the studio
    const res = await ownerRun()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ recorded: 1 })
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('?force=1 needs the owner sign-in; the owner cookie alone without force waits for 3 AM', async () => {
    vi.setSystemTime(new Date('2026-10-19T17:30:00.000Z'))
    expect((await ownerRun({ cookie: false })).status).toBe(403)
    expect((await (await ownerRun({ force: false })).json()).data.skipped).toMatch(/not 3 AM/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('every call works within a time budget well under the web function limit', async () => {
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
    await call()
    expect(CALL_BUDGET_MS).toBeLessThanOrEqual(6_000)
    expect(mockRun.mock.calls[0][1]).toEqual({ budgetMs: CALL_BUDGET_MS })
    vi.setSystemTime(new Date('2026-10-19T17:30:00.000Z'))
    await ownerRun()
    expect(mockRun.mock.calls[1][1]).toEqual({ budgetMs: CALL_BUDGET_MS })
  })

  it('says there is more to do; the job carries an unfinished pass on at any hour (but never starts one outside 3 AM)', async () => {
    mockRun.mockResolvedValue({ orders: 40, recorded: 0, unmatched: 0, errors: 0, more: true })
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
    expect((await (await call()).json()).data.more).toBe(true)
    vi.setSystemTime(new Date('2026-10-19T10:00:00.000Z')) // 5 AM in the studio
    unfinished.mockResolvedValue(true)
    expect((await (await call()).json()).data.more).toBe(true)
    expect(mockRun).toHaveBeenCalledTimes(2)
    unfinished.mockResolvedValue(false)
    expect((await (await call()).json()).data.skipped).toMatch(/not 3 AM/)
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('an owner without ?force=1 never carries a pass on (only the job and ?force=1 run it)', async () => {
    vi.setSystemTime(new Date('2026-10-19T17:30:00.000Z'))
    unfinished.mockResolvedValue(true)
    expect((await (await ownerRun({ force: false })).json()).data.skipped).toMatch(/not 3 AM/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('a failed run answers 500', async () => {
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'))
    mockRun.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
