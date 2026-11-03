import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config, KNOCKS_UNTIL_MS, KNOCK_TIMEOUT_MS } from '../../netlify/functions/reconcile-classes'

const answer = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })

describe('netlify/functions/reconcile-classes', () => {
  it('runs from 08:00 to 11:00 UTC (the site starts a pass at 3 AM in Madison; later runs only carry one on)', () => {
    expect(config.schedule).toBe('0 8,9,10,11 * * *')
  })
  it('knocks on the site with the job key', async () => {
    const ask = vi.fn(async () => answer({ orders: 1, more: false }))
    expect(await run('https://ourhometownstudio.com/', 's', ask as any)).toEqual({ ok: true, reason: 'done', knocks: 1 })
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/reconcile-classes.json')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 's').update('job:reconcile-classes').digest('hex'))
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('knocks again while the site says there is more, until done', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(answer({ more: true }))
      .mockResolvedValueOnce(answer({ more: true }))
      .mockResolvedValueOnce(answer({ more: false }))
    expect(await run('https://x.test', 's', ask as any)).toEqual({ ok: true, reason: 'done', knocks: 3 })
  })
  it('starts no knock after its time is up, so the run stays under the 30-second limit', async () => {
    expect(KNOCKS_UNTIL_MS + KNOCK_TIMEOUT_MS).toBeLessThan(30_000)
    let t = 0
    const ask = vi.fn(async () => { t += 7_000; return answer({ more: true }) })
    const out = await run('https://x.test', 's', ask as any, () => t)
    expect(out).toEqual({ ok: true, reason: 'more to do; the next scheduled run carries on', knocks: 3 })
  })
  it('reports a refusal or no answer', async () => {
    expect(await run('https://x.test', 's', (async () => new Response('', { status: 500 })) as any)).toMatchObject({ ok: false, reason: 'site answered 500' })
    expect((await run('https://x.test', 's', (async () => { throw new Error('down') }) as any)).reason).toMatch(/unreachable/)
    expect((await run(undefined, 's')).reason).toBe('not configured')
  })
})
