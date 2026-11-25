import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Kaden, 24 Nov 2026: every tick saves Square's class list before the robot customer looks at it. */
const order: string[] = []
const mockRefresh = vi.fn()
vi.mock('@lib/workshop-snapshot', () => ({ refreshWorkshopSnapshot: (...a: any[]) => mockRefresh(...a) }))
vi.mock('@lib/booking-alarms', () => ({ sweepIncidents: async () => { order.push('sweep'); return 0 } }))
vi.mock('@lib/watchdog', () => ({
  liveChecks: () => [],
  runWatchdog: async () => { order.push('watchdog'); return { ok: true, failed: [], strikes: 0, texted: false } },
}))

import { POST, alertsTickJobKey } from '@pages/api/jobs/alerts-tick.json'

const tick = () =>
  (POST as any)({ request: new Request('https://x.test/api/jobs/alerts-tick.json', { method: 'POST', headers: { 'x-job-key': alertsTickJobKey('s3cret') } }) })

beforeEach(() => {
  order.length = 0
  mockRefresh.mockReset()
  mockRefresh.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('refresh'); return { saved: true, count: 3 } })
  process.env.LOOKUP_SIGNING_SECRET = 's3cret'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T20:00:30Z')) // a watchdog turn
})
afterEach(() => {
  delete process.env.LOOKUP_SIGNING_SECRET
  vi.useRealTimers()
})

describe('POST /api/jobs/alerts-tick.json — the saved class list', () => {
  it('refreshes the class list before the watchdog runs, with a generous timeout', async () => {
    const res = await tick()
    expect(res.status).toBe(200)
    expect(order.indexOf('refresh')).toBeLessThan(order.indexOf('watchdog'))
    expect(mockRefresh.mock.calls[0][0]).toBeGreaterThanOrEqual(20_000)
    expect((await res.json()).data.snapshot).toEqual({ saved: true, count: 3 })
  })

  it('refreshes every 10 minutes: on :10, not on :05 (between watchdog turns)', async () => {
    vi.setSystemTime(new Date('2026-11-24T20:10:30Z'))
    await tick()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    mockRefresh.mockClear()
    vi.setSystemTime(new Date('2026-11-24T20:05:30Z'))
    const res = await tick()
    expect(mockRefresh).not.toHaveBeenCalled()
    const data = (await res.json()).data
    expect(data.watchdog).toBeNull()
    expect(data.snapshot).toBeNull()
  })

  it('a refresh that throws never fails the tick; the watchdog still runs', async () => {
    mockRefresh.mockRejectedValue(new Error('boom'))
    const res = await tick()
    expect(res.status).toBe(200)
    expect(order).toContain('watchdog')
    expect((await res.json()).data.snapshot).toMatchObject({ saved: false, error: 'boom' })
  })

  it('no key, no refresh', async () => {
    const res = await (POST as any)({ request: new Request('https://x.test/api/jobs/alerts-tick.json', { method: 'POST' }) })
    expect(res.status).toBe(401)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
