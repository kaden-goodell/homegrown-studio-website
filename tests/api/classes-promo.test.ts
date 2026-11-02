import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const classes = new Map<string, any>()
vi.mock('@lib/classes/class-store', () => ({ getClass: async (id: string) => classes.get(id) ?? null }))
let staffMember: null | { id: string; name: string; role: 'owner' | 'crew' } = null
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => staffMember }))

import { POST } from '@pages/api/classes/promo.json'
import { savePromo, reserveUse, confirmUse } from '@lib/promos/promo-store'
import { defaultRules } from '@lib/classes/validate'

const NOW = new Date('2026-10-10T17:00:00.000Z')
const by = { id: 'c', name: 'Catherine' }
let n = 0
function makeClass(over: any = {}) {
  const cls: any = {
    id: `cls_promo${++n}`, libraryId: 'lib_pottery', libraryVersion: 1, status: 'open',
    content: {
      name: 'Pottery', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'adult', label: 'Adult' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { adult: 2500 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 60, ...over.content,
    },
    sessions: [{ id: 's1', startIso: '2026-10-17T18:00:00.000Z', endIso: '2026-10-17T20:00:00.000Z', capacity: 10 }],
    square: { itemId: 'I', variations: { 'all:adult': 'V' } },
    createdAt: '', updatedAt: '', by, history: [], ...over.cls,
  }
  classes.set(cls.id, cls)
  return cls
}
async function code(over: any = {}) {
  const c = `PROMO${++n}${Date.now().toString(36).slice(-4).toUpperCase()}`
  await savePromo({ code: c, label: '', off: { kind: 'percent', percent: 20 }, appliesTo: { kind: 'all' }, ...over }, by, null, NOW)
  return c
}
let ip = 0
const call = (payload: any, opts: { address?: string; door?: boolean } = {}) => POST({
  clientAddress: opts.address ?? `203.0.113.${++ip % 250}`,
  request: new Request(`https://ourhometownstudio.com/api/classes/promo.json${opts.door ? '?door=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
} as any)
const req = { passId: 'all', tickets: { adult: 2 } }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); staffMember = null })
afterEach(() => vi.useRealTimers())

describe('POST /api/classes/promo.json', () => {
  it('prices the booking with the code (early-bird first), never holding anything', async () => {
    const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-12', prices: { all: { adult: 2000 } } } } })
    const c = await code()
    const res = await call({ classId: cls.id, code: c.toLowerCase(), request: req })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.code).toBe(c)
    // $25 → early-bird $20 → 20% off = $16 a seat; tax 144 each
    expect(data.quote.lines.map((l: any) => [l.listCents, l.cents, l.taxCents])).toEqual([[2500, 1600, 144], [2500, 1600, 144]])
    expect(data.quote.lines[0].discounts.map((d: any) => d.name)).toEqual(['Early-bird', `Code ${c}`])
    expect(data.quote).toMatchObject({ subtotalCents: 3200, taxCents: 288, totalCents: 3488, discountCents: 1800, promo: { code: c, cents: 800 } })
    expect(data.quote.lines[0]).not.toHaveProperty('variationKey')
  })
  it('unknown and turned-off read the same; ended, used up and wrong class say why', async () => {
    const cls = makeClass()
    const off = await code({ active: false })
    for (const c of ['NOPE123', off, '%%']) {
      const r = await call({ classId: cls.id, code: c, request: req })
      expect(r.status).toBe(409)
      expect((await r.json()).detail).toBe("That code isn't valid.")
    }
    const one = await code({ maxUses: 1 })
    await reserveUse(one, 'bkg_x', new Date(NOW.getTime() + 60_000).toISOString(), NOW, 1)
    await confirmUse(one, 'bkg_x', cls.id)
    expect((await (await call({ classId: cls.id, code: one, request: req })).json()).detail).toBe('That code has been used up.')
    const elsewhere = await code({ appliesTo: { kind: 'classes', libraryIds: ['lib_other'], classIds: [] } })
    expect((await (await call({ classId: cls.id, code: elsewhere, request: req })).json()).detail).toBe("That code isn't for this class.")
    const forLibrary = await code({ appliesTo: { kind: 'classes', libraryIds: ['lib_pottery'], classIds: [] } })
    expect((await call({ classId: cls.id, code: forLibrary, request: req })).status).toBe(200)
    const ended = await code({ endsYmd: '2026-10-10' })
    vi.setSystemTime(new Date('2026-10-11T05:00:00.000Z'))
    expect((await (await call({ classId: cls.id, code: ended, request: req })).json()).detail).toBe('That code has ended.')
  })
  it('10 tries a minute per address', async () => {
    const cls = makeClass()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await call({ classId: cls.id, code: 'NOPE123', request: req }, { address: '198.18.0.9' })).status)
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
  it('a door price needs a signed-in crew member, and prices a running session', async () => {
    const cls = makeClass()
    const c = await code()
    expect((await call({ classId: cls.id, code: c, request: req }, { door: true })).status).toBe(401)
    staffMember = { id: 'sam', name: 'Sam', role: 'crew' }
    vi.setSystemTime(new Date('2026-10-17T18:30:00.000Z'))
    expect((await call({ classId: cls.id, code: c, request: req }, { door: true })).status).toBe(200)
    expect((await call({ classId: cls.id, code: c, request: req })).status).toBe(409)
  })
  it('a page that is out of date gets a plain sentence', async () => {
    const r = await call({ classId: 'cls_x', code: 'ABC' })
    expect(r.status).toBe(400)
    expect((await r.json()).detail).toBe('Reload the page and try again.')
  })
})
