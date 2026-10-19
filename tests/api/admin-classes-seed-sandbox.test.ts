import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cfg = vi.hoisted(() => ({ accessToken: 'tok', environment: 'sandbox', locationId: 'L', applicationId: 'a' } as Record<string, string>))
vi.mock('@config/site.config', async (orig) => {
  const real = await orig<typeof import('@config/site.config')>()
  return { ...real, siteConfig: { ...real.siteConfig, providers: { ...real.siteConfig.providers, catalog: { type: 'square', config: cfg } } } }
})

import { POST } from '@pages/api/admin/classes/seed-sandbox.json'
import { adminCookie } from '@lib/admin-auth'

const signedIn = () => adminCookie().split(';')[0]
const req = (cookie?: string) => new Request('https://x.test/api/admin/classes/seed-sandbox.json', { method: 'POST', headers: cookie ? { cookie } : {} })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/** A fake sandbox catalog: list returns what's there, upsert adds to it. */
let catalog: any[] = []
let calls: { url: string; method: string; body: any }[] = []
beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  cfg.environment = 'sandbox'
  catalog = []; calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    expect(String(url)).toMatch(/^https:\/\/connect\.squareupsandbox\.com\/v2\//)
    expect((init.headers as any)['Square-Version']).toBe('2026-01-22')
    if (String(url).includes('/catalog/list')) return json(200, { objects: catalog })
    if (String(url).endsWith('/catalog/batch-upsert')) {
      const id_mappings = body.batches[0].objects.map((o: any, i: number) => ({ client_object_id: o.id, object_id: `REAL${catalog.length + i}` }))
      body.batches[0].objects.forEach((o: any, i: number) => catalog.push({ ...o, id: id_mappings[i].object_id }))
      return json(200, { objects: [], id_mappings })
    }
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('POST /api/admin/classes/seed-sandbox.json', () => {
  it('refuses without the owner cookie', async () => {
    expect((await POST({ request: req() } as any)).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('refuses on production', async () => {
    cfg.environment = 'production'
    const res = await POST({ request: req(signedIn()) } as any)
    expect(res.status).toBe(409)
    expect(calls).toHaveLength(0)
  })

  it('creates the category and the 9% tax once, then reuses them', async () => {
    const first = await (await POST({ request: req(signedIn()) } as any)).json()
    const upserts = calls.filter((c) => c.url.endsWith('/batch-upsert'))
    expect(upserts).toHaveLength(1)
    const objs = upserts[0].body.batches[0].objects
    expect(objs.find((o: any) => o.type === 'CATEGORY').category_data).toEqual({ name: 'Classes' })
    expect(objs.find((o: any) => o.type === 'TAX').tax_data).toMatchObject({
      name: 'Sales tax', percentage: '9', inclusion_type: 'ADDITIVE', applies_to_custom_amounts: true, enabled: true,
    })
    const { classesCategoryId, classTaxId, commands } = first.data
    expect(classesCategoryId).toBeTruthy()
    expect(classTaxId).toBeTruthy()
    expect(commands).toEqual([
      `npx netlify env:set SQUARE_CLASSES_CATEGORY_ID ${classesCategoryId} --context branch:kaden/own-booking-system`,
      `npx netlify env:set SQUARE_CLASS_TAX_ID ${classTaxId} --context branch:kaden/own-booking-system`,
    ])

    calls = []
    const second = await (await POST({ request: req(signedIn()) } as any)).json()
    expect(calls.some((c) => c.url.endsWith('/batch-upsert'))).toBe(false)
    expect(second.data.classesCategoryId).toBe(classesCategoryId)
    expect(second.data.classTaxId).toBe(classTaxId)
  })

  it('only adds what is missing', async () => {
    catalog = [{ type: 'CATEGORY', id: 'CATX', category_data: { name: 'classes' } }]
    const out = await (await POST({ request: req(signedIn()) } as any)).json()
    const objs = calls.find((c) => c.url.endsWith('/batch-upsert'))!.body.batches[0].objects
    expect(objs.map((o: any) => o.type)).toEqual(['TAX'])
    expect(out.data.classesCategoryId).toBe('CATX')
  })
})
