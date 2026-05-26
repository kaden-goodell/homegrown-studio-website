import { describe, it, expect } from 'vitest'
import { POST } from '@pages/api/workshops/availability.json'

function createMockContext(options: { method?: string; body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/workshops/availability.json')
  const request = new Request(url, {
    method: options.method || 'POST',
    ...(options.body ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
    } : {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('workshop API routes', () => {
  it('POST /availability.json returns Workshop[]', async () => {
    const ctx = createMockContext({
      method: 'POST',
      body: {},
    })
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
  })
})
