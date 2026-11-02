import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/class-prices'
import { classPricesJobKey } from '../../src/pages/api/jobs/class-prices.json'

describe('netlify/functions/class-prices (D4)', () => {
  it('runs hourly at :01 (an early-bird ending at Chicago midnight is off the register a minute later, CDT or CST)', () => {
    expect(config.schedule).toBe('1 * * * *')
  })
  it('knocks on the site with the job key the site expects', async () => {
    const ask = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await run('https://ourhometownstudio.com/', 's', ask as any)).toEqual({ ok: true, reason: 'done' })
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/class-prices.json')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 's').update('job:class-prices').digest('hex'))
    expect(init.headers['x-job-key']).toBe(classPricesJobKey('s'))
  })
  it('reports a refusal or no answer', async () => {
    expect(await run('https://x.test', 's', (async () => new Response('', { status: 500 })) as any)).toEqual({ ok: false, reason: 'site answered 500' })
    expect((await run(undefined, 's')).reason).toBe('not configured')
  })
})
