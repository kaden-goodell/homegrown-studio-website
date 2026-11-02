// @vitest-environment node
/**
 * Fix round 4: a class records the tax and category its register item carries;
 * when More › Register setup changes, "Update the register" (one class) and
 * "Update them all" (Register setup) send the new ones. Square, the class store
 * and the audit log are mocked; nothing live.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const store = {
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
  }
  return { data, store }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => fake.store }))

const sq = vi.hoisted(() => ({
  env: { environment: 'sandbox', classTaxId: 'OLD_TAX', classesCategoryId: 'C1', locationId: 'LOC' } as Record<string, string>,
  objects: [] as any[],
}))
vi.mock('@lib/classes/square-api', () => ({
  squareSettings: () => sq.env,
  squareFetch: async (path: string) => {
    if (path.startsWith('/catalog/list')) return { objects: sq.objects }
    throw new Error(`unexpected ${path}`)
  },
}))

const store = vi.hoisted(() => ({
  classes: [] as any[], updates: [] as any[], synced: [] as string[],
  staleOnWrite: new Set<string>(), syncError: new Map<string, Error>(),
}))
vi.mock('@lib/classes/class-store', () => {
  class StaleClassError extends Error {}
  return {
    StaleClassError,
    listClasses: async () => store.classes,
    getClass: async (id: string) => store.classes.find((c) => c.id === id) ?? null,
    updateClass: async (id: string, patch: any, by: any, change: string, opts: any = {}) => {
      if (store.staleOnWrite.has(id)) throw new StaleClassError('stale')
      store.updates.push({ id, patch, by, change, opts })
      const i = store.classes.findIndex((c) => c.id === id)
      const next = { ...store.classes[i], ...patch, updatedAt: `${store.classes[i].updatedAt}+` }
      store.classes[i] = next
      return next
    },
  }
})
vi.mock('@lib/classes/square-catalog', async (orig) => {
  const real = await orig<typeof import('@lib/classes/square-catalog')>()
  const { registerIds } = await import('@lib/classes/register-setup')
  return {
    ...real,
    // What the real sync records: the tax and category it sent.
    syncClassToSquare: async (cls: any) => {
      store.synced.push(cls.id)
      if (store.syncError.has(cls.id)) throw store.syncError.get(cls.id)
      const ids = await registerIds()
      return { ...cls.square, taxId: cls.content.rules.taxable ? ids.classTaxId : null, categoryId: ids.classesCategoryId }
    },
  }
})
const audits = vi.hoisted(() => vi.fn(async (_: any) => undefined))
vi.mock('@lib/audit', () => ({ recordAudit: audits }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: vi.fn(async () => ({ attempted: 0, sent: 0 })) }))

import { registerSetupStale } from '@lib/classes/pos-plan'
import { classesOnOldSetup, updateAllToSetup, updateRegister } from '@lib/classes/pos-prices'
import { resetRegisterCache, saveRegisterSetup } from '@lib/classes/register-setup'
import { updateClassRegister } from '@lib/classes/admin-actions'
import { defaultRules } from '@lib/classes/validate'

const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const NOW = new Date('2026-11-02T18:00:00Z')
const tax = (id: string, over: any = {}, obj: any = {}) => ({ type: 'TAX', id, ...obj, tax_data: { name: 'Sales tax', percentage: '9', enabled: true, inclusion_type: 'ADDITIVE', ...over } })
const cat = (id: string, name: string) => ({ type: 'CATEGORY', id, category_data: { name } })

function cls(id: string, over: any = {}): any {
  return {
    id, libraryId: null, libraryVersion: null, status: 'open',
    content: {
      name: id, description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'p', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { p: 2500 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 60, earlyBird: null,
    },
    sessions: [{ id: 's', startIso: '2026-11-20T18:00:00Z', endIso: '2026-11-20T19:00:00Z', capacity: 10 }],
    square: { itemId: 'I', variations: { 'all:p': 'V' }, prices: { 'all:p': 2500 } },
    createdAt: '', updatedAt: 'v1', by: { id: 'k', name: 'K' }, history: [],
    ...over,
  }
}

/** Register setup saved on the new 9% tax (the site's value was the 8.5% one). */
async function pickNewTax() {
  await saveRegisterSetup({ classTaxId: 'T9', classesCategoryId: 'C1' }, { expectedUpdatedAt: null, by: KADEN })
}

beforeEach(() => {
  fake.data.clear()
  resetRegisterCache()
  sq.env = { environment: 'sandbox', classTaxId: 'OLD_TAX', classesCategoryId: 'C1', locationId: 'LOC' }
  sq.objects = [tax('T9'), tax('OLD_TAX', { percentage: '8.5' }), cat('C1', 'Classes')]
  store.classes = []; store.updates = []; store.synced = []; store.staleOnWrite = new Set(); store.syncError = new Map()
  audits.mockClear()
})

describe('registerSetupStale (browser-safe)', () => {
  const reg = { classTaxId: 'T9', classesCategoryId: 'C1', siteTaxId: 'OLD_TAX', siteCategoryId: 'C1' }
  it('a recorded tax or category that differs from Register setup → stale; the same → not', () => {
    expect(registerSetupStale(cls('a', { square: { itemId: 'I', variations: {}, taxId: 'OLD_TAX', categoryId: 'C1' } }), reg, NOW)).toBe(true)
    expect(registerSetupStale(cls('a', { square: { itemId: 'I', variations: {}, taxId: 'T9', categoryId: 'C2' } }), reg, NOW)).toBe(true)
    expect(registerSetupStale(cls('a', { square: { itemId: 'I', variations: {}, taxId: 'T9', categoryId: 'C1' } }), reg, NOW)).toBe(false)
  })
  it('nothing recorded (put on before fix 4) = the site’s values', () => {
    expect(registerSetupStale(cls('a'), reg, NOW)).toBe(true)
    expect(registerSetupStale(cls('a'), { ...reg, siteTaxId: 'T9' }, NOW)).toBe(false)
  })
  it('an untaxed class wants no tax; drafts, cancelled, over and off-the-register classes never show it', () => {
    const untaxed = cls('a', { content: { ...cls('a').content, rules: { ...defaultRules(), taxable: false } }, square: { itemId: 'I', variations: {}, taxId: null, categoryId: 'C1' } })
    expect(registerSetupStale(untaxed, reg, NOW)).toBe(false)
    expect(registerSetupStale(cls('a', { status: 'draft' }), reg, NOW)).toBe(false)
    expect(registerSetupStale(cls('a', { status: 'cancelled' }), reg, NOW)).toBe(false)
    expect(registerSetupStale(cls('a', { square: { itemId: null, variations: {} } }), reg, NOW)).toBe(false)
    expect(registerSetupStale(cls('a', { sessions: [{ id: 's', startIso: '2026-10-01T18:00:00Z', endIso: '2026-10-01T19:00:00Z', capacity: 10 }] }), reg, NOW)).toBe(false)
    expect(registerSetupStale(cls('a'), null, NOW)).toBe(false)
  })
})

describe('Update the register (one class)', () => {
  it('re-reads, sends the class with the tax in Register setup, saves on the version read, audited', async () => {
    await pickNewTax()
    store.classes = [cls('cls_a', { updatedAt: 'v3' })]
    const r = await updateClassRegister({ id: 'cls_a' }, KADEN)
    expect(r.data.result).toBe('updated')
    expect(store.synced).toEqual(['cls_a'])
    expect(store.updates[0]).toMatchObject({ change: 'Register updated (tax and category)', opts: { expectedUpdatedAt: 'v3' }, patch: { square: { taxId: 'T9', categoryId: 'C1' } } })
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-update-register', target: expect.objectContaining({ id: 'cls_a' }) }))
    // Done: it no longer shows as on the old tax.
    expect(await classesOnOldSetup(NOW)).toEqual([])
  })

  it('the tax in Register setup is gone or wrong in Square: refused with the Register setup button, nothing sent', async () => {
    await pickNewTax()
    store.classes = [cls('cls_a')]
    sq.objects = [cat('C1', 'Classes')]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(updateClassRegister({ id: 'cls_a' }, KADEN)).rejects.toMatchObject({ status: 503, extra: { setup: 'tax' }, message: expect.stringMatching(/isn’t on the register any more\. Open More › Register setup/) })
    sq.objects = [tax('T9', { inclusion_type: 'INCLUSIVE' }), cat('C1', 'Classes')]
    await expect(updateClassRegister({ id: 'cls_a' }, KADEN)).rejects.toMatchObject({ status: 503, extra: { setup: 'tax' }, message: expect.stringMatching(/isn’t right\. This tax is already inside the prices/) })
    expect(store.synced).toEqual([])
    expect(audits).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('drafts are refused in words; an expired token says the website can’t reach Square', async () => {
    await pickNewTax()
    store.classes = [cls('cls_d', { status: 'draft' }), cls('cls_tok')]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(updateClassRegister({ id: 'cls_d' }, KADEN)).rejects.toMatchObject({ status: 400, message: 'Drafts stay off the register. Open the class first.' })
    store.syncError.set('cls_tok', Object.assign(new Error('expired'), { status: 401 }))
    await expect(updateClassRegister({ id: 'cls_tok' }, KADEN)).rejects.toMatchObject({ status: 503, extra: { connection: true }, message: expect.stringMatching(/^The website can’t reach Square right now/) })
    warn.mockRestore()
  })

  it('twice in a row sends the same thing (harmless) and each lands', async () => {
    await pickNewTax()
    store.classes = [cls('cls_a')]
    await updateRegister('cls_a', KADEN, NOW)
    await updateRegister('cls_a', KADEN, NOW)
    expect(store.updates.map((u) => u.patch.square.taxId)).toEqual(['T9', 'T9'])
  })
})

describe('Update them all (Register setup)', () => {
  it('lists the classes on the old tax; updates each once; a second tap finds none', async () => {
    await pickNewTax()
    store.classes = [
      cls('cls_old'), // put on before fix 4: carries the site's 8.5% tax
      cls('cls_rec', { square: { itemId: 'I2', variations: {}, taxId: 'OLD_TAX', categoryId: 'C1' } }),
      cls('cls_new', { square: { itemId: 'I3', variations: {}, taxId: 'T9', categoryId: 'C1' } }),
      cls('cls_draft', { status: 'draft' }),
    ]
    expect((await classesOnOldSetup(NOW)).map((r) => r.id)).toEqual(['cls_old', 'cls_rec'])
    const r = await updateAllToSetup(KADEN, { now: NOW })
    expect(r.updated.map((x) => x.id)).toEqual(['cls_old', 'cls_rec'])
    expect(r.left).toEqual([])
    expect(store.synced).toEqual(['cls_old', 'cls_rec'])
    const again = await updateAllToSetup(KADEN, { now: NOW })
    expect(again).toEqual({ updated: [], failed: [], left: [] })
    expect(store.synced).toHaveLength(2)
  })

  it('M-e: classes the sheet gave up on (skip) are left out of the run', async () => {
    await pickNewTax()
    store.classes = [cls('a1'), cls('a2')]
    const r = await updateAllToSetup(KADEN, { now: NOW, skip: ['a1'] })
    expect(r.updated.map((x) => x.id)).toEqual(['a2'])
    expect(store.synced).toEqual(['a2'])
  })

  it('out of time: the rest come back as left; the next call carries on (resumable)', async () => {
    await pickNewTax()
    store.classes = [cls('a1'), cls('a2'), cls('a3')]
    const first = await updateAllToSetup(KADEN, { now: NOW, budgetMs: -1 })
    expect(first.updated.map((x) => x.id)).toEqual([])
    expect(first.left.map((x) => x.id)).toEqual(['a1', 'a2', 'a3'])
    const second = await updateAllToSetup(KADEN, { now: NOW })
    expect(second.updated.map((x) => x.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('a wrong tax stops it before any class is touched; one class Square refuses is listed, the others go', async () => {
    await pickNewTax()
    store.classes = [cls('b1'), cls('b2')]
    sq.objects = [tax('T9', { calculation_phase: 'TAX_TOTAL_PHASE' }), cat('C1', 'Classes')]
    await expect(updateAllToSetup(KADEN, { now: NOW })).rejects.toMatchObject({ field: 'tax' })
    expect(store.synced).toEqual([])
    sq.objects = [tax('T9'), cat('C1', 'Classes')]
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.syncError.set('b1', new Error('Square said no'))
    const r = await updateAllToSetup(KADEN, { now: NOW })
    expect(r.failed.map((x) => x.id)).toEqual(['b1'])
    expect(r.updated.map((x) => x.id)).toEqual(['b2'])
    err.mockRestore()
  })

  it('a class an owner saved meanwhile is skipped (their save sent the new setup)', async () => {
    await pickNewTax()
    store.classes = [cls('c1'), cls('c2')]
    store.staleOnWrite.add('c1')
    const r = await updateAllToSetup(KADEN, { now: NOW })
    expect(r.updated.map((x) => x.id)).toEqual(['c2'])
    expect(r.failed).toEqual([])
  })
})
