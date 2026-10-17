import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOwners = vi.fn()
const mockCustomer = vi.fn()
const mockSave = vi.fn()
const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))
vi.mock('@lib/event-requests', async (orig) => ({
  ...(await orig<typeof import('@lib/event-requests')>()),
  saveRequest: (...a: any[]) => mockSave(...a),
  emailOwners: (...a: any[]) => mockOwners(...a),
  emailCustomer: (...a: any[]) => mockCustomer(...a),
}))

import { POST } from '@pages/api/private-events/request.json'
import { goodBody } from '../fixtures/event-request'

/** Tomorrow-ish dates keep these tests good whatever day they run. */
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const body = (over: any = {}) => goodBody({ event: { ...goodBody().event, date: future(30), backupDate: '' }, ...over })

let ip = 0
const call = (b: unknown, address = `198.51.100.${++ip}`) => POST({ clientAddress: address, request: new Request('https://ourhometownstudio.com/api/private-events/request.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) } as any)

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockImplementation(async (value: any, photos: any[]) => ({ ...value, id: '2026-10-17-abcdef12', at: '', status: 'new', photos: photos.length }))
  mockOwners.mockResolvedValue(true)
  mockCustomer.mockResolvedValue(true)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
})

describe('POST /api/private-events/request.json', () => {
  it('saves, then emails and texts the owners (with the admin link) and emails the customer', async () => {
    const res = await call(body())
    expect(res.status).toBe(200)
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockOwners.mock.calls[0][2]).toBe('https://ourhometownstudio.com/admin')
    expect(mockCustomer).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toMatch(/^New private event request: Dana Planner, team building, .* 18 guests, at their place\. Details in your email and at ourhometownstudio\.com\/admin\.$/)
  })

  it('a refused answer comes back with the field to point at, and nothing is saved or sent', async () => {
    const res = await call(body({ where: { place: 'yours', address: '' } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Add the address, so we can plan the trip.', field: 'address' })
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockOwners).not.toHaveBeenCalled()
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('a bot that fills the hidden field is told it worked, and nothing is kept', async () => {
    const res = await call(body({ company: 'Spam LLC' }))
    expect(res.status).toBe(200)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('says so when it could not be saved, and sends nothing', async () => {
    mockSave.mockRejectedValue(new Error('blobs down'))
    const res = await call(body())
    expect(res.status).toBe(502)
    expect(mockOwners).not.toHaveBeenCalled()
    expect(mockCustomer).not.toHaveBeenCalled()
  })

  it('a failed text does not fail the request', async () => {
    mockAlert.mockRejectedValue(new Error('Quo down'))
    expect((await call(body())).status).toBe(200)
  })

  it('reads nothing that is not JSON', async () => {
    const res = await POST({ clientAddress: '198.51.100.250', request: new Request('https://x.test/api/private-events/request.json', { method: 'POST', body: 'nope' }) } as any)
    expect(res.status).toBe(400)
  })

  it('slows down someone hammering it', async () => {
    const statuses = []
    for (let i = 0; i < 6; i++) statuses.push((await call(body(), '203.0.113.9')).status)
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true)
    expect(statuses[5]).toBe(429)
  })
})
