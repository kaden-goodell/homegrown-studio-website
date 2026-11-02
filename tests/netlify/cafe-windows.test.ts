import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/cafe-windows'

describe('netlify/functions/cafe-windows (R38)', () => {
  it('runs just after midnight in Chicago, all year (06:15 UTC)', () => {
    expect(config.schedule).toBe('15 6 * * *')
  })
  it('knocks on the site with the job key, and reports what it said', async () => {
    const ask = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'unchanged' } }), { status: 200 }))
    expect(await run('https://ourhometownstudio.com/', 's', ask as any)).toEqual({ ok: true, reason: 'unchanged' })
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/cafe-windows.json')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 's').update('job:cafe-windows').digest('hex'))
    const failed = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'failed' } }), { status: 200 }))
    expect(await run('https://x.test', 's', failed as any)).toEqual({ ok: false, reason: 'failed' })
    expect((await run(undefined, 's')).reason).toBe('not configured')
    expect((await run('https://x.test', 's', (async () => { throw new Error('down') }) as any)).reason).toMatch(/unreachable/)
  })
})
