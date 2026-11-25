import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _setSnapshotDeps, publicWorkshopList, readFreshWorkshopSnapshot, refreshWorkshopSnapshot, SNAPSHOT_FRESH_MS } from '@lib/workshop-snapshot'
import { forgetAll } from '@lib/short-memory'
import { memoryKv } from '../helpers-memory-kv'

const w = (id: string, startAt: string) => ({
  id, scheduleId: `sch-${id}`, name: id, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
  priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
})

let kv: ReturnType<typeof memoryKv>
let now: Date
const load = vi.fn()

beforeEach(() => {
  forgetAll()
  kv = memoryKv()
  now = new Date('2026-11-24T08:00:00Z')
  load.mockReset()
  load.mockResolvedValue([w('a', '2026-11-28T00:00:00Z')])
  _setSnapshotDeps({ store: kv, load, now: () => now })
})
afterEach(() => _setSnapshotDeps(null))

describe('refreshWorkshopSnapshot', () => {
  it('asks Square and saves the list with the time', async () => {
    expect(await refreshWorkshopSnapshot()).toEqual({ saved: true, count: 1 })
    const saved = JSON.parse(kv.data.get('list')!)
    expect(saved.at).toBe('2026-11-24T08:00:00.000Z')
    expect(saved.list.map((x: any) => x.id)).toEqual(['a'])
  })

  it('saves a real empty list (no classes)', async () => {
    load.mockResolvedValue([])
    expect(await refreshWorkshopSnapshot()).toEqual({ saved: true, count: 0 })
    expect(JSON.parse(kv.data.get('list')!).list).toEqual([])
  })

  it('a Square failure never replaces the good copy, and never throws', async () => {
    await refreshWorkshopSnapshot()
    const good = kv.data.get('list')
    load.mockRejectedValue(new Error('Square 503'))
    now = new Date(now.getTime() + 5 * 60_000)
    expect(await refreshWorkshopSnapshot()).toMatchObject({ saved: false, error: 'Square 503' })
    expect(kv.data.get('list')).toBe(good)
  })

  it('a Square answer slower than the timeout is a failure, copy kept', async () => {
    load.mockImplementation(() => new Promise(() => {}))
    expect(await refreshWorkshopSnapshot(20)).toMatchObject({ saved: false })
    expect(kv.data.has('list')).toBe(false)
  })

  it('a store that will not save is a failure, not a throw', async () => {
    kv.set = async () => { throw new Error('blobs down') }
    expect(await refreshWorkshopSnapshot()).toMatchObject({ saved: false, error: 'blobs down' })
  })
})

describe('readFreshWorkshopSnapshot', () => {
  it('nothing saved → null', async () => {
    expect(await readFreshWorkshopSnapshot()).toBeNull()
  })

  it('a copy under 15 minutes old is used', async () => {
    await refreshWorkshopSnapshot()
    now = new Date(now.getTime() + SNAPSHOT_FRESH_MS - 1000)
    expect((await readFreshWorkshopSnapshot())!.map((x) => x.id)).toEqual(['a'])
  })

  it('a copy 15 minutes old or more is not', async () => {
    await refreshWorkshopSnapshot()
    now = new Date(now.getTime() + SNAPSHOT_FRESH_MS)
    expect(await readFreshWorkshopSnapshot()).toBeNull()
  })

  it('drops a class that has started since the copy was saved', async () => {
    load.mockResolvedValue([w('soon', '2026-11-24T08:03:00Z'), w('later', '2026-11-28T00:00:00Z')])
    await refreshWorkshopSnapshot()
    now = new Date('2026-11-24T08:05:00Z')
    expect((await readFreshWorkshopSnapshot())!.map((x) => x.id)).toEqual(['later'])
  })

  it('an unreadable store or a garbled copy reads as none', async () => {
    kv.data.set('list', '{not json')
    expect(await readFreshWorkshopSnapshot()).toBeNull()
    kv.failReads = true
    expect(await readFreshWorkshopSnapshot()).toBeNull()
  })
})

describe('publicWorkshopList', () => {
  it('serves the fresh copy without asking Square', async () => {
    await refreshWorkshopSnapshot()
    load.mockClear()
    forgetAll()
    expect((await publicWorkshopList()).map((x) => x.id)).toEqual(['a'])
    expect(load).not.toHaveBeenCalled()
  })

  it('asks Square live when the copy is stale or missing', async () => {
    await refreshWorkshopSnapshot()
    now = new Date(now.getTime() + SNAPSHOT_FRESH_MS + 1)
    load.mockClear()
    load.mockResolvedValue([w('live', '2026-11-29T00:00:00Z')])
    forgetAll()
    expect((await publicWorkshopList()).map((x) => x.id)).toEqual(['live'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a live failure throws (never an empty list), and is not remembered', async () => {
    load.mockRejectedValueOnce(new Error('Square down'))
    await expect(publicWorkshopList()).rejects.toThrow('Square down')
    expect((await publicWorkshopList()).map((x) => x.id)).toEqual(['a'])
  })
})
