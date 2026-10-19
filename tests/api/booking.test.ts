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

describe('retired booking endpoints', () => {
  // No page used them, and cancel took any Square booking id with no sign-in.
  it('create.json and cancel.json are gone', async () => {
    const pages = import.meta.glob('/src/pages/api/booking/*.ts')
    expect(Object.keys(pages).some((p) => /\/(create|cancel)\.json\.ts$/.test(p))).toBe(false)
  })
})
