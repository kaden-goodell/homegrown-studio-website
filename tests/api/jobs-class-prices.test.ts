import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => ({
  classes: [] as any[], updates: [] as any[], synced: [] as any[], syncFails: new Set<string>(),
  /** What getClass returns instead of the listed class (an owner saved it meanwhile). */
  fresh: new Map<string, any>(),
  /** updateClass refuses: someone saved the class after it was read. */
  staleOnWrite: new Set<string>(),
}))
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
      store.updates.push({ id, patch, by, change, opts }); return { id }
    },
  }
})
vi.mock('@lib/classes/square-catalog', async (orig) => {
  const real = await orig<typeof import('@lib/classes/square-catalog')>()
  return {
    ...real,
    syncClassToSquare: async (cls: any, now: Date) => {
      store.synced.push(cls.id)
      if (store.syncFails.has(cls.id)) throw new Error('Square down')
      return { itemId: cls.square.itemId, variations: cls.square.variations, prices: Object.fromEntries(real.variationPlan(cls, now).map((p) => [p.key, p.cents])) }
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
  store.classes = []; store.updates = []; store.synced = []; store.syncFails = new Set(); store.fresh = new Map(); store.staleOnWrite = new Set()
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
    expect(texts.mock.calls[0][0]).toBe("The POS price for Clay Camp didn't update: the register still rings the early-bird price. Open it in /admin and Save. We'll keep trying every hour.")
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
