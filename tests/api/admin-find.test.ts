// tests/api/admin-find.test.ts — GET /api/admin/find.json (final review I5): owners only, two letters at least.
import { describe, it, expect, vi } from 'vitest'

let authed = true
vi.mock('@lib/admin-auth', () => ({ adminAuthorized: async () => authed }))
const find = vi.fn(async (_q: string) => ({ classes: [], parties: [], waitlist: [], more: false }))
vi.mock('@lib/customer-find', () => ({ FIND_MIN: 2, findCustomerBookings: (q: string) => find(q) }))

import { GET } from '@pages/api/admin/find.json'

const call = (q: string) => {
  const request = new Request(`https://x.test/api/admin/find.json?q=${encodeURIComponent(q)}`)
  return GET({ request, url: new URL(request.url) } as any)
}

describe('GET /api/admin/find.json', () => {
  it('owners only; asks for two letters; searches what was typed', async () => {
    authed = false
    expect((await call('Ada')).status).toBe(401)
    authed = true
    expect((await call('A')).status).toBe(400)
    const res = await call(' Ada ')
    expect(res.status).toBe(200)
    expect(find).toHaveBeenCalledWith('Ada')
  })

  it('a search that can’t run says so', async () => {
    find.mockRejectedValueOnce(new Error('down'))
    const res = await call('Ada')
    expect(res.status).toBe(503)
  })
})
