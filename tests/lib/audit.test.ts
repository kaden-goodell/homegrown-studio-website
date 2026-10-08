import { describe, it, expect, vi, beforeEach } from 'vitest'

let preview = true
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => preview }))

const logged = vi.fn()
vi.mock('@lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: (...a: unknown[]) => logged(...a) }),
}))

const store = new Map<string, string>()
let failSet = false
vi.mock('@lib/blob-store', () => ({
  makeKvStore: () => ({
    set: async (k: string, v: string) => { if (failSet) throw new Error('store down'); store.set(k, v) },
    get: async (k: string) => store.get(k) ?? null,
    list: async () => [...store.keys()],
  }),
}))

import { recordAudit, listAudit } from '@lib/audit'

const crew = { id: 'm1', name: 'Mara', role: 'crew' as const }
const owner = { id: 'k', name: 'Kaden', role: 'owner' as const }
const base = { target: { kind: 'gift-card', id: 'gc_1' } }

beforeEach(() => { store.clear(); failSet = false; preview = true; logged.mockReset() })

describe('audit store', () => {
  it('lists newest first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2090-01-01T00:00:00Z'))
    await recordAudit({ ...base, by: crew, action: 'first' })
    vi.setSystemTime(new Date('2090-01-02T00:00:00Z'))
    await recordAudit({ ...base, by: crew, action: 'second' })
    vi.useRealTimers()
    expect((await listAudit()).map((e) => e.action)).toEqual(['second', 'first'])
  })

  it('stores who, what and details', async () => {
    await recordAudit({ ...base, by: owner, action: 'gift-card.minted', details: { amountCents: 2500 } })
    const [e] = await listAudit()
    expect(e).toMatchObject({ by: owner, action: 'gift-card.minted', details: { amountCents: 2500 } })
    expect(e.id).toMatch(/^au_/)
    expect(Number.isNaN(Date.parse(e.at))).toBe(false)
  })

  it('filters by staff id, since, and limit', async () => {
    vi.useFakeTimers()
    for (const [d, by] of [['2090-01-01', crew], ['2090-01-02', owner], ['2090-01-03', crew]] as const) {
      vi.setSystemTime(new Date(`${d}T12:00:00Z`))
      await recordAudit({ ...base, by, action: d })
    }
    vi.useRealTimers()
    expect((await listAudit({ byId: 'm1' })).map((e) => e.action)).toEqual(['2090-01-03', '2090-01-01'])
    expect((await listAudit({ since: '2090-01-02' })).map((e) => e.action)).toEqual(['2090-01-03', '2090-01-02'])
    expect((await listAudit({ limit: 1 })).map((e) => e.action)).toEqual(['2090-01-03'])
  })

  it('hides simulated entries in production only', async () => {
    await recordAudit({ ...base, by: crew, action: 'real' })
    await recordAudit({ ...base, by: crew, action: 'fake', simulated: true })
    expect((await listAudit()).map((e) => e.action).sort()).toEqual(['fake', 'real'])
    preview = false
    expect((await listAudit()).map((e) => e.action)).toEqual(['real'])
  })

  it('swallows a store failure and logs it', async () => {
    failSet = true
    await expect(recordAudit({ ...base, by: crew, action: 'x' })).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
