import { describe, it, expect, vi } from 'vitest'
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: (r: Request) => r.headers.get('x-ok') === '1' }))
vi.mock('@lib/square-dashboard', () => ({ checkSession: vi.fn(async () => ({ state: 'connected' })) }))
import { GET } from '../../src/pages/api/staff/square-session.json'

const call = (qs: string, ok = true) => GET({ request: new Request('http://x/api', { headers: ok ? { 'x-ok': '1' } : {} }), url: new URL('http://x/api' + qs) } as any)

describe('GET /api/staff/square-session.json', () => {
  it('401 without staff sign-in', async () => {
    expect((await call('?scheduleId=clssch_a', false)).status).toBe(401)
  })
  it('400 without a class id', async () => {
    expect((await call('')).status).toBe(400)
  })
  it('reports the state and never the session', async () => {
    const res = await call('?scheduleId=clssch_a')
    expect(await res.json()).toEqual({ data: { state: 'connected' } })
  })
})
