import { describe, it, expect, vi } from 'vitest'
import { run, config } from '../../netlify/functions/keep-warm'
import { GET } from '../../src/pages/api/ping.json'

describe('keep-warm function', () => {
  it('knocks every 5 minutes, 6 AM to midnight Central', () => {
    expect(config.schedule).toBe('*/5 0-4,11-23 * * *')
  })

  it('knocks on the ping page of the live site', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const out = await run('https://ourhometownstudio.com/', ask as any)
    expect(ask.mock.calls[0][0]).toBe('https://ourhometownstudio.com/api/ping.json')
    expect(out.ok).toBe(true)
  })

  it('reports trouble instead of throwing', async () => {
    expect((await run(undefined)).reason).toBe('not configured')
    expect((await run('https://x.test', vi.fn().mockRejectedValue(new Error('down')) as any)).reason).toMatch(/unreachable: down/)
    expect((await run('https://x.test', vi.fn().mockResolvedValue({ ok: false, status: 502 }) as any)).reason).toBe('site answered 502')
  })

  it('the ping page answers without touching anything and is never cached', async () => {
    const res = await (GET as any)({})
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
