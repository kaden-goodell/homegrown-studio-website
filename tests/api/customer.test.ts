import { describe, it, expect } from 'vitest'
import { POST as findOrCreate } from '@pages/api/customer/find-or-create.json'
import { POST as subscribe } from '@pages/api/customer/subscribe.json'
import { POST as submitInquiry } from '@pages/api/inquiry/submit.json'

function createMockContext(options: { body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/customer/find-or-create.json')
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body || {}),
  })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('customer API routes', () => {
  it('POST find-or-create with valid data returns customer with id', async () => {
    const ctx = createMockContext({
      body: { email: 'test@example.com', givenName: 'Jane', familyName: 'Doe' },
    })
    const response = await findOrCreate(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.id).toBeDefined()
    expect(body.data.email).toBe('test@example.com')
  })

  it('POST find-or-create returns 400 when email missing', async () => {
    const ctx = createMockContext({
      body: { givenName: 'Jane' },
    })
    const response = await findOrCreate(ctx)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

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

describe('inquiry API routes', () => {
  it('POST inquiry/submit sends notification and returns success', async () => {
    const ctx = createMockContext({
      url: 'http://localhost/api/inquiry/submit.json',
      body: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        eventType: 'corporate-workshop',
        details: 'Team building event for 20 people',
      },
    })
    const response = await submitInquiry(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.success).toBe(true)
    expect(body.data.customerId).toBeDefined()
  })

  it('POST inquiry/submit returns 400 when required fields missing', async () => {
    const ctx = createMockContext({
      url: 'http://localhost/api/inquiry/submit.json',
      body: { name: 'Jane', email: 'jane@example.com' },
    })
    const response = await submitInquiry(ctx)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })
})
