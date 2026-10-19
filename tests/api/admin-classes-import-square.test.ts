// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAllWorkshops: vi.fn(),
  squareFetch: vi.fn(),
  getEventMeta: vi.fn(),
  audit: vi.fn(),
  providerWrites: vi.fn(),
}))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: {
      listAllWorkshops: mocks.listAllWorkshops,
      listWorkshops: vi.fn(async () => []),
      reserveSeats: mocks.providerWrites, payForSeats: mocks.providerWrites, releaseSeats: mocks.providerWrites, setSeatPrice: mocks.providerWrites,
    },
  },
}))
vi.mock('@lib/classes/square-api', () => ({ squareFetch: mocks.squareFetch, squareSettings: () => ({ environment: 'production' }) }))
vi.mock('@lib/event-meta', async (orig) => ({ ...(await orig<typeof import('@lib/event-meta')>()), getEventMeta: mocks.getEventMeta }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))

import * as route from '@pages/api/admin/classes/import-square.json'
import { adminCookie } from '@lib/admin-auth'
import { emptyEventMeta } from '@lib/event-meta'
import { getLibrary, listLibrary, saveLibraryVersion } from '@lib/classes/library-store'
import { contentFromSquare } from '@lib/classes/import-square'
import type { Workshop } from '@providers/interfaces/workshop'

const cookie = () => adminCookie().split(';')[0]
const post = async (body: unknown, signedIn = true) => {
  const request = new Request('https://x.test/api/admin/classes/import-square.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signedIn ? { cookie: cookie() } : {}) },
    body: JSON.stringify(body),
  })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

let n = 0
/** Each test gets its own class names, since the library store lives across tests. */
let tag = ''
function workshop(name: string, over: Partial<Workshop> = {}): Workshop {
  n++
  return {
    id: `inst${n}`, scheduleId: `sched-${name}`, name: `${name} ${tag}`,
    description: 'Paint a pumpkin.\n\nAges 8 and up. This is a drop-off class.', descriptionHtml: '',
    startAt: `2026-11-${String(10 + (n % 15)).padStart(2, '0')}T22:00:00.000Z`, durationMinutes: 120,
    priceCents: 3500, priceCurrency: 'USD', availableCapacity: 6, staffName: 'Kaden', teamMemberId: 'tm1',
    imageUrl: `https://img.example/${name}.jpg`, ...over,
  }
}
/** Catalog items for the given workshops, one CLASS_TICKET each, plus a decoy POS item. */
function catalog(ws: Workshop[]) {
  const objects = [
    ...ws.map((w) => ({ type: 'ITEM', id: `ITEM-${w.name.split(' ')[0]}`, item_data: { name: w.name, product_type: 'CLASS_TICKET' } })),
    ...ws.map((w) => ({ type: 'ITEM', id: `POS-${w.name.split(' ')[0]}`, item_data: { name: w.name, product_type: 'REGULAR' } })),
  ]
  // Two pages, so the reader follows the cursor.
  mocks.squareFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw new Error(`Square write attempted: ${init.method} ${path}`)
    if (!path.startsWith('/catalog/list?types=ITEM')) throw new Error(`unexpected ${path}`)
    const half = Math.ceil(objects.length / 2)
    return path.includes('cursor=') ? { objects: objects.slice(half) } : { objects: objects.slice(0, half), cursor: 'c2' }
  })
}

beforeEach(() => {
  tag = `T${++n}`
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.squareFetch.mockReset().mockRejectedValue(new Error('no Square'))
  mocks.getEventMeta.mockReset().mockResolvedValue(null)
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.providerWrites.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  // Read-only toward Square, always: no provider write, no non-GET catalog call.
  expect(mocks.providerWrites).not.toHaveBeenCalled()
  for (const [, init] of mocks.squareFetch.mock.calls) expect(init?.method ?? 'GET').toBe('GET')
})

describe('POST /api/admin/classes/import-square.json', () => {
  it('refuses without the owner cookie and reads nothing', async () => {
    const res = await post({ dryRun: true }, false)
    expect(res.status).toBe(401)
    expect(mocks.listAllWorkshops).not.toHaveBeenCalled()
    expect(mocks.squareFetch).not.toHaveBeenCalled()
  })

  it('maps a Square class to a library class: price, photo, ages, event settings, questions', async () => {
    const a = workshop('Pumpkins', { totalCapacity: 14 })
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    mocks.getEventMeta.mockImplementation(async (kind: string, id: string) => (kind === 'workshop' && id === a.scheduleId ? {
      ...emptyEventMeta(), dropOff: true, madeToOrder: true, capacity: 10, signupCutoffHours: 48,
      options: [{ id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Orange', 'White'] }],
    } : null))

    const res = await post({ dryRun: false })
    expect(res.status).toBe(200)
    expect(res.body.data.skip).toEqual([])
    expect(res.body.data.create).toHaveLength(1)
    const id = res.body.data.create[0].id
    const lib = (await getLibrary(id))!
    expect(lib.importKey).toBe('ITEM-Pumpkins')
    expect(lib.legacyScheduleIds).toEqual([a.scheduleId])
    expect(lib.versions).toHaveLength(1)
    expect(lib.versions[0]).toMatchObject({ version: 1, note: 'Imported from Square', by: { id: 'admin', name: 'Owner' } })
    expect(lib.versions[0].content).toMatchObject({
      name: a.name,
      description: a.description,
      imageUrl: 'https://img.example/Pumpkins.jpg',
      instructor: null,
      ticketTypes: [{ id: 'person', label: 'Person' }],
      passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
      prices: { all: { person: 3500 } },
      questions: [{ id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Orange', 'White'] }],
      addOns: [],
      defaultCapacity: 10,
      defaultMinutes: 120,
      rules: { ages: 'Ages 8+', dropOff: true, madeToOrder: true, taxable: true, signupCutoffHours: 48 },
    })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-library-import-square', details: { added: 1, photos: 0, skipped: 0 } }))
  })

  it('several dates of one class make one library class carrying every schedule id', async () => {
    const a1 = workshop('Wreaths', { startAt: '2026-12-01T22:00:00.000Z' })
    const a2 = { ...workshop('Wreaths', { startAt: '2026-12-08T22:00:00.000Z' }), scheduleId: 'sched-Wreaths-2' }
    mocks.listAllWorkshops.mockResolvedValue([a2, a1])
    catalog([a1])
    const res = await post({ dryRun: false })
    expect(res.body.data.create).toHaveLength(1)
    const lib = (await getLibrary(res.body.data.create[0].id))!
    expect(lib.legacyScheduleIds).toEqual(['sched-Wreaths', 'sched-Wreaths-2'])
  })

  it('a dry run lists what would be added and skipped, and writes nothing', async () => {
    const a = workshop('Candles'), free = workshop('Freebie', { priceCents: 0 })
    mocks.listAllWorkshops.mockResolvedValue([a, free])
    catalog([a, free])
    const before = (await listLibrary({ includeArchived: true })).length
    const res = await post({ dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      create: [{ name: a.name, priceCents: 3500, imageUrl: 'https://img.example/Candles.jpg', ages: 'Ages 8+', issues: [] }],
      skip: [{ name: free.name, reason: 'It has no price in Square.' }],
      addPhoto: [],
    })
    expect((await listLibrary({ includeArchived: true })).length).toBe(before)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('defaults to a dry run when dryRun is not given', async () => {
    const a = workshop('Mugs')
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    const before = (await listLibrary({ includeArchived: true })).length
    const res = await post({})
    expect(res.body.data.create).toHaveLength(1)
    expect(res.body.data.create[0].id).toBeUndefined()
    expect((await listLibrary({ includeArchived: true })).length).toBe(before)
  })

  it('running it again adds nothing twice', async () => {
    const a = workshop('Soap'), b = workshop('Terrariums')
    mocks.listAllWorkshops.mockResolvedValue([a, b])
    catalog([a, b])
    const first = await post({ dryRun: false })
    expect(first.body.data.create.map((c: any) => c.name)).toEqual([a.name, b.name])
    const count = (await listLibrary({ includeArchived: true })).length
    const second = await post({ dryRun: false })
    expect(second.body.data.create).toEqual([])
    expect(second.body.data.skip).toEqual([
      { name: a.name, reason: 'Already in the library.' },
      { name: b.name, reason: 'Already in the library.' },
    ])
    expect((await listLibrary({ includeArchived: true })).length).toBe(count)
  })

  it('skips a class whose name the library already has', async () => {
    const a = workshop('Ornaments')
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    await saveLibraryVersion({ content: contentFromSquare(a, null), by: { id: 'admin', name: 'Owner' }, note: 'by hand' })
    const res = await post({ dryRun: false })
    expect(res.body.data.create).toEqual([])
    expect(res.body.data.skip).toEqual([{ name: a.name, reason: 'A class with this name is already in the library.' }])
  })

  it('a class with no Square item is keyed by its name', async () => {
    const a = workshop('Orphan')
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([])
    const res = await post({ dryRun: false })
    const lib = (await getLibrary(res.body.data.create[0].id))!
    expect(lib.importKey).toBe(`name:${a.name.toLowerCase()}`)
  })

  it('keeps a drop-off rule from the description even when event settings exist without it', async () => {
    const a = workshop('PNO')
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    mocks.getEventMeta.mockResolvedValue({ ...emptyEventMeta(), dropOff: false, capacity: 8 })
    const res = await post({ dryRun: false })
    const lib = (await getLibrary(res.body.data.create[0].id))!
    expect(lib.versions[0].content.rules.dropOff).toBe(true)
    expect(lib.versions[0].content.defaultCapacity).toBe(8)
  })

  it('event settings saying drop-off win over a description that does not', async () => {
    const a = workshop('Camp', { description: 'Make stuff.' })
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    mocks.getEventMeta.mockResolvedValue({ ...emptyEventMeta(), dropOff: true })
    const res = await post({ dryRun: false })
    expect((await getLibrary(res.body.data.create[0].id))!.versions[0].content.rules.dropOff).toBe(true)
  })

  it('flags no photo, differing prices and tax-free in the dry run; a tax-free class imports untaxed', async () => {
    const a1 = workshop('Glass', { imageUrl: undefined, taxPercent: 0, priceCents: 3500, startAt: '2026-12-01T22:00:00.000Z' })
    const a2 = { ...workshop('Glass', { imageUrl: undefined, taxPercent: 0, priceCents: 4250, startAt: '2026-12-08T22:00:00.000Z' }), scheduleId: 'sched-Glass-2' }
    const taxed = workshop('Taxed', { taxPercent: 9 })
    mocks.listAllWorkshops.mockResolvedValue([a1, a2, taxed])
    catalog([a1, taxed])
    const dry = await post({ dryRun: true })
    expect(dry.body.data.create).toHaveLength(2)
    expect(dry.body.data.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: a1.name, priceCents: 3500, imageUrl: null, issues: ['No photo found', 'Prices differ across dates ($35–$42.50)', 'Tax-free in Square'] }),
      expect.objectContaining({ name: taxed.name, issues: [] }),
    ]))
    const res = await post({ dryRun: false })
    const idOf = (name: string) => res.body.data.create.find((c: any) => c.name === name).id
    expect((await getLibrary(idOf(a1.name)))!.versions[0].content.rules.taxable).toBe(false)
    expect((await getLibrary(idOf(taxed.name)))!.versions[0].content.rules.taxable).toBe(true)
  })

  it('a later run fills a photo missing at import, once, without adding a second class', async () => {
    const a = workshop('Clay', { imageUrl: undefined })
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    const first = await post({ dryRun: false })
    const id = first.body.data.create[0].id
    const count = (await listLibrary({ includeArchived: true })).length

    mocks.listAllWorkshops.mockResolvedValue([{ ...a, imageUrl: 'https://img.example/clay.jpg' }])
    const dry = await post({ dryRun: true })
    expect(dry.body.data).toEqual({ create: [], skip: [], addPhoto: [{ id, name: a.name, imageUrl: 'https://img.example/clay.jpg' }] })
    expect((await getLibrary(id))!.versions).toHaveLength(1)

    const run = await post({ dryRun: false })
    expect(run.body.data.addPhoto).toEqual([{ id, name: a.name, imageUrl: 'https://img.example/clay.jpg' }])
    const lib = (await getLibrary(id))!
    expect(lib.versions).toHaveLength(2)
    expect(lib.versions[1]).toMatchObject({ version: 2, note: 'Photo from Square', content: { imageUrl: 'https://img.example/clay.jpg', name: a.name } })
    expect((await listLibrary({ includeArchived: true })).length).toBe(count)

    const again = await post({ dryRun: false })
    expect(again.body.data).toEqual({ create: [], skip: [{ name: a.name, reason: 'Already in the library.' }], addPhoto: [] })
    expect((await getLibrary(id))!.versions).toHaveLength(2)
  })

  it('never fills a photo once the owner has edited the imported class', async () => {
    const a = workshop('Edited', { imageUrl: undefined })
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    const id = (await post({ dryRun: false })).body.data.create[0].id
    const lib = (await getLibrary(id))!
    await saveLibraryVersion({ id, content: { ...lib.versions[0].content, description: 'Mine now.' }, by: { id: 'admin', name: 'Owner' }, note: 'edit' })
    mocks.listAllWorkshops.mockResolvedValue([{ ...a, imageUrl: 'https://img.example/x.jpg' }])
    const res = await post({ dryRun: false })
    expect(res.body.data.addPhoto).toEqual([])
    expect((await getLibrary(id))!.versions).toHaveLength(2)
  })

  it('compares names in full, not cut to 80 characters', async () => {
    const long = 'A'.repeat(80)
    const a = workshop(`${long}-and-more`)
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    // The library has a class whose name is the first 80 characters: a different class.
    await saveLibraryVersion({ content: contentFromSquare({ ...a, name: long }, null), by: { id: 'admin', name: 'Owner' }, note: 'by hand' })
    const dry = await post({ dryRun: true })
    expect(dry.body.data.skip).toEqual([])
    expect(dry.body.data.create[0].issues).toContain('Name shortened to 80 characters')

    const same = workshop('Spaced   Name')
    mocks.listAllWorkshops.mockResolvedValue([same])
    catalog([same])
    await saveLibraryVersion({ content: contentFromSquare({ ...same, name: `  spaced name ${tag.toLowerCase()} ` }, null), by: { id: 'admin', name: 'Owner' }, note: 'by hand' })
    expect((await post({ dryRun: true })).body.data.skip).toEqual([{ name: same.name, reason: 'A class with this name is already in the library.' }])
  })

  it('a failed audit write still answers 200 with what was added', async () => {
    const a = workshop('Audit')
    mocks.listAllWorkshops.mockResolvedValue([a])
    catalog([a])
    mocks.audit.mockRejectedValue(new Error('audit store down'))
    const res = await post({ dryRun: false })
    expect(res.status).toBe(200)
    expect(res.body.data.create).toHaveLength(1)
    expect(await getLibrary(res.body.data.create[0].id)).not.toBeNull()
  })

  it('with no Square classes it reads nothing else and adds nothing', async () => {
    const res = await post({ dryRun: false })
    expect(res.body.data).toEqual({ create: [], skip: [], addPhoto: [] })
    expect(mocks.squareFetch).not.toHaveBeenCalled()
  })

  it('a catalog read failure adds nothing', async () => {
    mocks.listAllWorkshops.mockResolvedValue([workshop('Broken')])
    const before = (await listLibrary({ includeArchived: true })).length
    const res = await post({ dryRun: false })
    expect(res.status).toBe(503)
    expect((await listLibrary({ includeArchived: true })).length).toBe(before)
  })
})
