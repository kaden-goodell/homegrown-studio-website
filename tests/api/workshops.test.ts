import { describe, it, expect } from 'vitest'
import { GET } from '@pages/api/workshops/list.json'
import { POST } from '@pages/api/workshops/availability.json'

function createMockContext(options: { method?: string; body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/workshops/list.json')
  const request = new Request(url, {
    method: options.method || 'GET',
    ...(options.body ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
    } : {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('workshop API routes', () => {
  it('GET /list.json returns workshop event types', async () => {
    const ctx = createMockContext()
    const response = await GET(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    for (const item of body.data) {
      expect(item.category).toBe('workshop')
    }
  })

  it('POST /availability.json returns time slots', async () => {
    const ctx = createMockContext({
      method: 'POST',
      url: 'http://localhost/api/workshops/availability.json',
      body: { startDate: '2026-03-15', endDate: '2026-03-22', eventTypeId: 'workshop-candle' },
    })
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
  })
})
