import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRun = vi.fn()
vi.mock('@lib/waiver-reminders', () => ({ runWaiverReminders: (...a: any[]) => mockRun(...a) }))

import { POST, waiverRemindersJobKey } from '@pages/api/jobs/waiver-reminders.json'

const SECRET = 'test-secret'
const call = (key: string | null = waiverRemindersJobKey(SECRET)) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/waiver-reminders.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {}, body: '{}' }) } as any)

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  mockRun.mockResolvedValue({ plan: { day: '2026-10-18', signed: [], alreadyReminded: [], unsure: [] }, sent: [], summarySent: true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('POST /api/jobs/waiver-reminders.json', () => {
  it('needs the job key', async () => {
    vi.setSystemTime(new Date('2026-10-18T14:00:00.000Z'))
    expect((await call(null)).status).toBe(403)
    expect((await call('nope')).status).toBe(403)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('runs at 9 AM studio time in daylight time (14:00 UTC)', async () => {
    vi.setSystemTime(new Date('2026-10-18T14:00:30.000Z'))
    expect((await call()).status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith(expect.any(Date), 'https://ourhometownstudio.com')
  })
  it('does nothing on the 15:00 UTC run in daylight time (10 AM)', async () => {
    vi.setSystemTime(new Date('2026-10-18T15:00:30.000Z'))
    expect((await (await call()).json()).data.skipped).toMatch(/not 9 AM/)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('runs at 9 AM studio time in standard time (15:00 UTC), not at 8 AM (14:00 UTC)', async () => {
    vi.setSystemTime(new Date('2026-12-05T14:00:30.000Z'))
    await call()
    expect(mockRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-12-05T15:00:30.000Z'))
    await call()
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
  it('a failed run answers 500', async () => {
    vi.setSystemTime(new Date('2026-10-18T14:00:00.000Z'))
    mockRun.mockRejectedValue(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
