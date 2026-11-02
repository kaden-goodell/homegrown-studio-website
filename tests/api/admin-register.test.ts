// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  return {
    data,
    store: {
      async get(key: string) { return data.get(key)?.value ?? null },
      async set(key: string, value: string) { data.set(key, { value, etag: `e${++n}` }) },
      async getWithMeta(key: string) { const hit = data.get(key); return { value: hit?.value ?? null, etag: hit?.etag ?? null } },
      async setIfMatch(key: string, value: string, etag: string | null, exists: boolean) {
        const cur = data.get(key)
        if (!exists ? cur : cur?.etag !== etag) return false
        data.set(key, { value, etag: `e${++n}` })
        return true
      },
      async list() { return [...data.keys()] },
    },
  }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => fake.store }))
const sq = vi.hoisted(() => ({ objects: [] as any[], fail: null as null | Error, upserts: 0 }))
vi.mock('@lib/classes/square-api', () => ({
  squareSettings: () => ({ environment: 'sandbox', classTaxId: '', classesCategoryId: '' }),
  squareFetch: async (path: string, init: any = {}) => {
    if (sq.fail) throw sq.fail
    if (path.startsWith('/catalog/list')) return { objects: sq.objects }
    if (path === '/catalog/batch-upsert') {
      sq.upserts++
      const obj = JSON.parse(init.body).batches[0].objects[0]
      sq.objects.push({ ...obj, id: `NEW_${obj.type}` })
      return { id_mappings: [{ client_object_id: obj.id, object_id: `NEW_${obj.type}` }] }
    }
    throw new Error(path)
  },
}))
const classes = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/classes/class-store', async (orig) => ({ ...(await orig<object>()), listClasses: async () => classes.list }))
const audits = vi.hoisted(() => vi.fn(async (_: any) => undefined))
vi.mock('@lib/audit', () => ({ recordAudit: audits }))

import * as route from '@pages/api/admin/register.json'
import { adminCookie } from '@lib/admin-auth'
import { registerIds, resetRegisterCache } from '@lib/classes/register-setup'

const call = async (method: 'GET' | 'POST', body?: unknown, signedIn = true) => {
  const request = new Request('https://x.test/api/admin/register.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(signedIn ? { cookie: adminCookie().split(';')[0] } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request } as any)
  return { status: res.status, body: await res.json() }
}

const future = { id: 's', startIso: '2099-01-10T18:00:00Z', endIso: '2099-01-10T20:00:00Z', capacity: 10 }
const offRegister = {
  id: 'cls_off', status: 'open', sessions: [future], square: { itemId: null, variations: {} },
  content: { name: 'Clay Camp', ticketTypes: [{ id: 'p', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }], prices: { all: { p: 2000 } }, addOns: [] },
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  fake.data.clear(); sq.objects = []; sq.fail = null; sq.upserts = 0; classes.list = []
  audits.mockClear(); resetRegisterCache()
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/admin/register.json (More › Register setup)', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, false)).status).toBe(401)
    expect((await call('POST', { action: 'create-tax' }, false)).status).toBe(401)
    expect(sq.upserts).toBe(0)
  })

  it('GET: what is in force, what Square has, and the classes not on the register yet', async () => {
    sq.objects = [{ type: 'TAX', id: 'T9', tax_data: { name: 'Sales tax', percentage: '9', enabled: true, inclusion_type: 'ADDITIVE' } }]
    classes.list = [offRegister]
    const r = await call('GET')
    expect(r.status).toBe(200)
    expect(r.body.data.setup.source).toEqual({ tax: 'none', category: 'none' })
    expect(r.body.data.choices.taxes[0]).toMatchObject({ id: 'T9', usable: true })
    expect(r.body.data.notOnRegister).toEqual([{ id: 'cls_off', name: 'Clay Camp', startIso: future.startIso }])
  })

  it('GET with an expired token: the page still loads and says the connection isn’t working (no Netlify)', async () => {
    sq.fail = Object.assign(new Error('x'), { status: 401, errors: [{ code: 'ACCESS_TOKEN_EXPIRED' }] })
    const r = await call('GET')
    expect(r.body.data).toMatchObject({ choices: null, choicesError: 'The website can’t reach Square right now, so this can’t change from here. The register still works: ring the class up at the price on its class page, as a custom amount if it isn’t listed.', connection: true })
  })

  it('make the tax, make the category, save: audited, used at once; a second make writes nothing', async () => {
    const t = await call('POST', { action: 'create-tax' })
    expect(t.body.data).toMatchObject({ id: 'NEW_TAX', made: true })
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'register-create-tax' }))
    expect((await call('POST', { action: 'create-tax' })).body.data).toMatchObject({ id: 'NEW_TAX', made: false })
    expect(sq.upserts).toBe(1)
    const c = await call('POST', { action: 'create-category' })
    expect(c.body.data.id).toBe('NEW_CATEGORY')
    const s = await call('POST', { action: 'save', classTaxId: 'NEW_TAX', classesCategoryId: 'NEW_CATEGORY', expectedUpdatedAt: null })
    expect(s.status).toBe(200)
    expect(s.body.data.setup).toMatchObject({ classTaxId: 'NEW_TAX', classesCategoryId: 'NEW_CATEGORY', source: { tax: 'saved', category: 'saved' } })
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'register-setup', by: expect.objectContaining({ name: 'Catherine' }) }))
    expect(await registerIds()).toEqual({ classTaxId: 'NEW_TAX', classesCategoryId: 'NEW_CATEGORY' })
    // A sheet that loaded before this save is refused, with what's there now.
    const stale = await call('POST', { action: 'save', classTaxId: 'NEW_TAX', classesCategoryId: 'NEW_CATEGORY', expectedUpdatedAt: null })
    expect(stale).toMatchObject({ status: 409, body: { stale: true, current: { classTaxId: 'NEW_TAX' } } })
  })

  it('a tax that isn’t 9% is refused on the field', async () => {
    sq.objects = [
      { type: 'TAX', id: 'T8', tax_data: { name: 'Café tax', percentage: '8', enabled: true, inclusion_type: 'ADDITIVE' } },
      { type: 'CATEGORY', id: 'C1', category_data: { name: 'Classes' } },
    ]
    const r = await call('POST', { action: 'save', classTaxId: 'T8', classesCategoryId: 'C1', expectedUpdatedAt: null })
    expect(r).toMatchObject({ status: 400, body: { field: 'tax', error: 'This tax isn’t 9%, so online prices wouldn’t match the register.' } })
  })

  it('N9: a make retried after a lost reply (the tax is there now, but the sheet never saw it) is still audited once', async () => {
    sq.objects = [{ type: 'TAX', id: 'NEW_TAX', tax_data: { name: 'Sales tax', percentage: '9', enabled: true, inclusion_type: 'ADDITIVE' } }]
    const r = await call('POST', { action: 'create-tax', seen: [] })
    expect(r.body.data).toMatchObject({ id: 'NEW_TAX', made: false })
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'register-create-tax', details: expect.objectContaining({ squareId: 'NEW_TAX', note: expect.stringMatching(/lost reply/) }) }))
    audits.mockClear()
    // One she could see already: picked, not audited as made.
    await call('POST', { action: 'create-tax', seen: ['NEW_TAX'] })
    expect(audits).not.toHaveBeenCalled()
    expect(sq.upserts).toBe(0)
  })

  it('fix 4: GET lists the classes on the old tax; Update them all is stopped by a wrong tax, in words with no "Open More"', async () => {
    sq.objects = [
      { type: 'TAX', id: 'T9', tax_data: { name: 'Sales tax', percentage: '9', enabled: true, inclusion_type: 'ADDITIVE' } },
      { type: 'CATEGORY', id: 'C1', category_data: { name: 'Classes' } },
    ]
    await call('POST', { action: 'save', classTaxId: 'T9', classesCategoryId: 'C1', expectedUpdatedAt: null })
    const onOld = { ...offRegister, id: 'cls_old', square: { itemId: 'I', variations: { 'all:p': 'V' }, taxId: 'OLD', categoryId: 'C1' }, content: { ...offRegister.content, rules: { taxable: true } } }
    classes.list = [onOld]
    const g = await call('GET')
    expect(g.body.data.oldSetup).toEqual([{ id: 'cls_old', name: 'Clay Camp', startIso: future.startIso }])
    // The 9% tax is deleted in Square after the save.
    sq.objects = sq.objects.filter((o) => o.id !== 'T9')
    const u = await call('POST', { action: 'update-classes' })
    expect(u).toMatchObject({ status: 503, body: { field: 'tax', error: 'The class tax in Register setup isn’t on the register any more. Pick the 9% tax above.' } })
    expect(audits).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'class-update-register' }))
  })

  it('fix 4: Update them all with nothing to do answers nothing left', async () => {
    const u = await call('POST', { action: 'update-classes' })
    expect(u).toMatchObject({ status: 200, body: { data: { updated: 0, failed: [], left: 0, oldSetup: [] } } })
  })
})

