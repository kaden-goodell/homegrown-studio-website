import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET as getEventTypes } from '@pages/api/catalog/event-types.json'
import { GET as getAddOns } from '@pages/api/catalog/add-ons.json'
import { GET as getPricing } from '@pages/api/catalog/pricing.json'

function createMockContext(options: { url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/test')
  const request = new Request(url)
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('GET /api/catalog/event-types.json', () => {
  it('returns all event types when no category', async () => {
    const ctx = createMockContext({ url: 'http://localhost/api/catalog/event-types.json' })
    const response = await getEventTypes(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
  })

  it('filters by category when ?category=workshop', async () => {
    const ctx = createMockContext({ url: 'http://localhost/api/catalog/event-types.json?category=workshop' })
    const response = await getEventTypes(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    for (const eventType of body.data) {
      expect(eventType.category).toBe('workshop')
    }
  })
})

describe('GET /api/catalog/add-ons.json', () => {
  it('returns add-ons for a valid event type', async () => {
    const typesCtx = createMockContext({ url: 'http://localhost/api/catalog/event-types.json' })
    const typesRes = await getEventTypes(typesCtx)
    const typesBody = await typesRes.json()
    const birthdayType = typesBody.data.find((t: any) => t.category === 'birthday')
    if (!birthdayType) return

    const ctx = createMockContext({ url: `http://localhost/api/catalog/add-ons.json?eventTypeId=${birthdayType.id}` })
    const response = await getAddOns(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 400 when eventTypeId is missing', async () => {
    const ctx = createMockContext({ url: 'http://localhost/api/catalog/add-ons.json' })
    const response = await getAddOns(ctx)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })
})

describe('GET /api/catalog/pricing.json', () => {
  it('returns pricing for valid ids', async () => {
    const typesCtx = createMockContext({ url: 'http://localhost/api/catalog/event-types.json' })
    const typesRes = await getEventTypes(typesCtx)
    const typesBody = await typesRes.json()
    const eventType = typesBody.data[0]
    const variation = eventType.variations[0]

    const ctx = createMockContext({
      url: `http://localhost/api/catalog/pricing.json?eventTypeId=${eventType.id}&variationId=${variation.id}`,
    })
    const response = await getPricing(ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.priceAmount).toBeGreaterThan(0)
    expect(body.data.priceCurrency).toBe('USD')
  })

  it('returns 400 when params are missing', async () => {
    const ctx = createMockContext({ url: 'http://localhost/api/catalog/pricing.json' })
    const response = await getPricing(ctx)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 when only eventTypeId is provided', async () => {
    const ctx = createMockContext({ url: 'http://localhost/api/catalog/pricing.json?eventTypeId=abc' })
    const response = await getPricing(ctx)
    expect(response.status).toBe(400)
  })
})
