import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const listAudit = vi.fn()
vi.mock('@lib/audit', () => ({ listAudit: (...a: unknown[]) => listAudit(...a) }))

import { GET } from '../../src/pages/api/staff/audit.json'

const get = (qs = '') => {
  const url = new URL(`http://x/api/staff/audit.json${qs}`)
  return GET({ request: new Request(url), url } as any)
}

beforeEach(() => { authed = { id: 't', name: 'Test', role: 'crew' }; listAudit.mockReset(); listAudit.mockResolvedValue([{ id: 'au_1' }]) })

describe('/api/staff/audit', () => {
  it('401s when not signed in', async () => {
    authed = null
    expect((await get()).status).toBe(401)
    expect(listAudit).not.toHaveBeenCalled()
  })

  it('returns entries to any signed-in staff, crew or owner', async () => {
    for (const role of ['crew', 'owner'] as const) {
      authed = { id: 't', name: 'Test', role }
      const res = await get()
      expect(res.status).toBe(200)
      expect((await res.json()).data.entries).toEqual([{ id: 'au_1' }])
    }
  })

  it('passes limit, by and since through', async () => {
    await get('?limit=5&by=m1&since=2026-10-01')
    expect(listAudit).toHaveBeenCalledWith({ limit: 5, byId: 'm1', since: '2026-10-01' })
  })

  it('defaults the limit to 200', async () => {
    await get()
    expect(listAudit).toHaveBeenCalledWith({ limit: 200, byId: undefined, since: undefined })
  })
})
