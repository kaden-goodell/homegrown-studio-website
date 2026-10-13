import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/waiver-reminders'

describe('netlify/functions/waiver-reminders', () => {
  it('runs at 14:00 and 15:00 UTC (the site keeps whichever is 9 AM in Madison)', () => {
    expect(config.schedule).toBe('0 14,15 * * *')
  })
  it('knocks on the site with the job key', async () => {
    const ask = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await run('https://ourhometownstudio.com/', 's', ask as any)).toEqual({ ok: true, reason: 'done' })
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/waiver-reminders.json')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 's').update('job:waiver-reminders').digest('hex'))
  })
  it('reports a refusal or no answer', async () => {
    expect(await run('https://x.test', 's', (async () => new Response('', { status: 500 })) as any)).toEqual({ ok: false, reason: 'site answered 500' })
    expect((await run('https://x.test', 's', (async () => { throw new Error('down') }) as any)).reason).toMatch(/unreachable/)
    expect((await run(undefined, 's')).reason).toBe('not configured')
  })
})
