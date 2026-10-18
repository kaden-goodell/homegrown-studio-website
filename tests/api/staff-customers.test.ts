import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: any = { id: 'sam', name: 'Sam', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))
const mockFind = vi.fn()
vi.mock('@lib/customer-directory', () => ({ findCustomers: (...a: any[]) => mockFind(...a) }))
const mockGet = vi.fn()
vi.mock('@config/providers', () => ({ providers: { customer: { getById: (...a: any[]) => mockGet(...a) } } }))
const mockHousehold = vi.fn()
vi.mock('@lib/attending', () => ({ householdForSeats: (...a: any[]) => mockHousehold(...a) }))

import { GET } from '@pages/api/staff/customers.json'
const call = (qs: string) => GET({ request: new Request(`http://x/api/staff/customers.json?${qs}`), url: new URL(`http://x/api/staff/customers.json?${qs}`) } as any)
const ASH = { id: 'C1', givenName: 'Ashley', familyName: 'Singleton', email: 'ash@x.com', phone: '+12519794753' }

beforeEach(() => { vi.clearAllMocks(); authed = { id: 'sam', name: 'Sam', role: 'crew' } })

describe('GET /api/staff/customers.json', () => {
  it('401s without staff auth', async () => {
    authed = null
    expect((await call('q=ash')).status).toBe(401)
  })
  it('searches from two letters', async () => {
    mockFind.mockResolvedValue([ASH])
    expect((await (await call('q=a')).json()).data).toEqual([])
    expect((await (await call('q=as')).json()).data).toEqual([ASH])
    expect(mockFind).toHaveBeenCalledTimes(1)
  })
  it('returns one customer with their household', async () => {
    mockGet.mockResolvedValue(ASH)
    mockHousehold.mockResolvedValue({ recordId: 'wvr_1', status: 'ok', people: [] })
    const body = await (await call('id=C1')).json()
    expect(body.data).toEqual({ customer: ASH, household: { recordId: 'wvr_1', status: 'ok', people: [] } })
    expect(mockHousehold).toHaveBeenCalledWith({ email: 'ash@x.com', phone: '+12519794753' })
  })
  it('404s an unknown customer, 503s when Square fails', async () => {
    mockGet.mockResolvedValue(null)
    expect((await call('id=nope')).status).toBe(404)
    mockFind.mockRejectedValue(new Error('down'))
    expect((await call('q=ash')).status).toBe(503)
  })
})
