import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/daily-warnings'

const SITE = 'https://ourhometownstudio.com'
const SECRET = 'a-secret-only-the-site-holds'
const answer = (data: Record<string, unknown>, ok = true, status = 200) => ({ ok, status, json: async () => ({ data }) }) as any

describe('daily-warnings function', () => {
  it('runs once a day at 12:00 UTC (7 AM CDT, 6 AM CST)', () => {
    expect(config.schedule).toBe('0 12 * * *')
  })

  it('knocks on the site job with the key made from the secret', async () => {
    const ask = vi.fn().mockResolvedValue(answer({ count: 0, sent: false }))
    const outcome = await run(SITE, SECRET, ask)
    const [url, init] = ask.mock.calls[0]
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/daily-warnings.json')
    expect(init.method).toBe('POST')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', SECRET).update('job:daily-warnings').digest('hex'))
    expect(outcome).toEqual({ count: 0, sent: false, reason: 'nothing to report' })
  })

  it('makes the same key the site checks for', async () => {
    const { dailyWarningsJobKey } = await import('@pages/api/jobs/daily-warnings.json')
    const ask = vi.fn().mockResolvedValue(answer({ count: 0, sent: false }))
    await run(SITE, SECRET, ask)
    expect(ask.mock.calls[0][1].headers['x-job-key']).toBe(dailyWarningsJobKey(SECRET))
  })

  it('reports an email sent', async () => {
    expect(await run(SITE, SECRET, vi.fn().mockResolvedValue(answer({ count: 3, sent: true })))).toEqual({ count: 3, sent: true, reason: 'emailed' })
  })

  it('says why nothing happened', async () => {
    expect((await run(undefined, SECRET)).reason).toBe('not configured')
    expect((await run(SITE, SECRET, vi.fn().mockResolvedValue(answer({}, false, 503)))).reason).toBe('site answered 503')
    expect((await run(SITE, SECRET, vi.fn().mockRejectedValue(new Error('down')))).reason).toBe('site unreachable: down')
  })
})
