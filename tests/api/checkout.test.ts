import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { GET as clientConfig } from '@pages/api/checkout/client-config.json'

function createMockContext(options: { method?: string; body?: any; url?: string } = {}) {
  const url = new URL(options.url || 'http://localhost/api/checkout/client-config.json')
  const request = new Request(url, { method: options.method || 'GET' })
  return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
}

describe('checkout API routes', () => {
  it('GET /client-config.json returns appId and locationId', async () => {
    const response = await clientConfig(createMockContext())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toBeDefined()
    expect(body.data.appId).toBeDefined()
    expect(body.data.locationId).toBeDefined()
  })
})

describe('final security review I3 / M7: the retired public routes stay deleted', () => {
  // Programs and the corporate inquiry are retired (private events use /api/private-events/request.json).
  // find-or-create handed out a Square customer's email, name and phone by phone number, and wrote blanks;
  // the old checkout took a client-supplied order body.
  for (const route of ['customer/find-or-create', 'inquiry/submit', 'checkout/create-order', 'checkout/process-payment', 'programs/enroll']) {
    it(route, () => {
      expect(existsSync(resolve(__dirname, `../../src/pages/api/${route}.json.ts`))).toBe(false)
    })
  }
})
