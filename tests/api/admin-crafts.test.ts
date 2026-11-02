// @vitest-environment node
// /admin › More › Crafts (G6): list, add, change, photo, hide/show, with a fake Square (raw REST) behind it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { partyConfig } from '@config/party.config'

const sq = partyConfig.square
const CAT = sq.partyCraftCategoryId

const h = vi.hoisted(() => ({
  objects: new Map<string, any>(),
  calls: [] as { path: string; method: string; body: any }[],
  env: 'sandbox' as string,
  context: 'production' as string,
  audit: [] as any[],
  parties: [] as any[],
  seq: 0,
}))

/** A small Square catalog: list, get, batch-upsert (with versions) and images. */
async function fakeSquare(path: string, init: RequestInit = {}): Promise<any> {
  const method = init.method ?? 'GET'
  const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null
  h.calls.push({ path, method, body })
  const fail = (status: number, detail: string) => { throw Object.assign(new Error(`Square said: ${detail}`), { status }) }
  if (path.startsWith('/catalog/list')) {
    const types = new URLSearchParams(path.split('?')[1]).get('types')!.split(',')
    return { objects: [...h.objects.values()].filter((o) => types.includes(o.type)) }
  }
  if (path.startsWith('/catalog/object/')) {
    const o = h.objects.get(decodeURIComponent(path.slice('/catalog/object/'.length)))
    if (!o) fail(404, 'not found')
    return { object: structuredClone(o) }
  }
  if (path === '/catalog/batch-upsert') {
    const ids: { client_object_id: string; object_id: string }[] = []
    const saved: any[] = []
    const real = (id: string) => ids.find((m) => m.client_object_id === id)?.object_id ?? id
    for (const raw of body.batches[0].objects) {
      const o = structuredClone(raw)
      if (o.id.startsWith('#')) { const id = `ITEM${++h.seq}`; ids.push({ client_object_id: o.id, object_id: id }); o.id = id }
      else {
        const cur = h.objects.get(o.id)
        if (cur && cur.version !== o.version) fail(400, 'Object version does not match latest database version.')
      }
      o.version = (h.objects.get(o.id)?.version ?? 0) + 1
      const d = o.item_data
      if (d) {
        for (const v of d.variations ?? []) {
          if (v.id.startsWith('#')) { const id = `VAR${++h.seq}`; ids.push({ client_object_id: v.id, object_id: id }); v.id = id }
          v.item_variation_data.item_id = real(v.item_variation_data.item_id)
        }
        // Square derives the plain copy from `description`.
        if (d.description !== undefined && d.description_plaintext === undefined) { d.description_plaintext = d.description; d.description_html = `<p>${d.description}</p>` }
      }
      h.objects.set(o.id, o)
      saved.push(structuredClone(o))
    }
    return { objects: saved, id_mappings: ids }
  }
  if (path === '/catalog/images') {
    const req = JSON.parse(await (body.get('request') as Blob).text())
    const id = `IMG${++h.seq}`
    h.objects.set(id, { type: 'IMAGE', id, image_data: { url: `https://cdn.test/${id}.jpg`, caption: req.image.image_data.caption } })
    const item = h.objects.get(req.object_id)
    item.item_data.image_ids = req.is_primary ? [id, ...(item.item_data.image_ids ?? [])] : [...(item.item_data.image_ids ?? []), id]
    item.version += 1
    return { image: { id } }
  }
  throw new Error(`unexpected ${method} ${path}`)
}

vi.mock('@lib/classes/square-api', () => ({ squareFetch: (p: string, i?: RequestInit) => fakeSquare(p, i), squareSettings: () => ({ environment: h.env }) }))
vi.mock('@lib/deploy-context', async (orig) => ({ ...(await orig<typeof import('@lib/deploy-context')>()), deployContext: () => h.context }))
vi.mock('@lib/audit', async (orig) => ({ ...(await orig<typeof import('@lib/audit')>()), recordAudit: vi.fn(async (e: any) => { h.audit.push(e) }) }))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<typeof import('@lib/party-store')>()), listParties: async () => h.parties }))

import * as route from '@pages/api/admin/crafts.json'
import { adminCookie } from '@lib/admin-auth'
import { makeKvStore } from '@lib/blob-store'
import { STALE } from '@lib/crafts/craft-admin'
import { getHiddenCraftIds } from '@lib/crafts/craft-settings'

const cookie = () => adminCookie().split(';')[0]
async function call(body?: unknown, signedIn = true) {
  const request = new Request('https://x.test/api/admin/crafts.json', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(signedIn ? { cookie: cookie() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res: Response = await (body === undefined ? route.GET : route.POST)({ request } as any)
  return { status: res.status, body: await res.json() }
}

const item = (id: string, name: string, extra: string[] = [], over: any = {}) => ({
  type: 'ITEM', id, version: 5, present_at_all_locations: true, updated_at: '2026-10-01T00:00:00Z',
  item_data: {
    name, description: `${name} words`, description_plaintext: `${name} words`, description_html: `<p>${name} words</p>`, product_type: 'REGULAR',
    categories: [{ id: CAT }, ...extra.map((c) => ({ id: c }))], reporting_category: { id: CAT }, image_ids: [],
    variations: [{ type: 'ITEM_VARIATION', id: `${id}_V`, version: 5, item_variation_data: { item_id: id, name: 'Per Guest', pricing_type: 'FIXED_PRICING', price_money: { amount: 1800, currency: 'USD' } } }],
    ...over,
  },
})

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STORE_NAMESPACE', '')
  h.env = 'sandbox'
  h.context = 'production'
  h.calls.length = 0
  h.audit.length = 0
  h.parties = []
  h.objects = new Map<string, any>([
    [CAT, { type: 'CATEGORY', id: CAT, category_data: { name: 'Party Crafts' } }],
    ...[sq.personalizedCategoryId, sq.popularCategoryId, sq.partyOnlyCategoryId, sq.cafeOnlyCategoryId].map((id) => [id, { type: 'CATEGORY', id, category_data: { name: id } }] as [string, any]),
    ['KEY', item('KEY', 'Keychain Bar', [sq.popularCategoryId])],
    ['EAR', item('EAR', 'Earring Bar', [sq.cafeOnlyCategoryId])],
    ['OTHER', { type: 'ITEM', id: 'OTHER', version: 1, item_data: { name: 'Coffee', categories: [{ id: 'CAFE_DRINKS' }], variations: [] } }],
  ])
})

describe('GET: the crafts in the party craft category', () => {
  it('owners only', async () => {
    expect((await call(undefined, false)).status).toBe(401)
    expect((await call({ action: 'create' }, false)).status).toBe(401)
  })
  it('lists them A to Z with price, badges and where offered; nothing outside the category', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.body.data.crafts.map((c: any) => c.name)).toEqual(['Earring Bar', 'Keychain Bar'])
    expect(r.body.data.crafts[1]).toMatchObject({ id: 'KEY', version: 5, popular: true, where: 'both', sizes: [{ id: 'KEY_V', cents: 1800 }], imageUrl: null, hidden: false })
    expect(r.body.data.crafts[0].where).toBe('cafe')
    expect(r.body.data.markers).toEqual({ personalized: true, popular: true, where: true })
    expect(r.body.data.refusal).toBeNull()
  })
  it('a Square without the badge categories (the sandbox) hides those switches', async () => {
    for (const id of [sq.personalizedCategoryId, sq.popularCategoryId, sq.partyOnlyCategoryId, sq.cafeOnlyCategoryId]) h.objects.delete(id)
    expect((await call()).body.data.markers).toEqual({ personalized: false, popular: false, where: false })
  })
})

describe('Add a craft', () => {
  const add = (over: any = {}) => call({ action: 'create', requestId: 'req-12345678', name: 'Bubble Letter Keychains', description: 'Spell any word.\n\nEveryone picks.\n\nAges 8 and up.', cents: 1500, ...over })
  it('creates the item the way add-party-craft makes it, audited', async () => {
    const r = await add({ personalized: true, where: 'parties' })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toBe('Added Bubble Letter Keychains. The website shows it within a minute.')
    const up = h.calls.find((c) => c.path === '/catalog/batch-upsert')!
    expect(up.body.idempotency_key).toMatch(/^craft-create:req-12345678:/)
    const obj = up.body.batches[0].objects[0]
    expect(obj).toMatchObject({ type: 'ITEM', id: '#craft', item_data: { name: 'Bubble Letter Keychains', product_type: 'REGULAR', reporting_category: { id: CAT }, description: 'Spell any word.\n\nEveryone picks.\n\nAges 8 and up.' } })
    expect(obj.item_data.categories).toEqual([{ id: CAT }, { id: sq.personalizedCategoryId }, { id: sq.partyOnlyCategoryId }])
    expect(obj.item_data.variations[0].item_variation_data).toMatchObject({ item_id: '#craft', name: 'Per Guest', pricing_type: 'FIXED_PRICING', price_money: { amount: 1500, currency: 'USD' } })
    expect(r.body.data.craft).toMatchObject({ name: 'Bubble Letter Keychains', personalized: true, where: 'parties' })
    expect(h.audit).toEqual([expect.objectContaining({ action: 'craft-create', by: expect.objectContaining({ name: 'Catherine', role: 'owner' }) })])
  })
  it('a double tap (same form) makes one craft, audited once', async () => {
    await add({ requestId: 'req-dbl-0001' })
    const again = await add({ requestId: 'req-dbl-0001' })
    expect(again.status).toBe(200)
    expect([...h.objects.values()].filter((o) => o.item_data?.name === 'Bubble Letter Keychains')).toHaveLength(1)
    expect(h.calls.filter((c) => c.path === '/catalog/batch-upsert')).toHaveLength(1)
    expect(h.audit).toHaveLength(1)
  })
  it('a name already used, no name, or no price is refused with what to fix', async () => {
    expect(await add({ requestId: 'req-name-0001', name: 'keychain bar' })).toMatchObject({ status: 409, body: { error: 'There’s already a craft called keychain bar.', field: 'name' } })
    expect((await add({ requestId: 'req-name-0002', name: ' ' })).body.field).toBe('name')
    expect((await add({ requestId: 'req-name-0003', cents: 0 })).body.field).toBe('price')
    expect(h.calls.some((c) => c.path === '/catalog/batch-upsert')).toBe(false)
  })
  it('Most popular moves to the new craft in the same save', async () => {
    await add({ requestId: 'req-pop-00001', popular: true })
    const objs = h.calls.find((c) => c.path === '/catalog/batch-upsert')!.body.batches[0].objects
    expect(objs).toHaveLength(2)
    expect(objs[1].id).toBe('KEY')
    expect(objs[1].item_data.categories.map((c: any) => c.id)).not.toContain(sq.popularCategoryId)
    expect(h.objects.get('KEY').item_data.description).toBe('Keychain Bar words') // nothing else on it changed
  })
  it('the photo (from our own photo store) goes up as the card photo', async () => {
    const id = 'a'.repeat(24)
    await makeKvStore('class-photos', 'class-photos').set(`photo-${id}`, JSON.stringify({ type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 1, 2]).toString('base64') }))
    const r = await add({ requestId: 'req-photo-001', photoUrl: `https://x.test/api/admin/classes/photo.json?id=${id}` })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    const img = h.calls.find((c) => c.path === '/catalog/images')!
    const req = JSON.parse(await (img.body.get('request') as Blob).text())
    expect(req).toMatchObject({ is_primary: true, image: { type: 'IMAGE', image_data: { caption: 'card' } } })
    expect(r.body.data.craft.imageUrl).toMatch(/^https:\/\/cdn\.test\/IMG/)
  })
  it('a photo address from anywhere else is never fetched: the craft is saved and it says to choose the photo again', async () => {
    const r = await add({ requestId: 'req-photo-002', photoUrl: 'https://evil.test/x.jpg' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe('The craft is saved, but the photo didn’t go up. Open it and choose the photo again.')
    expect(h.calls.some((c) => c.path === '/catalog/images')).toBe(false)
  })
})

describe('Change a craft', () => {
  it('sends the whole item back with only what changed; the words only when they changed', async () => {
    const r = await call({ action: 'update', id: 'KEY', version: 5, cents: 2000 })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toBe('Saved. New bookings and the register use the new price. Crafts are paid at the studio, so nothing already booked changes.')
    const sent = h.calls.find((c) => c.path === '/catalog/batch-upsert')!.body.batches[0].objects[0]
    expect(sent.version).toBe(5)
    expect(sent.updated_at).toBeUndefined()
    // Unchanged words go back exactly as Square had them (Square clears a re-sent plain description).
    expect(sent.item_data).toMatchObject({ description: 'Keychain Bar words', description_plaintext: 'Keychain Bar words', description_html: '<p>Keychain Bar words</p>' })
    expect(sent.item_data.variations[0].item_variation_data.price_money).toEqual({ amount: 2000, currency: 'USD' })
    expect(sent.item_data.categories).toEqual([{ id: CAT }, { id: sq.popularCategoryId }])
    expect(h.audit[0]).toMatchObject({ action: 'craft-update', target: { id: 'KEY', label: 'Keychain Bar' }, details: { cents: 2000 } })
  })
  it('new words: description sent, the old HTML and plain copies dropped', async () => {
    await call({ action: 'update', id: 'KEY', version: 5, description: 'New words.' })
    const sent = h.calls.find((c) => c.path === '/catalog/batch-upsert')!.body.batches[0].objects[0]
    expect(sent.item_data.description).toBe('New words.')
    expect(sent.item_data).not.toHaveProperty('description_html')
    expect(sent.item_data).not.toHaveProperty('description_plaintext')
  })
  it('someone changed it since she opened it: refused, nothing written', async () => {
    const r = await call({ action: 'update', id: 'KEY', version: 4, cents: 2000 })
    expect(r).toMatchObject({ status: 409, body: { error: STALE, stale: true } })
    expect(h.calls.some((c) => c.path === '/catalog/batch-upsert')).toBe(false)
  })
  it('nothing changed: no write, says so', async () => {
    const r = await call({ action: 'update', id: 'KEY', version: 5, cents: 1800, description: 'Keychain Bar words' })
    expect(r.body.data.message).toBe('Nothing changed.')
    expect(h.calls.some((c) => c.path === '/catalog/batch-upsert')).toBe(false)
    expect(h.audit).toHaveLength(0)
  })
  it('where it’s offered swaps the marker categories', async () => {
    await call({ action: 'update', id: 'EAR', version: 5, where: 'both' })
    expect(h.objects.get('EAR').item_data.categories).toEqual([{ id: CAT }])
  })
  it('a craft outside the category is not touched', async () => {
    expect((await call({ action: 'update', id: 'OTHER', version: 1, cents: 100 })).status).toBe(404)
  })
})

describe('Hide on website / Show on website', () => {
  it('ours only (no Square write), audited, and it says which parties keep it', async () => {
    h.parties = [{ bookingId: 'pty_1', status: 'booked', craftId: 'KEY', craftName: 'Keychain Bar', startIso: '2099-01-01T19:00:00Z', durationMinutes: 90 }]
    const r = await call({ action: 'hide', id: 'KEY' })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toBe('Keychain Bar is off the website. 1 party still to come picked it. It keeps it, and it stays on the register.')
    expect((await getHiddenCraftIds()).has('KEY')).toBe(true)
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false)
    expect((await call()).body.data.crafts.find((c: any) => c.id === 'KEY').hidden).toBe(true)
    expect((await call({ action: 'show', id: 'KEY' })).body.data.message).toBe('Keychain Bar is back on the website.')
    expect((await getHiddenCraftIds()).has('KEY')).toBe(false)
    expect(h.audit.map((a) => a.action)).toEqual(['craft-hide', 'craft-show'])
  })
})

describe('guards', () => {
  it('a test site pointed at the live Square can look but not change (N3)', async () => {
    h.context = 'deploy-preview'
    h.env = 'production'
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    const r = await call()
    expect(r.body.data.refusal).toMatch(/live Square/)
    expect((await call({ action: 'create', requestId: 'req-guard-001', name: 'X', cents: 100 })).status).toBe(403)
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false)
  })
  it('a test site with no store of its own changes nothing (R41)', async () => {
    h.context = 'deploy-preview'
    expect((await call({ action: 'hide', id: 'KEY' })).status).toBe(403)
    expect((await call({ action: 'update', id: 'KEY', version: 5, cents: 2000 })).status).toBe(403)
  })
})
