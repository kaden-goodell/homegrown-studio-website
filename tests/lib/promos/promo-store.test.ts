import { describe, it, expect, vi, beforeEach } from 'vitest'

const hook = vi.hoisted(() => ({
  mem: new Map<string, Map<string, { value: string; etag: string }>>(),
  n: 0,
  /** runs once, just before the next CAS write (to stage a race) */
  beforeCas: null as null | (() => Promise<void>),
  context: 'dev' as string,
}))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => hook.context, isPreviewOrDev: () => hook.context !== 'production' }))
// An in-memory store with real etags, so compare-and-swap races behave as on Netlify Blobs.
vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (name: string) => {
      if (!hook.mem.has(name)) hook.mem.set(name, new Map())
      const m = hook.mem.get(name)!
      const put = (k: string, value: string) => m.set(k, { value, etag: `e${++hook.n}` })
      return {
        get: async (k: string) => m.get(k)?.value ?? null,
        set: async (k: string, v: string) => { put(k, v) },
        getWithMeta: async (k: string) => ({ value: m.get(k)?.value ?? null, etag: m.get(k)?.etag ?? null }),
        setIfMatch: async (k: string, v: string, etag: string | null, _exists: boolean) => {
          if (hook.beforeCas) { const f = hook.beforeCas; hook.beforeCas = null; await f() }
          const cur = m.get(k)
          if (etag ? cur?.etag !== etag : cur !== undefined) return false
          put(k, v)
          return true
        },
        list: async () => [...m.keys()],
      }
    },
  }
})

import {
  confirmUse, extendUse, getPromo, getUses, giveUseBack, listPromos, PromoSaveError, releaseUse, reserveUse, savePromo,
} from '@lib/promos/promo-store'

const by = { id: 'c', name: 'Catherine' }
const NOW = new Date('2026-11-01T18:00:00Z')
const in15 = new Date(NOW.getTime() + 15 * 60_000).toISOString()
const fields = (over: Record<string, unknown> = {}) => ({ code: 'grand1', label: 'Grand opening', off: { kind: 'percent', percent: 10 }, ...over })

beforeEach(() => { for (const m of hook.mem.values()) m.clear(); hook.beforeCas = null; hook.context = 'dev' })

describe('savePromo', () => {
  it('creates a code, upper case, with history', async () => {
    const p = await savePromo(fields(), by, null, NOW)
    expect(p.code).toBe('GRAND1')
    expect(p.history).toEqual([{ at: NOW.toISOString(), by, change: 'Made the code' }])
    expect(await getPromo('grand1')).toEqual(p)
    expect(await getPromo('nope!')).toBeNull()
  })
  it('a code that exists is taken', async () => {
    await savePromo(fields(), by, null, NOW)
    await expect(savePromo(fields(), by, null, NOW)).rejects.toThrow('That code is taken.')
  })
  it('refuses a last day in the past on create', async () => {
    await expect(savePromo(fields({ endsYmd: '2026-10-31' }), by, null, NOW)).rejects.toMatchObject({ message: "The last day can't be in the past.", field: 'endsYmd' })
  })
  it('edits with the right updatedAt, refuses a stale one, records what changed', async () => {
    const p = await savePromo(fields(), by, null, NOW)
    const later = new Date(NOW.getTime() + 60_000)
    const e = await savePromo({ ...fields(), active: false, maxUses: 5 }, by, p.updatedAt, later)
    expect(e.active).toBe(false)
    expect(e.createdAt).toBe(p.createdAt)
    expect(e.history.at(-1)!.change).toBe('Turned it off · Use limit')
    await expect(savePromo(fields(), by, p.updatedAt, later)).rejects.toMatchObject({ status: 409 })
  })
  it('an edit of a code that is not there is refused', async () => {
    await expect(savePromo(fields(), by, '2026-01-01T00:00:00Z', NOW)).rejects.toThrow('That code is gone. Reload and try again.')
  })
  it('an edit keeps an already-ended last day, but refuses moving it into the past', async () => {
    const p = await savePromo(fields({ endsYmd: '2026-11-02' }), by, null, NOW)
    const later = new Date('2026-11-05T18:00:00Z')
    const kept = await savePromo(fields({ endsYmd: '2026-11-02', label: 'renamed' }), by, p.updatedAt, later)
    expect(kept.endsYmd).toBe('2026-11-02')
    await expect(savePromo(fields({ endsYmd: '2026-11-03' }), by, kept.updatedAt, later)).rejects.toThrow("The last day can't be in the past.")
  })
  it('lists codes with how many bookings used them', async () => {
    await savePromo(fields(), by, null, NOW)
    await savePromo(fields({ code: 'OTHER' }), by, null, NOW)
    await reserveUse('GRAND1', 'bkg_1', in15, NOW, null)
    await confirmUse('GRAND1', 'bkg_1', 'cls_a')
    const list = await listPromos()
    expect(list.map((p) => [p.code, p.usedCount])).toEqual([['GRAND1', 1], ['OTHER', 0]])
  })
  it('lists how many are paying with a code right now (M5)', async () => {
    await savePromo(fields(), by, null, NOW)
    await reserveUse('GRAND1', 'bkg_1', in15, NOW, null)
    await reserveUse('GRAND1', 'bkg_2', new Date(NOW.getTime() - 1000).toISOString(), NOW, null)
    const [p] = await listPromos(NOW)
    expect([p.usedCount, p.payingNow]).toEqual([0, 1])
  })
})

describe('use reservations', () => {
  it('last use: two buyers racing on a 1-use code → one ok, one used up', async () => {
    // The second buyer's reserve runs while the first is about to write.
    let second: Promise<string> | null = null
    hook.beforeCas = async () => { second = reserveUse('ONE', 'bkg_b', in15, NOW, 1); await second }
    const first = await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    const results = [first, await second!]
    expect(results.sort()).toEqual(['ok', 'used-up'])
    const u = await getUses('ONE')
    expect(u!.holds).toHaveLength(1)
  })
  it('the same booking asking again is ok and keeps one hold', async () => {
    expect(await reserveUse('ONE', 'bkg_a', in15, NOW, 1)).toBe('ok')
    expect(await reserveUse('ONE', 'bkg_a', in15, NOW, 1)).toBe('ok')
    expect((await getUses('ONE'))!.holds).toHaveLength(1)
  })
  it('a released hold gives the use back', async () => {
    await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    expect(await reserveUse('ONE', 'bkg_b', in15, NOW, 1)).toBe('used-up')
    await releaseUse('ONE', 'bkg_a')
    expect(await reserveUse('ONE', 'bkg_b', in15, NOW, 1)).toBe('ok')
  })
  it('an expired hold gives the use back', async () => {
    await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    const later = new Date(NOW.getTime() + 16 * 60_000)
    expect(await reserveUse('ONE', 'bkg_b', new Date(later.getTime() + 15 * 60_000).toISOString(), later, 1)).toBe('ok')
    expect((await getUses('ONE'))!.holds.map((h) => h.bookingId)).toEqual(['bkg_b'])
  })
  it('confirm is idempotent and turns the hold into a use', async () => {
    await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    await confirmUse('ONE', 'bkg_a', 'cls_a')
    await confirmUse('ONE', 'bkg_a', 'cls_a')
    const u = (await getUses('ONE'))!
    expect(u.used.map((x) => x.bookingId)).toEqual(['bkg_a'])
    expect(u.holds).toEqual([])
    expect(await reserveUse('ONE', 'bkg_b', in15, NOW, 1)).toBe('used-up')
    // A paid booking asking again (a replay) is still ok.
    expect(await reserveUse('ONE', 'bkg_a', in15, NOW, 1)).toBe('ok')
  })
  it('a refund does not give a use back: release never removes a paid use', async () => {
    await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    await confirmUse('ONE', 'bkg_a', 'cls_a')
    await releaseUse('ONE', 'bkg_a')
    expect((await getUses('ONE'))!.used).toHaveLength(1)
    expect(await reserveUse('ONE', 'bkg_b', in15, NOW, 1)).toBe('used-up')
  })
  it('an owner can give a one-use personal code its use back (M8)', async () => {
    await reserveUse('MAYAFREE', 'bkg_maya', in15, NOW, 1)
    await confirmUse('MAYAFREE', 'bkg_maya', 'cls_a')
    expect(await reserveUse('MAYAFREE', 'bkg_b', in15, NOW, 1)).toBe('used-up')
    expect(await giveUseBack('MAYAFREE', 'bkg_maya', by, NOW)).toBe(true)
    const u = (await getUses('MAYAFREE'))!
    expect(u.used).toHaveLength(0)
    expect(u.givenBack).toEqual([{ bookingId: 'bkg_maya', at: NOW.toISOString(), by, classId: 'cls_a' }])
    expect(await reserveUse('MAYAFREE', 'bkg_b', in15, NOW, 1)).toBe('ok')
    // Nothing to give back for a booking that never used it.
    expect(await giveUseBack('MAYAFREE', 'bkg_nobody', by, NOW)).toBe(false)
  })
  it('extend keeps the hold a day (no answer from Square)', async () => {
    await reserveUse('ONE', 'bkg_a', in15, NOW, 1)
    const day = new Date(NOW.getTime() + 24 * 3_600_000).toISOString()
    await extendUse('ONE', 'bkg_a', day)
    const later = new Date(NOW.getTime() + 60 * 60_000)
    expect(await reserveUse('ONE', 'bkg_b', new Date(later.getTime() + 15 * 60_000).toISOString(), later, 1)).toBe('used-up')
  })
  it('no limit always reserves', async () => {
    for (const b of ['b1', 'b2', 'b3']) expect(await reserveUse('ALL', b, in15, NOW, null)).toBe('ok')
  })
  it('PromoSaveError carries a status', () => {
    expect(new PromoSaveError(409, 'x').status).toBe(409)
  })
})

describe('R41 test-site guard', () => {
  it('a test site with no store of its own writes no code and no use', async () => {
    const ns = process.env.STORE_NAMESPACE
    delete process.env.STORE_NAMESPACE
    hook.context = 'branch-deploy'
    try {
      await expect(savePromo(fields(), by, null, NOW)).rejects.toThrow('This test site has no store of its own.')
      await expect(reserveUse('ONE', 'bkg_a', in15, NOW, 1)).rejects.toThrow('This test site has no store of its own.')
      await expect(confirmUse('ONE', 'bkg_a', 'cls_a')).rejects.toThrow('This test site has no store of its own.')
      await expect(releaseUse('ONE', 'bkg_a')).rejects.toThrow('This test site has no store of its own.')
      await expect(extendUse('ONE', 'bkg_a', in15)).rejects.toThrow('This test site has no store of its own.')
    } finally {
      if (ns !== undefined) process.env.STORE_NAMESPACE = ns
    }
    expect(hook.mem.get('promo-codes')!.size + hook.mem.get('promo-uses')!.size).toBe(0)
  })
})
