import { describe, it, expect, vi } from 'vitest'
import { run, config, siteDownAction } from '../../netlify/functions/alerts-tick'
import { POST, alertsTickJobKey } from '../../src/pages/api/jobs/alerts-tick.json'

describe('alerts-tick function', () => {
  it('knocks every 5 minutes with the job key', async () => {
    expect(config.schedule).toBe('*/5 * * * *')
    const ask = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await run('https://ourhometownstudio.com/', 'secret', ask as any)
    expect(ask.mock.calls[0][0]).toBe('https://ourhometownstudio.com/api/jobs/alerts-tick.json')
    expect(ask.mock.calls[0][1].headers['x-job-key']).toBe(alertsTickJobKey('secret'))
  })

  it('texts straight from the function when the whole site is down: 2nd miss, then hourly, then Fixed', () => {
    expect(siteDownAction(0, false)).toEqual({ fails: 1, send: null })
    expect(siteDownAction(1, false)).toEqual({ fails: 2, send: 'down' })
    expect(siteDownAction(2, false).send).toBe(null)
    expect(siteDownAction(13, false).send).toBe('down') // 12 more misses ≈ an hour
    expect(siteDownAction(14, true)).toEqual({ fails: 0, send: 'fixed' })
    expect(siteDownAction(1, true)).toEqual({ fails: 0, send: null })
  })

  it('the job refuses anyone without the key', async () => {
    const res = await (POST as any)({ request: new Request('https://x.test/api/jobs/alerts-tick.json', { method: 'POST', headers: { 'x-job-key': 'nope' } }) })
    expect(res.status).toBe(401)
  })
})
