import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/waitlist-sweep'
import { waitlistSweepJobKey } from '../../src/pages/api/jobs/waitlist-sweep.json'

describe('netlify/functions/waitlist-sweep (stage 4)', () => {
  it('runs every 10 minutes', () => {
    expect(config.schedule).toBe('*/10 * * * *')
  })
  it('knocks on the site with the job key the site expects', async () => {
    const ask = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await run('https://ourhometownstudio.com/', 's', ask as any)).toEqual({ ok: true, reason: 'done' })
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/waitlist-sweep.json')
    expect(init.method).toBe('POST')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 's').update('job:waitlist-sweep').digest('hex'))
    expect(init.headers['x-job-key']).toBe(waitlistSweepJobKey('s'))
  })
  it('reports a refusal, no answer, or missing settings', async () => {
    expect(await run('https://x.test', 's', (async () => new Response('', { status: 403 })) as any)).toEqual({ ok: false, reason: 'site answered 403' })
    expect((await run('https://x.test', 's', (async () => { throw new Error('down') }) as any)).reason).toBe('site unreachable: down')
    expect((await run(undefined, 's')).reason).toBe('not configured')
    expect((await run('https://x.test', undefined)).reason).toBe('not configured')
  })
})
