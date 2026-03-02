import { describe, it, expect } from 'vitest'

function createMockContext(options: { method?: string; body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/test')
  const request = new Request(url, {
    method: options.method || 'GET',
    ...(options.body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }
      : {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('POST /api/booking/availability.json', () => {
  it('returns slots array', async () => {
    const { POST } = await import('@pages/api/booking/availability.json')
    const ctx = createMockContext({
      method: 'POST',
      body: {
        startDate: '2026-03-10',
        endDate: '2026-03-12',
        locationId: 'loc-1',
      },
    })
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toHaveProperty('data')
    expect(Array.isArray(json.data)).toBe(true)
  })
})

describe('POST /api/booking/create.json', () => {
  it('returns booking with id and status', async () => {
    const { POST } = await import('@pages/api/booking/create.json')
    const ctx = createMockContext({
      method: 'POST',
      body: {
        slotId: 'mock-slot-2026-03-10-0',
        customerId: 'cust-1',
        eventType: 'pottery-class',
      },
    })
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toHaveProperty('data')
    expect(json.data).toHaveProperty('id')
    expect(json.data).toHaveProperty('status')
  })
})

describe('POST /api/booking/cancel.json', () => {
  it('returns success', async () => {
    // First create a booking so we can cancel it
    const { POST: createPost } = await import('@pages/api/booking/create.json')
    const createCtx = createMockContext({
      method: 'POST',
      body: {
        slotId: 'mock-slot-2026-03-10-0',
        customerId: 'cust-1',
        eventType: 'pottery-class',
      },
    })
    const createRes = await createPost(createCtx)
    const created = await createRes.json()

    const { POST } = await import('@pages/api/booking/cancel.json')
    const ctx = createMockContext({
      method: 'POST',
      body: {
        bookingId: created.data.id,
        bookingVersion: 1,
      },
    })
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toHaveProperty('data')
    expect(json.data).toEqual({ success: true })
  })
})
