import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => ({
  classes: [] as any[], updates: [] as any[], synced: [] as any[], syncFails: new Set<string>(),
  /** What getClass returns instead of the listed class (an owner saved it meanwhile). */
  fresh: new Map<string, any>(),
  /** updateClass refuses: someone saved the class after it was read. */
  staleOnWrite: new Set<string>(),
  /** syncClassToSquare throws this for the class (fix 3: setup, connection, test-site errors). */
  syncError: new Map<string, Error>(),
}))
const audits = vi.hoisted(() => vi.fn(async (_: any) => undefined))
vi.mock('@lib/audit', () => ({ recordAudit: audits }))
const texts = vi.hoisted(() => vi.fn(async (_: string) => ({ attempted: 1, sent: 1 })))
vi.mock('@lib/owner-alert', () => ({ alertOwners: texts }))
vi.mock('@lib/classes/class-store', () => {
  class StaleClassError extends Error {}
  return {
    StaleClassError,
    listClasses: async () => store.classes,
    getClass: async (id: string) => store.fresh.get(id) ?? store.classes.find((c) => c.id === id) ?? null,
    updateClass: async (id: string, patch: any, by: any, change: string, opts: any = {}) => {
      if (store.staleOnWrite.has(id)) throw new StaleClassError('stale')
      store.updates.push({ id, patch, by, change, opts })
      const was = store.fresh.get(id) ?? store.classes.find((c) => c.id === id)
      return { ...(was ?? {}), id, ...patch }
    },
  }
})
vi.mock('@lib/classes/square-catalog', async (orig) => {
  const real = await orig<typeof import('@lib/classes/square-catalog')>()
  return {
    ...real,
    syncClassToSquare: async (cls: any, now: Date) => {
      store.synced.push(cls.id)
      if (store.syncError.has(cls.id)) throw store.syncError.get(cls.id)
      if (store.syncFails.has(cls.id)) throw new Error('Square down')
      return { itemId: cls.square.itemId ?? 'NEW_ITEM', variations: cls.square.itemId ? cls.square.variations : Object.fromEntries(real.variationPlan(cls, now).map((p) => [p.key, `V_${p.key}`])), prices: Object.fromEntries(real.variationPlan(cls, now).map((p) => [p.key, p.cents])) }
    },
  }
})

import { POST, classPricesJobKey } from '@pages/api/jobs/class-prices.json'
import { followCurrentPricesOnPos } from '@lib/classes/pos-prices'
import { defaultRules } from '@lib/classes/validate'

const SECRET = 'test-secret'
const call = (key: string | null = classPricesJobKey(SECRET)) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/class-prices.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {}, body: '{}' }) } as any)

function cls(id: string, over: any = {}): any {
  return {
    id, libraryId: null, libraryVersion: null, status: 'open',
    content: {
      name: id, description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'p', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { p: 2500 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 60,
      earlyBird: { untilYmd: '2026-11-01', prices: { all: { p: 2000 } } },
    },
    sessions: [{ id: 's', startIso: '2026-11-20T18:00:00Z', endIso: '2026-11-20T19:00:00Z', capacity: 10 }],
    square: { itemId: 'I', variations: { 'all:p': 'V' }, prices: { 'all:p': 2000 } },
    createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
    ...over,
  }
}

const DURING = new Date('2026-11-01T20:00:00Z') // Sun Nov 1, 2 PM Chicago: still running
const AFTER = new Date('2026-11-02T06:01:00Z') // Mon Nov 2, 12:01 AM Chicago (CST): ended

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  store.classes = []; store.updates = []; store.synced = []; store.syncFails = new Set(); store.fresh = new Map(); store.staleOnWrite = new Set(); store.syncError = new Map()
  audits.mockClear()
  texts.mockClear()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('D4: POS prices follow the early-bird', () => {
  it('nothing differs while it runs: no Square write at all (idempotent)', async () => {
    store.classes = [cls('cls_a')]
    const r = await followCurrentPricesOnPos(DURING)
    expect(r).toEqual({ checked: 1, updated: [], failed: [] })
    expect(store.synced).toEqual([])
  })
  it('the minute after it ends: the POS goes back to the regular price and the class records it', async () => {
    store.classes = [cls('cls_a'), cls('cls_plain', { content: { ...cls('x').content, earlyBird: undefined }, square: { itemId: 'I', variations: { 'all:p': 'V' } } })]
    const r = await followCurrentPricesOnPos(AFTER)
    expect(r.updated).toEqual(['cls_a'])
    expect(store.synced).toEqual(['cls_a'])
    expect(store.updates[0]).toMatchObject({ id: 'cls_a', patch: { square: { prices: { 'all:p': 2500 } } }, change: 'POS prices follow the early-bird' })
    // Run again with the new prices recorded: nothing to do.
    store.classes = [cls('cls_a', { square: { itemId: 'I', variations: { 'all:p': 'V' }, prices: { 'all:p': 2500 } } })]
    store.synced = []
    expect((await followCurrentPricesOnPos(AFTER)).updated).toEqual([])
    expect(store.synced).toEqual([])
  })
  it('a Square failure on one class is logged and retried next run; the others still flip', async () => {
    store.classes = [cls('cls_bad'), cls('cls_good')]
    store.syncFails.add('cls_bad')
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await followCurrentPricesOnPos(AFTER)
    expect(r).toMatchObject({ updated: ['cls_good'], failed: ['cls_bad'] })
    expect(store.updates.map((u) => u.id)).toEqual(['cls_good'])
    err.mockRestore()
  })
  it('M2: the class is read again before the Square write, and saved only if nobody saved it meanwhile', async () => {
    store.classes = [cls('cls_a', { updatedAt: 'v1' })]
    store.fresh.set('cls_a', cls('cls_a', { updatedAt: 'v2', content: { ...cls('x').content, name: 'Renamed', prices: { all: { p: 3000 } } } }))
    await followCurrentPricesOnPos(AFTER)
    // Square got the class as it is now (the owner's new price), and the record write is conditional on that version.
    expect(store.updates[0]).toMatchObject({ id: 'cls_a', patch: { square: { prices: { 'all:p': 3000 } } }, opts: { expectedUpdatedAt: 'v2' } })
  })
  it('M2: re-read shows it already right (an owner saved it): no Square write', async () => {
    store.classes = [cls('cls_a')]
    store.fresh.set('cls_a', cls('cls_a', { square: { itemId: 'I', variations: { 'all:p': 'V' }, prices: { 'all:p': 2500 } } }))
    expect((await followCurrentPricesOnPos(AFTER)).updated).toEqual([])
    expect(store.synced).toEqual([])
  })
  it('M2: saved in /admin between the read and the record write: skipped quietly (no text), the next run looks again', async () => {
    store.classes = [cls('cls_a')]
    store.staleOnWrite.add('cls_a')
    const r = await followCurrentPricesOnPos(AFTER)
    expect(r).toMatchObject({ updated: [], failed: [] })
    expect(texts).not.toHaveBeenCalled()
  })
  it('I2: a class whose POS price stays wrong texts the owners once a day, naming it and what to do', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const id = `cls_bad_${Date.now().toString(36)}`
    store.classes = [cls(id, { content: { ...cls('x').content, name: 'Clay Camp' } })]
    store.syncFails.add(id)
    await followCurrentPricesOnPos(AFTER)
    expect(texts).toHaveBeenCalledTimes(1)
    expect(texts.mock.calls[0][0]).toBe("The register price for Clay Camp didn't update: it still rings the early-bird price. Open the class in /admin and tap Fix the register price now. We'll keep trying every hour.")
    // The next hourly runs that day: still failing, no more texts.
    await followCurrentPricesOnPos(new Date(AFTER.getTime() + 3_600_000))
    await followCurrentPricesOnPos(new Date(AFTER.getTime() + 20 * 3_600_000))
    expect(texts).toHaveBeenCalledTimes(1)
    // The next Chicago day: one more.
    await followCurrentPricesOnPos(new Date(AFTER.getTime() + 25 * 3_600_000))
    expect(texts).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
  it('drafts, cancelled classes and classes not on the POS are left alone', async () => {
    store.classes = [cls('cls_d', { status: 'draft' }), cls('cls_c', { status: 'cancelled' }), cls('cls_n', { square: { itemId: null, variations: {} } })]
    expect((await followCurrentPricesOnPos(AFTER)).updated).toEqual([])
    expect(store.synced).toEqual([])
  })
})

describe('POST /api/jobs/class-prices.json', () => {
  it('needs the job key (or an owner)', async () => {
    expect((await call(null)).status).toBe(403)
    expect((await call('nope')).status).toBe(403)
  })
  it('runs with the job key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AFTER)
    store.classes = [cls('cls_a')]
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).data.updated).toEqual(['cls_a'])
  })
})

describe('Fix the register price now (owner button)', () => {
  it('fixes one class now: re-read, Square written, record saved only on the version read', async () => {
    const { fixPosPrices } = await import('@lib/classes/pos-prices')
    store.classes = [cls('cls_fix', { updatedAt: 'v7' })]
    const r = await fixPosPrices('cls_fix', { id: 'owner-catherine', name: 'Catherine' }, AFTER)
    expect(r.result).toBe('fixed')
    expect(store.synced).toEqual(['cls_fix'])
    expect(store.updates[0]).toMatchObject({ id: 'cls_fix', change: 'Register price fixed', opts: { expectedUpdatedAt: 'v7' }, patch: { square: { prices: { 'all:p': 2500 } } } })
  })
  it('already right: nothing written', async () => {
    const { fixPosPrices } = await import('@lib/classes/pos-prices')
    store.classes = [cls('cls_ok')]
    expect((await fixPosPrices('cls_ok', { id: 'k', name: 'K' }, DURING)).result).toBe('already')
    expect(store.synced).toEqual([])
  })
  it('the admin action: a Square failure reads as a plain sentence, nothing else changed', async () => {
    const { fixRegisterPrice } = await import('@lib/classes/admin-actions')
    store.classes = [cls('cls_down')]
    store.syncFails.add('cls_down')
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AFTER)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(fixRegisterPrice({ id: 'cls_down' }, { id: 'k', name: 'K' })).rejects.toMatchObject({ status: 502, message: 'Square didn’t take the new price just now. Nothing else changed. Try again in a few minutes.' })
    expect(store.updates).toEqual([])
    warn.mockRestore()
  })
})

describe('fix 3: Put it on the register, and what the register buttons say when they can’t finish', () => {
  const KADEN = { id: 'owner-kaden', name: 'Kaden' }
  const offPos = (id: string, over: any = {}) => cls(id, { square: { itemId: null, variations: {} }, ...over })
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AFTER) })

  it('a class not on the register goes on: re-read, guarded write, saved on the version read, audited', async () => {
    const { putClassOnRegister } = await import('@lib/classes/admin-actions')
    store.classes = [offPos('cls_new', { updatedAt: 'v3' })]
    const r = await putClassOnRegister({ id: 'cls_new' }, KADEN)
    expect(r.data.result).toBe('put')
    expect(store.synced).toEqual(['cls_new'])
    expect(store.updates[0]).toMatchObject({ change: 'Put on the register', opts: { expectedUpdatedAt: 'v3' }, patch: { square: { itemId: 'NEW_ITEM' } } })
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-sync-pos', target: expect.objectContaining({ id: 'cls_new' }) }))
  })

  it('already on the register with every seat: nothing written, nothing audited', async () => {
    const { putClassOnRegister } = await import('@lib/classes/admin-actions')
    store.classes = [cls('cls_ok')]
    expect((await putClassOnRegister({ id: 'cls_ok' }, KADEN)).data.result).toBe('already')
    expect(store.synced).toEqual([])
    expect(audits).not.toHaveBeenCalled()
  })

  it('a draft, a cancelled class and one that’s over are refused in words, before Square', async () => {
    const { putClassOnRegister } = await import('@lib/classes/admin-actions')
    store.classes = [offPos('cls_d', { status: 'draft' }), offPos('cls_c', { status: 'cancelled' }), offPos('cls_o', { sessions: [{ id: 's', startIso: '2026-10-01T18:00:00Z', endIso: '2026-10-01T19:00:00Z', capacity: 10 }] })]
    await expect(putClassOnRegister({ id: 'cls_d' }, KADEN)).rejects.toMatchObject({ status: 400, message: 'Drafts stay off the register. Open the class first.' })
    await expect(putClassOnRegister({ id: 'cls_c' }, KADEN)).rejects.toMatchObject({ status: 400, message: 'A cancelled class doesn’t go on the register.' })
    await expect(putClassOnRegister({ id: 'cls_o' }, KADEN)).rejects.toMatchObject({ status: 400, message: 'This class is over, so it doesn’t go on the register.' })
    expect(store.synced).toEqual([])
  })

  it('class tax or category not picked: the answer names Register setup and carries the button', async () => {
    const { putClassOnRegister, fixRegisterPrice } = await import('@lib/classes/admin-actions')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    store.classes = [offPos('cls_t'), offPos('cls_k'), cls('cls_p')]
    store.syncError.set('cls_t', new Error("Class tax isn't set up yet."))
    store.syncError.set('cls_k', new Error("Classes category isn't set up yet."))
    store.syncError.set('cls_p', new Error("Class tax isn't set up yet."))
    await expect(putClassOnRegister({ id: 'cls_t' }, KADEN)).rejects.toMatchObject({ status: 503, message: "It can't go on the register yet: the class tax isn't picked. Open More › Register setup and pick the 9% tax.", extra: { setup: 'tax' } })
    await expect(putClassOnRegister({ id: 'cls_k' }, KADEN)).rejects.toMatchObject({ status: 503, message: "It can't go on the register yet: the Classes category isn't picked. Open More › Register setup and pick the Classes category.", extra: { setup: 'category' } })
    await expect(fixRegisterPrice({ id: 'cls_p' }, KADEN)).rejects.toMatchObject({ status: 503, extra: { setup: 'tax' }, message: expect.stringMatching(/^The register price can't be set yet: the class tax isn't picked\./) })
    expect(store.updates).toEqual([])
    warn.mockRestore()
  })

  it('M-e: a deleted class, a test-site block, an expired token and a Square refusal each say their own thing', async () => {
    const { fixRegisterPrice, putClassOnRegister } = await import('@lib/classes/admin-actions')
    const { TestSiteStoreError } = await import('@lib/classes/test-site-guard')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(fixRegisterPrice({ id: 'cls_gone' }, KADEN)).rejects.toMatchObject({ status: 404, message: 'That class is gone. Reload the page.' })
    await expect(putClassOnRegister({ id: 'cls_gone' }, KADEN)).rejects.toMatchObject({ status: 404 })
    store.classes = [cls('cls_ts'), cls('cls_tok'), offPos('cls_sq')]
    store.syncError.set('cls_ts', new TestSiteStoreError())
    store.syncError.set('cls_tok', Object.assign(new Error('Square said: expired'), { status: 401, errors: [{ code: 'ACCESS_TOKEN_EXPIRED', category: 'AUTHENTICATION_ERROR' }] }))
    store.syncError.set('cls_sq', new Error('Square said: nope'))
    await expect(fixRegisterPrice({ id: 'cls_ts' }, KADEN)).rejects.toMatchObject({ status: 503, message: 'This test site has no store of its own. Set STORE_NAMESPACE first.' })
    await expect(fixRegisterPrice({ id: 'cls_tok' }, KADEN)).rejects.toMatchObject({ status: 503, message: 'The register connection isn’t working right now. Ring it up at the regular price meanwhile.', extra: { connection: true } })
    await expect(putClassOnRegister({ id: 'cls_sq' }, KADEN)).rejects.toMatchObject({ status: 502, message: 'Square didn’t take the class just now. Nothing else changed. Try again in a few minutes.' })
    warn.mockRestore()
  })

  it('M-h: someone saved the class meanwhile → 409, and no audit row; a fix that lands is audited', async () => {
    const { fixRegisterPrice } = await import('@lib/classes/admin-actions')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    store.classes = [cls('cls_stale'), cls('cls_fixme')]
    store.staleOnWrite.add('cls_stale')
    await expect(fixRegisterPrice({ id: 'cls_stale' }, KADEN)).rejects.toMatchObject({ status: 409, message: 'Someone saved this class just now. Reload it, then try again.' })
    expect(audits).not.toHaveBeenCalled()
    await fixRegisterPrice({ id: 'cls_fixme' }, KADEN)
    expect(audits).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-fix-register-price', by: expect.objectContaining({ name: 'Kaden', role: 'owner' }) }))
    warn.mockRestore()
  })
})
