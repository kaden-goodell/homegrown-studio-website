import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

function ctx() {
  const request = new Request('http://localhost/api/staff/me.json')
  return { request } as any
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  GET = (await import('@pages/api/staff/me.json')).GET
})

describe('GET /api/staff/me.json', () => {
  it('returns the signed-in staffer from the identity cookie', async () => {
    const res = await GET(ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.staff).toEqual({ id: 't', name: 'Test', role: 'crew' })
  })

  it('rejects an unauthenticated caller (401 — e.g. after a page reload with no cookie)', async () => {
    authed = null
    const res = await GET(ctx())
    expect(res.status).toBe(401)
  })
})
