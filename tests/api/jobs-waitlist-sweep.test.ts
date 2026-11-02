import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sweep = vi.hoisted(() => vi.fn(async (_now: Date) => ({ classes: 1, added: 1, declined: 0, closed: 0, unknown: 0, left: 0 })))
vi.mock('@lib/classes/waitlist-runner', () => ({ sweepWaitlists: sweep }))
const owner = vi.hoisted(() => ({ signedIn: false }))
vi.mock('@lib/admin-auth', () => ({ adminAuthorized: () => owner.signedIn }))

import { POST, waitlistSweepJobKey } from '@pages/api/jobs/waitlist-sweep.json'

const SECRET = 'test-secret'
const call = (key: string | null) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/waitlist-sweep.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {}, body: '{}' }) } as any)

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  owner.signedIn = false
  sweep.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/jobs/waitlist-sweep.json', () => {
  it('runs the sweep with the scheduled function\'s key', async () => {
    const res = await call(waitlistSweepJobKey(SECRET))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ classes: 1, added: 1 })
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('a wrong key, no key, or a key from another secret → 403 and nothing runs', async () => {
    for (const key of ['nope', null, waitlistSweepJobKey('other-secret'), waitlistSweepJobKey(SECRET).slice(1)]) {
      const res = await call(key)
      expect(res.status).toBe(403)
    }
    expect(sweep).not.toHaveBeenCalled()
  })

  it('no secret set → nobody gets in with a key (fails closed)', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', '')
    expect((await call(waitlistSweepJobKey(''))).status).toBe(403)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('an owner signed in to /admin may run it now', async () => {
    owner.signedIn = true
    expect((await call(null)).status).toBe(200)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('a sweep that throws answers 500 (the scheduled function logs it)', async () => {
    sweep.mockRejectedValueOnce(new Error('store down'))
    expect((await call(waitlistSweepJobKey(SECRET))).status).toBe(500)
  })
})
