import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cfg = vi.hoisted(() => ({ accessToken: 'tok', environment: 'sandbox', locationId: 'L', applicationId: 'a' } as Record<string, string>))
vi.mock('@config/site.config', async (orig) => {
  const real = await orig<typeof import('@config/site.config')>()
  return { ...real, siteConfig: { ...real.siteConfig, providers: { ...real.siteConfig.providers, catalog: { type: 'square', config: cfg } } } }
})

const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import { POST } from '@pages/api/admin/classes/seed-sandbox.json'
import { NO_TEST_STORE } from '@lib/classes/test-site-guard'
import { adminCookie } from '@lib/admin-auth'

const signedIn = () => adminCookie().split(';')[0]
const req = (cookie?: string) => new Request('https://x.test/api/admin/classes/seed-sandbox.json', { method: 'POST', headers: cookie ? { cookie } : {} })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/** A fake sandbox catalog: list returns what's there, upsert adds to it. */
let catalog: any[] = []
let team: any[] = []
let calls: { url: string; method: string; body: any }[] = []
beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  cfg.environment = 'sandbox'
  site.context = 'dev'
  catalog = []; calls = []
  team = [{ id: 'TM_OWNER', given_name: 'Kaden', family_name: 'Goodell', status: 'ACTIVE', is_owner: true }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    expect(String(url)).toMatch(/^https:\/\/connect\.squareupsandbox\.com\/v2\//)
    expect((init.headers as any)['Square-Version']).toBe('2026-01-22')
    if (String(url).includes('/catalog/list')) return json(200, { objects: catalog })
    if (String(url).endsWith('/team-members/search')) return json(200, { team_members: team.filter((m) => m.status === body?.query?.filter?.status) })
    if (String(url).endsWith('/team-members')) {
      const m = { id: `TM_NEW${team.length}`, status: 'ACTIVE', ...body.team_member }
      team.push(m)
      return json(200, { team_member: m })
    }
    if (String(url).endsWith('/catalog/batch-upsert')) {
      const id_mappings = body.batches[0].objects.map((o: any, i: number) => ({ client_object_id: o.id, object_id: `REAL${catalog.length + i}` }))
      const real = new Map(id_mappings.map((m: any) => [m.client_object_id, m.object_id]))
      // Square stores references to temporary ids as the real ones.
      body.batches[0].objects.forEach((o: any, i: number) => catalog.push(JSON.parse(JSON.stringify({ ...o, id: id_mappings[i].object_id }), (_k, v) => (typeof v === 'string' && real.has(v) ? real.get(v) : v))))
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
    const { partyCraftCategoryId } = first.data
    expect(partyCraftCategoryId).toBeTruthy()
    expect(commands).toEqual([
      `npx netlify env:set SQUARE_CLASSES_CATEGORY_ID ${classesCategoryId} --context branch:kaden/own-booking-system`,
      `npx netlify env:set SQUARE_CLASS_TAX_ID ${classTaxId} --context branch:kaden/own-booking-system`,
      `npx netlify env:set SQUARE_PARTY_CRAFT_CATEGORY_ID ${partyCraftCategoryId} --context branch:kaden/own-booking-system`,
    ])
    // A "Party Crafts" category and two priced crafts in it, in the same batch (temporary ids).
    expect(objs.find((o: any) => o.type === 'CATEGORY' && o.category_data.name === 'Party Crafts')).toBeTruthy()
    const crafts = objs.filter((o: any) => o.type === 'ITEM')
    expect(crafts).toHaveLength(2)
    for (const c of crafts) {
      expect(c.item_data.categories).toEqual([{ id: '#partycrafts' }])
      expect(c.item_data.name).not.toMatch(/^test/i)
      expect(c.item_data.variations[0].item_variation_data.price_money.amount).toBeGreaterThan(0)
    }

    calls = []
    const second = await (await POST({ request: req(signedIn()) } as any)).json()
    expect(calls.some((c) => c.url.endsWith('/batch-upsert'))).toBe(false)
    expect(second.data.classesCategoryId).toBe(classesCategoryId)
    expect(second.data.classTaxId).toBe(classTaxId)
    expect(second.data.partyCraftCategoryId).toBe(partyCraftCategoryId)
  })

  it('only adds what is missing', async () => {
    catalog = [
      { type: 'CATEGORY', id: 'CATX', category_data: { name: 'classes' } },
      { type: 'CATEGORY', id: 'PCAT', category_data: { name: 'Party Crafts' } },
      { type: 'ITEM', id: 'K1', item_data: { name: 'Sandbox Keychain Bar', categories: [{ id: 'PCAT' }] } },
    ]
    const out = await (await POST({ request: req(signedIn()) } as any)).json()
    const objs = calls.find((c) => c.url.endsWith('/batch-upsert'))!.body.batches[0].objects
    expect(objs.map((o: any) => o.type)).toEqual(['TAX', 'ITEM'])
    expect(objs[1].item_data.name).toBe('Sandbox Tote Bags')
    expect(objs[1].item_data.categories).toEqual([{ id: 'PCAT' }])
    expect(out.data.partyCraftCategoryId).toBe('PCAT')
    expect(out.data.classesCategoryId).toBe('CATX')
  })
})

describe('the sandbox crew member for the staffing scenarios (stage 3)', () => {
  it('makes one active "E2E Crew" with a name only (no wage, no booking profile), then reuses it', async () => {
    const first = await (await POST({ request: req(signedIn()) } as any)).json()
    const creates = calls.filter((c) => c.url.endsWith('/team-members') && c.method === 'POST')
    expect(creates).toHaveLength(1)
    expect(Object.keys(creates[0].body).sort()).toEqual(['idempotency_key', 'team_member'])
    expect(creates[0].body.team_member).toEqual({ given_name: 'E2E', family_name: 'Crew' })
    expect(first.data.crewMember).toEqual({ id: 'TM_NEW1', name: 'E2E Crew', created: true })
    // nothing about bookings, wages or the access token in what goes out or comes back
    expect(JSON.stringify(calls.map((c) => c.body))).not.toMatch(/booking|wage|pay_rate|is_bookable/i)
    expect(JSON.stringify(first)).not.toContain('tok')

    calls = []
    const again = await (await POST({ request: req(signedIn()) } as any)).json()
    expect(calls.some((c) => c.url.endsWith('/team-members') && c.method === 'POST')).toBe(false)
    expect(again.data.crewMember).toEqual({ id: 'TM_NEW1', name: 'E2E Crew', created: false })
  })

  it('an inactive E2E Crew does not count: a fresh active one is made', async () => {
    team.push({ id: 'TM_OLD', given_name: 'E2E', family_name: 'Crew', status: 'INACTIVE' })
    const out = await (await POST({ request: req(signedIn()) } as any)).json()
    expect(out.data.crewMember.created).toBe(true)
    expect(out.data.crewMember.id).not.toBe('TM_OLD')
  })

  it('R41: refused on a test site with no store of its own, before any Square call', async () => {
    const prev = process.env.STORE_NAMESPACE
    delete process.env.STORE_NAMESPACE
    site.context = 'deploy-preview'
    try {
      const res = await POST({ request: req(signedIn()) } as any)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: NO_TEST_STORE })
      expect(calls).toHaveLength(0)
      // with its own store (the branch preview's STORE_NAMESPACE=preview) it runs
      process.env.STORE_NAMESPACE = 'preview'
      expect((await POST({ request: req(signedIn()) } as any)).status).toBe(200)
    } finally {
      if (prev === undefined) delete process.env.STORE_NAMESPACE
      else process.env.STORE_NAMESPACE = prev
    }
  })
})

describe('GET /api/admin/classes/seed-sandbox.json', () => {
  const get = (cookie?: string) => new Request('https://x.test/api/admin/classes/seed-sandbox.json', { headers: cookie ? { cookie } : {} })
  it('says whether this site is on the Square sandbox, to owners only, without calling Square', async () => {
    const { GET } = await import('@pages/api/admin/classes/seed-sandbox.json')
    expect((await GET({ request: get() } as any)).status).toBe(401)
    expect(await (await GET({ request: get(signedIn()) } as any)).json()).toEqual({ data: { sandbox: true } })
    cfg.environment = 'production'
    expect(await (await GET({ request: get(signedIn()) } as any)).json()).toEqual({ data: { sandbox: false } })
    expect(calls).toHaveLength(0)
  })
})
