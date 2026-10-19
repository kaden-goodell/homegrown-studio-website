import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cfg = vi.hoisted(() => ({
  accessToken: 'tok', environment: 'sandbox', locationId: 'LOC1', applicationId: 'app',
  classesCategoryId: 'CAT1', classTaxId: 'TAX1',
} as Record<string, string>))
vi.mock('@config/site.config', async (orig) => {
  const real = await orig<typeof import('@config/site.config')>()
  return {
    ...real,
    siteConfig: { ...real.siteConfig, url: 'https://site.test', providers: { ...real.siteConfig.providers, catalog: { type: 'square', config: cfg } } },
  }
})

import { SQUARE_API_VERSION, squareBaseUrl, squareFetch } from '@lib/classes/square-api'
import { variationPlan, syncClassToSquare, archiveClassInSquare, classIdFromVariation } from '@lib/classes/square-catalog'
import type { ScheduledClass } from '@lib/classes/types'

function cls(over: Partial<ScheduledClass> = {}): ScheduledClass {
  return {
    id: 'cls_abc', libraryId: null, libraryVersion: null,
    content: {
      name: 'Pottery', description: 'Make a bowl.', imageUrl: null, instructor: null,
      rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'wk', label: 'Weekend', covers: { kind: 'choose', count: 1 } }],
      prices: { all: { adult: 6000, kid: 4000 }, wk: { adult: 2500 } },
      questions: [], addOns: [{ id: 'glaze', label: 'Extra glaze', priceCents: 500, maxPerSeat: 2 }],
      defaultCapacity: 12, defaultMinutes: 90,
    },
    // 2026-10-17T23:00Z = Sat Oct 17, 6 PM Chicago
    sessions: [{ id: 'ses_1', startIso: '2026-10-17T23:00:00.000Z', endIso: '2026-10-18T00:30:00.000Z', capacity: 12 }],
    status: 'open', square: { itemId: null, variations: {} },
    createdAt: '', updatedAt: '', by: { id: 'k', name: 'Kaden' }, history: [],
    ...over,
  }
}

type Call = { url: string; method: string; headers: Record<string, string>; body: any }
let calls: Call[] = []
let replies: ((c: Call) => Response | undefined)[] = []
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  calls = []; replies = []
  cfg.classesCategoryId = 'CAT1'; cfg.classTaxId = 'TAX1'; cfg.environment = 'sandbox'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    const c: Call = { url: String(url), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body }
    calls.push(c)
    for (const r of replies) { const out = r(c); if (out) return out }
    throw new Error(`unexpected fetch ${c.method} ${c.url}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

/** Reply to batch-upsert by mapping every #temp id to a real id. */
function upsertEcho(prefix = 'R') {
  return (c: Call) => {
    if (!c.url.endsWith('/catalog/batch-upsert')) return undefined
    const mappings: any[] = []
    const objects = c.body.batches[0].objects.map((o: any) => {
      const fix = (id: string) => { if (!id.startsWith('#')) return id; const real = `${prefix}${id.slice(1)}`; mappings.push({ client_object_id: id, object_id: real }); return real }
      const itemId = fix(o.id)
      return { ...o, id: itemId, item_data: { ...o.item_data, variations: o.item_data.variations.map((v: any) => ({ ...v, id: fix(v.id) })) } }
    })
    return json(200, { objects, id_mappings: mappings })
  }
}

describe('square-api', () => {
  it('picks the host by environment and throws a plain error with Square\'s detail', async () => {
    expect(squareBaseUrl('production')).toBe('https://connect.squareup.com/v2')
    expect(squareBaseUrl('sandbox')).toBe('https://connect.squareupsandbox.com/v2')
    replies.push(() => json(400, { errors: [{ code: 'BAD', detail: 'Price is too low.' }] }))
    const err = await squareFetch('/catalog/list').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Square said: Price is too low.')
    expect(calls[0].url).toBe('https://connect.squareupsandbox.com/v2/catalog/list')
    expect(calls[0].headers['Square-Version']).toBe('2026-01-22')
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
  })
  it('falls back to the status when Square sends no detail', async () => {
    replies.push(() => new Response('oops', { status: 502 }))
    await expect(squareFetch('/x')).rejects.toThrow('Square answered with an error (502).')
  })
})

describe('variationPlan', () => {
  it('one variation per sold cell and per add-on, keys matching pricing', () => {
    expect(variationPlan(cls())).toEqual([
      { key: 'all:adult', name: 'Full series · Adult', cents: 6000 },
      { key: 'all:kid', name: 'Full series · Kid', cents: 4000 },
      { key: 'wk:adult', name: 'Weekend · Adult', cents: 2500 },
      { key: 'addon:glaze', name: 'Extra glaze (add-on)', cents: 500 },
    ])
  })
  it('a single pass shows just the ticket label', () => {
    const c = cls()
    c.content.passes = [c.content.passes[0]]
    c.content.prices = { all: { adult: 6000 } }
    c.content.addOns = []
    expect(variationPlan(c)).toEqual([{ key: 'all:adult', name: 'Adult', cents: 6000 }])
  })
})

describe('syncClassToSquare', () => {
  it('creates a REGULAR item in the Classes category with the tax and every variation', async () => {
    replies.push(upsertEcho())
    const sq = await syncClassToSquare(cls())
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url).toBe('https://connect.squareupsandbox.com/v2/catalog/batch-upsert')
    expect(call.method).toBe('POST')
    expect(call.headers['Square-Version']).toBe(SQUARE_API_VERSION)
    expect(typeof call.body.idempotency_key).toBe('string')
    const item = call.body.batches[0].objects[0]
    expect(item.type).toBe('ITEM')
    expect(item.id).toMatch(/^#/)
    expect(item.present_at_all_locations).toBe(true)
    expect(item.item_data).toMatchObject({
      name: 'Pottery · Sat Oct 17',
      product_type: 'REGULAR',
      categories: [{ id: 'CAT1' }],
      reporting_category: { id: 'CAT1' },
      tax_ids: ['TAX1'],
    })
    const vars = item.item_data.variations
    expect(vars.map((v: any) => [v.item_variation_data.name, v.item_variation_data.price_money])).toEqual([
      ['Full series · Adult', { amount: 6000, currency: 'USD' }],
      ['Full series · Kid', { amount: 4000, currency: 'USD' }],
      ['Weekend · Adult', { amount: 2500, currency: 'USD' }],
      ['Extra glaze (add-on)', { amount: 500, currency: 'USD' }],
    ])
    for (const v of vars) {
      expect(typeof v.item_variation_data.price_money.amount).toBe('number')
      expect(v.item_variation_data.pricing_type).toBe('FIXED_PRICING')
      expect(v.item_variation_data.item_id).toBe(item.id)
    }
    expect(sq.itemId).toMatch(/^R/)
    expect(Object.keys(sq.variations).sort()).toEqual(['addon:glaze', 'all:adult', 'all:kid', 'wk:adult'])
    expect(new Set(Object.values(sq.variations)).size).toBe(4)
  })

  it('leaves the tax off when the class is not taxable or no tax is set up', async () => {
    replies.push(upsertEcho())
    const c = cls(); c.content.rules.taxable = false
    await syncClassToSquare(c)
    expect(calls[0].body.batches[0].objects[0].item_data).not.toHaveProperty('tax_ids')
    cfg.classTaxId = ''
    await syncClassToSquare(cls())
    expect(calls[1].body.batches[0].objects[0].item_data).not.toHaveProperty('tax_ids')
  })

  it('refuses when the Classes category is not set up', async () => {
    cfg.classesCategoryId = ''
    await expect(syncClassToSquare(cls())).rejects.toThrow("Classes category isn't set up yet.")
    expect(calls).toHaveLength(0)
  })

  it('re-sync reuses ids by key, sends versions, and drops removed variations', async () => {
    const existing = {
      type: 'ITEM', id: 'ITEM1', version: 7,
      item_data: {
        name: 'old', image_ids: ['IMG1'],
        variations: [
          { type: 'ITEM_VARIATION', id: 'V_ALL_ADULT', version: 3 },
          { type: 'ITEM_VARIATION', id: 'V_ALL_KID', version: 4 },
          { type: 'ITEM_VARIATION', id: 'V_WK_ADULT', version: 5 },
          { type: 'ITEM_VARIATION', id: 'V_GLAZE', version: 6 },
        ],
      },
    }
    replies.push((c) => (c.method === 'GET' && c.url.includes('/catalog/object/ITEM1') ? json(200, { object: existing }) : undefined))
    replies.push(upsertEcho())
    const c = cls({ square: { itemId: 'ITEM1', variations: { 'all:adult': 'V_ALL_ADULT', 'all:kid': 'V_ALL_KID', 'wk:adult': 'V_WK_ADULT', 'addon:glaze': 'V_GLAZE' } } })
    delete c.content.prices.all.kid // kid seat no longer sold
    c.content.prices.wk.kid = 1500 // new cell
    const sq = await syncClassToSquare(c)
    const item = calls[1].body.batches[0].objects[0]
    expect(item.id).toBe('ITEM1')
    expect(item.version).toBe(7)
    expect(item.item_data.image_ids).toEqual(['IMG1'])
    const byName = Object.fromEntries(item.item_data.variations.map((v: any) => [v.item_variation_data.name, v]))
    expect(byName['Full series · Adult']).toMatchObject({ id: 'V_ALL_ADULT', version: 3 })
    expect(byName['Weekend · Adult']).toMatchObject({ id: 'V_WK_ADULT', version: 5 })
    expect(byName['Extra glaze (add-on)']).toMatchObject({ id: 'V_GLAZE', version: 6 })
    expect(byName['Weekend · Kid'].id).toMatch(/^#/)
    expect(item.item_data.variations.some((v: any) => v.id === 'V_ALL_KID')).toBe(false)
    expect(sq.itemId).toBe('ITEM1')
    expect(sq.variations).toEqual({ 'all:adult': 'V_ALL_ADULT', 'wk:adult': 'V_WK_ADULT', 'addon:glaze': 'V_GLAZE', 'wk:kid': expect.stringMatching(/^R/) })
  })

  it('makes a fresh item when the old one is gone from Square', async () => {
    replies.push((c) => (c.method === 'GET' ? json(404, { errors: [{ code: 'NOT_FOUND', detail: 'Object not found.' }] }) : undefined))
    replies.push(upsertEcho())
    const sq = await syncClassToSquare(cls({ square: { itemId: 'GONE', variations: { 'all:adult': 'OLD' } } }))
    const item = calls[1].body.batches[0].objects[0]
    expect(item.id).toMatch(/^#/)
    expect(item.item_data.variations.every((v: any) => v.id.startsWith('#'))).toBe(true)
    expect(sq.itemId).toMatch(/^R/)
  })

  it('a Square error becomes a plain error', async () => {
    replies.push(() => json(400, { errors: [{ code: 'INVALID_VALUE', detail: 'Invalid category.' }] }))
    await expect(syncClassToSquare(cls())).rejects.toThrow('Square said: Invalid category.')
  })

  it('uploads the image only when its URL changed, and remembers it', async () => {
    replies.push((c) => (c.url === 'https://site.test/img/bowl.png' ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } }) : undefined))
    replies.push((c) => (c.url.endsWith('/catalog/images') ? json(200, { image: { id: 'IMGNEW' } }) : undefined))
    replies.push(upsertEcho())
    const c = cls(); c.content.imageUrl = '/img/bowl.png'
    const sq = await syncClassToSquare(c)
    expect(sq.imageUrl).toBe('/img/bowl.png')
    const upload = calls.find((x) => x.url.endsWith('/catalog/images'))!
    expect(upload.method).toBe('POST')
    expect(upload.body).toBeInstanceOf(FormData)
    const req = JSON.parse(await (upload.body.get('request') as Blob).text())
    expect(req).toMatchObject({ object_id: sq.itemId, is_primary: true, image: { type: 'IMAGE' } })
    expect(upload.body.get('image_file')).toBeInstanceOf(Blob)
    expect(upload.headers['Content-Type']).toBeUndefined()

    // Same URL again: no fetch of the image, no upload.
    calls = []
    replies.unshift((x) => (x.method === 'GET' && x.url.includes('/catalog/object/') ? json(200, { object: { id: sq.itemId, version: 1, item_data: { variations: [] } } }) : undefined))
    const again = await syncClassToSquare({ ...c, square: sq })
    expect(calls.some((x) => x.url.endsWith('/catalog/images') || x.url.includes('bowl.png'))).toBe(false)
    expect(again.imageUrl).toBe('/img/bowl.png')
  })

  it('an image that fails to upload keeps the item and tries again next time', async () => {
    replies.push((c) => (c.url.includes('bowl.png') ? new Response('nope', { status: 404 }) : undefined))
    replies.push(upsertEcho())
    const c = cls(); c.content.imageUrl = 'https://cdn.test/bowl.png'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sq = await syncClassToSquare(c)
    expect(sq.itemId).toMatch(/^R/)
    expect(sq.imageUrl ?? null).toBeNull()
    warn.mockRestore()
  })
})

describe('archiveClassInSquare', () => {
  it('hides the item and its variations from every location, never deletes', async () => {
    const existing = {
      type: 'ITEM', id: 'ITEM1', version: 9, present_at_all_locations: true,
      item_data: { name: 'Pottery · Sat Oct 17', variations: [{ type: 'ITEM_VARIATION', id: 'V1', version: 2, present_at_all_locations: true, item_variation_data: { name: 'Adult' } }] },
    }
    replies.push((c) => (c.method === 'GET' && c.url.includes('/catalog/object/ITEM1') ? json(200, { object: existing }) : undefined))
    replies.push(upsertEcho())
    await archiveClassInSquare(cls({ square: { itemId: 'ITEM1', variations: { 'all:adult': 'V1' } } }))
    expect(calls.some((c) => c.method === 'DELETE' || c.url.includes('delete'))).toBe(false)
    const item = calls[1].body.batches[0].objects[0]
    expect(item).toMatchObject({ id: 'ITEM1', version: 9, present_at_all_locations: false, present_at_location_ids: [] })
    expect(item.item_data.name).toBe('Pottery · Sat Oct 17')
    expect(item.item_data.variations[0]).toMatchObject({ id: 'V1', version: 2, present_at_all_locations: false, present_at_location_ids: [] })
  })
  it('does nothing for a class with no POS item', async () => {
    await archiveClassInSquare(cls())
    expect(calls).toHaveLength(0)
  })
})

describe('classIdFromVariation', () => {
  const a = cls({ id: 'cls_a', square: { itemId: 'I1', variations: { 'all:adult': 'VA' } } })
  const b = cls({ id: 'cls_b', square: { itemId: 'I2', variations: { 'addon:glaze': 'VB' } } })
  it('finds the class and key', () => {
    expect(classIdFromVariation('VB', [a, b])).toEqual({ classId: 'cls_b', key: 'addon:glaze' })
  })
  it('misses cleanly', () => {
    expect(classIdFromVariation('NOPE', [a, b])).toBeNull()
  })
})
