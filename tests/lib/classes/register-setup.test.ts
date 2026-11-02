// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** In-memory blob store with real etags (compare-and-set really tested). */
const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const state = { down: false }
  const store = {
    async get(key: string) { if (state.down) throw new Error('blobs down'); return data.get(key)?.value ?? null },
    async set(key: string, value: string) { data.set(key, { value, etag: `e${++n}` }) },
    async getWithMeta(key: string) { const hit = data.get(key); return { value: hit?.value ?? null, etag: hit?.etag ?? null } },
    async setIfMatch(key: string, value: string, etag: string | null, exists: boolean) {
      const cur = data.get(key)
      if (!exists ? cur : cur?.etag !== etag) return false
      data.set(key, { value, etag: `e${++n}` })
      return true
    },
    async list() { return [...data.keys()] },
  }
  return { data, state, store }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => fake.store }))

const sq = vi.hoisted(() => ({
  env: { environment: 'sandbox', classTaxId: 'ENV_TAX', classesCategoryId: 'ENV_CAT' } as Record<string, string>,
  objects: [] as any[],
  calls: [] as { path: string; body?: any }[],
  fail: null as null | Error,
}))
vi.mock('@lib/classes/square-api', () => ({
  squareSettings: () => sq.env,
  squareFetch: async (path: string, init: any = {}) => {
    sq.calls.push({ path, body: init.body ? JSON.parse(init.body) : undefined })
    if (sq.fail) throw sq.fail
    if (path.startsWith('/catalog/list')) return { objects: sq.objects }
    if (path === '/catalog/batch-upsert') {
      const obj = JSON.parse(init.body).batches[0].objects[0]
      return { id_mappings: [{ client_object_id: obj.id, object_id: `NEW_${obj.type}` }] }
    }
    throw new Error(`unexpected ${path}`)
  },
}))
const deploy = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => deploy.context, isPreviewOrDev: () => deploy.context !== 'production' }))

import {
  ensureClassesCategory, ensureClassTax, getRegisterSetupView, isSquareConnectionError, listRegisterChoices, registerIds,
  resetRegisterCache, saveRegisterSetup, StaleRegisterSetupError,
} from '@lib/classes/register-setup'

const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const tax = (id: string, over: any = {}) => ({ type: 'TAX', id, tax_data: { name: 'Sales tax', percentage: '9', enabled: true, inclusion_type: 'ADDITIVE', ...over } })
const cat = (id: string, name: string) => ({ type: 'CATEGORY', id, category_data: { name } })

beforeEach(() => {
  fake.data.clear(); fake.state.down = false
  sq.env = { environment: 'sandbox', classTaxId: 'ENV_TAX', classesCategoryId: 'ENV_CAT' }
  sq.objects = []; sq.calls = []; sq.fail = null
  deploy.context = 'dev'
  resetRegisterCache()
})
afterEach(() => vi.unstubAllEnvs())

describe('Register setup: which tax and category classes use', () => {
  it('until an owner saves, the site’s values are used (production behaves as before)', async () => {
    expect(await registerIds()).toEqual({ classTaxId: 'ENV_TAX', classesCategoryId: 'ENV_CAT' })
    expect((await getRegisterSetupView()).source).toEqual({ tax: 'site', category: 'site' })
  })

  it('lists the taxes in words; only an on, added-on-top 9% tax can be picked, the rest say why', async () => {
    sq.objects = [tax('T9'), tax('T8', { percentage: '8.5', name: 'Café tax' }), tax('TOFF', { enabled: false }), tax('TIN', { inclusion_type: 'INCLUSIVE' }), cat('C1', 'Classes'), cat('C2', 'Party Crafts')]
    const c = await listRegisterChoices()
    // The one that can be picked comes first.
    expect(c.taxes[0].id).toBe('T9')
    expect(Object.fromEntries(c.taxes.map((t) => [t.id, [t.usable, t.why]]))).toEqual({
      T9: [true, ''],
      T8: [false, 'This tax isn’t 9%, so online prices wouldn’t match the register.'],
      TIN: [false, 'This tax is already inside the prices, so online prices wouldn’t match the register.'],
      TOFF: [false, 'This tax is turned off.'],
    })
    expect(c.categories.map((x) => x.name)).toEqual(['Classes', 'Party Crafts'])
  })

  it('a save is checked against Square, stored compare-and-set with history, and wins over the site values at once', async () => {
    sq.objects = [tax('T9'), cat('C1', 'Classes')]
    const { saved, changed } = await saveRegisterSetup({ classTaxId: 'T9', classesCategoryId: 'C1' }, { expectedUpdatedAt: null, by: KADEN })
    expect(changed).toEqual(['Class tax: Sales tax 9%', 'Classes category: Classes'])
    expect(saved.history[0]).toMatchObject({ by: KADEN, before: { classTaxId: 'ENV_TAX', classesCategoryId: 'ENV_CAT' } })
    expect(await registerIds()).toEqual({ classTaxId: 'T9', classesCategoryId: 'C1' })
    expect((await getRegisterSetupView()).source).toEqual({ tax: 'saved', category: 'saved' })
    // A second sheet still holding the first copy is refused, with what's there now.
    await expect(saveRegisterSetup({ classTaxId: 'T9', classesCategoryId: 'C1' }, { expectedUpdatedAt: null, by: KADEN })).rejects.toBeInstanceOf(StaleRegisterSetupError)
  })

  it('refuses a tax that isn’t 9%, one that’s gone, and a missing category; nothing is stored', async () => {
    sq.objects = [tax('T8', { percentage: '8' }), cat('C1', 'Classes')]
    await expect(saveRegisterSetup({ classTaxId: 'T8', classesCategoryId: 'C1' }, { expectedUpdatedAt: null, by: KADEN })).rejects.toMatchObject({ status: 400, field: 'tax' })
    await expect(saveRegisterSetup({ classTaxId: 'GONE', classesCategoryId: 'C1' }, { expectedUpdatedAt: null, by: KADEN })).rejects.toMatchObject({ message: 'That tax isn’t on the register any more. Pick another.' })
    await expect(saveRegisterSetup({ classTaxId: 'T8', classesCategoryId: '' }, { expectedUpdatedAt: null, by: KADEN })).rejects.toMatchObject({ field: 'category' })
    expect(fake.data.size).toBe(0)
  })

  it('a store that can’t be read falls back to the last answer, else the site values', async () => {
    fake.state.down = true
    expect(await registerIds({ fresh: true })).toEqual({ classTaxId: 'ENV_TAX', classesCategoryId: 'ENV_CAT' })
  })

  it('"Make the 9% class tax": the one already there is returned with no write; else one guarded create with a fixed key', async () => {
    sq.objects = [tax('T9')]
    expect(await ensureClassTax()).toEqual({ id: 'T9', made: false })
    expect(sq.calls.some((c) => c.path === '/catalog/batch-upsert')).toBe(false)
    sq.objects = [tax('T8', { percentage: '8' })]
    expect(await ensureClassTax()).toEqual({ id: 'NEW_TAX', made: true })
    const up = sq.calls.find((c) => c.path === '/catalog/batch-upsert')!.body
    expect(up.batches[0].objects[0].tax_data).toMatchObject({ name: 'Sales tax', percentage: '9', inclusion_type: 'ADDITIVE', enabled: true })
    const key = up.idempotency_key
    await ensureClassTax()
    expect(sq.calls.filter((c) => c.path === '/catalog/batch-upsert').map((c) => c.body.idempotency_key)).toEqual([key, key])
  })

  it('"Make the Classes category": reuses one named Classes, else makes it', async () => {
    sq.objects = [cat('C1', ' classes ')]
    expect(await ensureClassesCategory()).toEqual({ id: 'C1', made: false })
    sq.objects = []
    expect(await ensureClassesCategory()).toEqual({ id: 'NEW_CATEGORY', made: true })
  })

  it('R39/N3: a test site pointed at the live Square never makes anything there', async () => {
    deploy.context = 'deploy-preview'
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    sq.env = { ...sq.env, environment: 'production' }
    await expect(ensureClassTax()).rejects.toThrow('This test site uses the live Square')
    expect(sq.calls.some((c) => c.path === '/catalog/batch-upsert')).toBe(false)
  })

  it('an expired or revoked token is told apart from any other Square refusal', () => {
    expect(isSquareConnectionError(Object.assign(new Error('x'), { status: 401, errors: [{ code: 'ACCESS_TOKEN_EXPIRED' }] }))).toBe(true)
    expect(isSquareConnectionError(Object.assign(new Error('x'), { status: 403, errors: [{ code: 'INSUFFICIENT_SCOPES' }] }))).toBe(true)
    expect(isSquareConnectionError(Object.assign(new Error('x'), { status: 400, errors: [{ code: 'INVALID_VALUE', category: 'INVALID_REQUEST_ERROR' }] }))).toBe(false)
    expect(isSquareConnectionError(new Error('timeout'))).toBe(false)
  })

  it('N7: a tax added on top of other taxes, or not used at the studio’s location, can’t be picked', async () => {
    sq.env = { ...sq.env, locationId: 'LOC' }
    sq.objects = [
      tax('COMPOUND', { calculation_phase: 'TAX_TOTAL_PHASE' }),
      { ...tax('ELSEWHERE'), present_at_all_locations: false, present_at_location_ids: ['OTHER'] },
      { ...tax('ABSENT'), absent_at_location_ids: ['LOC'] },
      { ...tax('HERE'), present_at_all_locations: false, present_at_location_ids: ['LOC'] },
    ]
    const { taxes } = await listRegisterChoices()
    const by = Object.fromEntries(taxes.map((t) => [t.id, t]))
    expect(by.COMPOUND).toMatchObject({ usable: false, why: 'This tax is added on top of other taxes, so online prices wouldn’t match the register.' })
    expect(by.ELSEWHERE).toMatchObject({ usable: false, why: 'This tax isn’t used at the studio’s register.' })
    expect(by.ABSENT).toMatchObject({ usable: false, why: 'This tax isn’t used at the studio’s register.' })
    expect(by.HERE).toMatchObject({ usable: true })
    await expect(saveRegisterSetup({ classTaxId: 'COMPOUND', classesCategoryId: 'x' }, { expectedUpdatedAt: null, by: KADEN })).rejects.toMatchObject({ field: 'tax' })
  })
})

