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

describe('site down goes through Pushover first (Kaden, 17 Nov 2026)', () => {
  it('"SITE DOWN" is a Pushover emergency; "Fixed" a normal note; no keys → not sent', async () => {
    const { pushKaden } = await import('../../netlify/functions/alerts-tick')
    const seen: URLSearchParams[] = []
    const ask = (async (_u: string, init: RequestInit) => { seen.push(new URLSearchParams(String(init.body))); return { ok: true } as Response }) as typeof fetch
    expect(await pushKaden('SITE DOWN: x', true, ask)).toBe(false)
    process.env.PUSHOVER_APP_TOKEN = 't'; process.env.PUSHOVER_USER_KEY = 'u'
    try {
      expect(await pushKaden('SITE DOWN: x', true, ask)).toBe(true)
      expect(await pushKaden('Fixed: y', false, ask)).toBe(true)
      expect([seen[0].get('priority'), seen[0].get('retry'), seen[0].get('expire')]).toEqual(['2', '300', '3600'])
      expect([seen[1].get('priority'), seen[1].has('retry')]).toEqual(['0', false])
    } finally {
      delete process.env.PUSHOVER_APP_TOKEN; delete process.env.PUSHOVER_USER_KEY
    }
  })
})
