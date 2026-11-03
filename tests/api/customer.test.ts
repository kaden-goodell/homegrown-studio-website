import { describe, it, expect } from 'vitest'
import { POST as subscribe } from '@pages/api/customer/subscribe.json'

function createMockContext(options: { body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/customer/subscribe.json')
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body || {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('customer API routes', () => {
  it('POST subscribe with valid email returns success', async () => {
    const ctx = createMockContext({
      url: 'http://localhost/api/customer/subscribe.json',
      body: { email: 'test@example.com' },
    })
    const response = await subscribe(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.success).toBe(true)
  })

  it('POST subscribe returns 400 when email missing', async () => {
    const ctx = createMockContext({
      url: 'http://localhost/api/customer/subscribe.json',
      body: {},
    })
    const response = await subscribe(ctx)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })
})
