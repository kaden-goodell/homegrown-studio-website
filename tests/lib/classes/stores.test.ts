import { describe, it, expect, vi } from 'vitest'

const hook = vi.hoisted(() => ({ failNextCas: 0, failIndexCas: 0, gets: [] as string[] }))
vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (...a: Parameters<typeof real.makeKvStore>) => {
      const kv = real.makeKvStore(...a)
      return {
        ...kv,
        get: async (k: string) => { hook.gets.push(k); return kv.get(k) },
        setIfMatch: async (...b: Parameters<typeof kv.setIfMatch>) => {
          if (hook.failIndexCas > 0 && b[0] === 'index') { hook.failIndexCas--; return false }
          if (hook.failNextCas > 0) { hook.failNextCas--; return false }
          return kv.setIfMatch(...b)
        },
      }
    },
  }
})
import { listLibrary, getLibrary, saveLibraryVersion, restoreLibraryVersion, archiveLibrary } from '@lib/classes/library-store'
import { createClass, getClass, listClasses, StaleClassError, updateClass, CLASS_INDEX_KEY } from '@lib/classes/class-store'
import { makeKvStore } from '@lib/blob-store'
import { addBlocked, listBlocked, removeBlocked } from '@lib/classes/blocked-time'
import type { ClassContent, Session } from '@lib/classes/types'

const by = { id: 'k', name: 'Kaden' }
const by2 = { id: 'c', name: 'Catherine' }
function content(name = 'Pottery'): ClassContent {
  return {
    name, description: '', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  }
}
const ses = (id: string, start: string, end: string): Session => ({ id, startIso: start, endIso: end, capacity: 12 })

describe('library store', () => {
  it('versions increment, keep by, restore appends, archive hides', async () => {
    const a = await saveLibraryVersion({ content: content('A1'), by, note: 'first' })
    expect(a.id).toMatch(/^lib_/); expect(a.versions[0].version).toBe(1)
    const b = await saveLibraryVersion({ id: a.id, content: content('A2'), by: by2, note: 'second' })
    expect(b.versions.map((v) => v.version)).toEqual([1, 2]); expect(b.versions[1].by).toEqual(by2)
    const c = await restoreLibraryVersion(a.id, 1, by)
    expect(c.versions).toHaveLength(3); expect(c.versions[2].version).toBe(3); expect(c.versions[2].content.name).toBe('A1')
    expect((await getLibrary(a.id))!.versions).toHaveLength(3)
    await archiveLibrary(a.id, true, by)
    expect((await listLibrary()).some((l) => l.id === a.id)).toBe(false)
    expect((await listLibrary({ includeArchived: true })).some((l) => l.id === a.id)).toBe(true)
    await archiveLibrary(a.id, false, by)
    expect((await listLibrary()).some((l) => l.id === a.id)).toBe(true)
  })
  it('refuses invalid content with the validation message', async () => {
    await expect(saveLibraryVersion({ content: { ...content(), name: '' }, by, note: '' })).rejects.toThrow('Give the class a name.')
  })
})

describe('class store', () => {
  it('creates, gets, updates with history capped at 100', async () => {
    const c = await createClass({ content: content(), sessions: [ses('ses_1', '2031-01-05T18:00:00Z', '2031-01-05T19:30:00Z')], status: 'draft', by })
    expect(c.id).toMatch(/^cls_/); expect(await getClass(c.id)).toEqual(c)
    let last = c
    for (let i = 0; i < 105; i++) last = await updateClass(c.id, { status: i % 2 ? 'open' : 'closed' }, by2, `change ${i}`)
    expect(last.history).toHaveLength(100); expect(last.history[99].change).toBe('change 104'); expect(last.history[99].by).toEqual(by2)
  })
  it('refuses invalid content and sessions', async () => {
    await expect(createClass({ content: { ...content(), name: '' }, sessions: [ses('s', '2031-01-05T18:00:00Z', '2031-01-05T19:00:00Z')], status: 'draft', by })).rejects.toThrow('Give the class a name.')
    await expect(createClass({ content: content(), sessions: [], status: 'draft', by })).rejects.toThrow('Add at least one session.')
    const c = await createClass({ content: content(), sessions: [ses('s', '2031-01-05T18:00:00Z', '2031-01-05T19:00:00Z')], status: 'draft', by })
    await expect(updateClass(c.id, { sessions: [] }, by, 'x')).rejects.toThrow('Add at least one session.')
  })
  it('refuses a save made from an older copy (expectedUpdatedAt)', async () => {
    const c = await createClass({ content: content(), sessions: [ses('s', '2031-01-05T18:00:00Z', '2031-01-05T19:00:00Z')], status: 'draft', by })
    const a = await updateClass(c.id, { status: 'open' }, by, 'first', { expectedUpdatedAt: c.updatedAt })
    await expect(updateClass(c.id, { status: 'closed' }, by2, 'stale', { expectedUpdatedAt: c.updatedAt })).rejects.toThrow(StaleClassError)
    expect((await getClass(c.id))!.status).toBe('open')
    expect((await updateClass(c.id, { status: 'closed' }, by2, 'fresh', { expectedUpdatedAt: a.updatedAt })).status).toBe('closed')
  })
  it('retries a lost CAS and gives up after three', async () => {
    const c = await createClass({ content: content(), sessions: [ses('s', '2031-01-05T18:00:00Z', '2031-01-05T19:00:00Z')], status: 'draft', by })
    hook.failNextCas = 1
    expect((await updateClass(c.id, { status: 'open' }, by, 'open')).status).toBe('open')
    hook.failNextCas = 3
    await expect(updateClass(c.id, { status: 'closed' }, by, 'x')).rejects.toThrow('Concurrent update')
    hook.failNextCas = 0
    expect((await getClass(c.id))!.status).toBe('open')
  })
  it('lists by overlapping range, sorted by first session', async () => {
    const early = await createClass({ content: content('E'), sessions: [ses('a', '2040-03-01T10:00:00Z', '2040-03-01T11:00:00Z'), ses('b', '2040-03-20T10:00:00Z', '2040-03-20T11:00:00Z')], status: 'open', by })
    const late = await createClass({ content: content('L'), sessions: [ses('a', '2040-03-10T10:00:00Z', '2040-03-10T11:00:00Z')], status: 'open', by })
    const inRange = await listClasses({ fromIso: '2040-03-05T00:00:00Z', toIso: '2040-03-15T00:00:00Z' })
    expect(inRange.map((x) => x.id)).toEqual([late.id])
    const wide = await listClasses({ fromIso: '2040-03-01T00:00:00Z', toIso: '2040-04-01T00:00:00Z' })
    expect(wide.map((x) => x.id)).toEqual([early.id, late.id])
    // second session of `early` overlaps a later window
    expect((await listClasses({ fromIso: '2040-03-19T00:00:00Z', toIso: '2040-03-21T00:00:00Z' })).map((x) => x.id)).toEqual([early.id])
    expect((await listClasses()).length).toBeGreaterThanOrEqual(2)
  })
  it('lists in first-session order whatever order classes were created, and skips classes outside the range', async () => {
    const z = await createClass({ content: content('Z'), sessions: [ses('a', '2041-06-09T10:00:00Z', '2041-06-09T11:00:00Z')], status: 'open', by })
    const x = await createClass({ content: content('X'), sessions: [ses('a', '2041-06-01T10:00:00Z', '2041-06-01T11:00:00Z')], status: 'draft', by })
    const y = await createClass({ content: content('Y'), sessions: [ses('a', '2041-06-05T10:00:00Z', '2041-06-05T11:00:00Z')], status: 'cancelled', by })
    await createClass({ content: content('Out'), sessions: [ses('a', '2041-07-05T10:00:00Z', '2041-07-05T11:00:00Z')], status: 'open', by })
    const got = await listClasses({ fromIso: '2041-06-01T00:00:00Z', toIso: '2041-06-10T00:00:00Z' })
    expect(got.map((c) => c.id)).toEqual([x.id, y.id, z.id])
    expect(got.map((c) => c.content.name)).toEqual(['X', 'Y', 'Z'])
  })
})

describe('class index (range reads only the classes that can match)', () => {
  const raw = makeKvStore('classes', 'classes')
  const readIndex = async () => JSON.parse((await raw.get(CLASS_INDEX_KEY)) ?? 'null')
  const range = { fromIso: '2042-02-01T00:00:00Z', toIso: '2042-02-10T00:00:00Z' }

  it('a range query reads only the classes whose sessions fall near it', async () => {
    const inside = await createClass({ content: content('In'), sessions: [ses('a', '2042-02-03T10:00:00Z', '2042-02-03T11:00:00Z')], status: 'open', by })
    const outside = await createClass({ content: content('Out'), sessions: [ses('a', '2042-05-03T10:00:00Z', '2042-05-03T11:00:00Z')], status: 'open', by })
    hook.gets = []
    const got = await listClasses(range)
    expect(got.map((c) => c.id)).toEqual([inside.id])
    expect(hook.gets).toContain(`class-${inside.id}`)
    expect(hook.gets).not.toContain(`class-${outside.id}`)
  })

  it('stays right across create, moving sessions, and cancelling', async () => {
    const c = await createClass({ content: content('Mover'), sessions: [ses('a', '2042-03-03T10:00:00Z', '2042-03-03T11:00:00Z')], status: 'open', by })
    const march = { fromIso: '2042-03-01T00:00:00Z', toIso: '2042-03-10T00:00:00Z' }
    const april = { fromIso: '2042-04-01T00:00:00Z', toIso: '2042-04-10T00:00:00Z' }
    expect((await listClasses(march)).map((x) => x.id)).toContain(c.id)
    await updateClass(c.id, { sessions: [ses('a', '2042-04-03T10:00:00Z', '2042-04-03T11:00:00Z'), ses('b', '2042-04-08T10:00:00Z', '2042-04-08T11:00:00Z')] }, by, 'moved')
    expect((await listClasses(march)).map((x) => x.id)).not.toContain(c.id)
    expect((await listClasses(april)).map((x) => x.id)).toContain(c.id)
    expect((await readIndex()).entries[c.id]).toMatchObject({ first: '2042-04-03T10:00:00.000Z', last: '2042-04-08T11:00:00.000Z' })
    await updateClass(c.id, { status: 'cancelled' }, by, 'cancelled')
    // Cancelled classes are still listed (callers filter by status), just as before.
    const after = await listClasses(april)
    expect(after.find((x) => x.id === c.id)?.status).toBe('cancelled')
  })

  it('rebuilds itself by one full scan when the index is missing or unreadable', async () => {
    const c = await createClass({ content: content('Heal'), sessions: [ses('a', '2042-06-03T10:00:00Z', '2042-06-03T11:00:00Z')], status: 'open', by })
    await raw.set(CLASS_INDEX_KEY, 'not json')
    const june = { fromIso: '2042-06-01T00:00:00Z', toIso: '2042-06-10T00:00:00Z' }
    expect((await listClasses(june)).map((x) => x.id)).toEqual([c.id])
    const idx = await readIndex()
    expect(idx.entries[c.id]).toMatchObject({ first: '2042-06-03T10:00:00.000Z' })
    // rebuilt: the next query reads only matching classes again
    hook.gets = []
    await listClasses(june)
    expect(hook.gets.filter((k) => k.startsWith('class-'))).toEqual([`class-${c.id}`])
  })

  it('picks up a class the index never heard of (written by an older server)', async () => {
    const c = await createClass({ content: content('Stray'), sessions: [ses('a', '2042-07-03T10:00:00Z', '2042-07-03T11:00:00Z')], status: 'open', by })
    const idx = await readIndex()
    delete idx.entries[c.id]
    await raw.set(CLASS_INDEX_KEY, JSON.stringify(idx))
    expect((await listClasses({ fromIso: '2042-07-01T00:00:00Z', toIso: '2042-07-10T00:00:00Z' })).map((x) => x.id)).toEqual([c.id])
    expect((await readIndex()).entries[c.id]).toBeTruthy()
  })

  it('an index write that keeps losing marks the index stale, so the next read rebuilds it', async () => {
    const c = await createClass({ content: content('Lost'), sessions: [ses('a', '2042-08-03T10:00:00Z', '2042-08-03T11:00:00Z')], status: 'open', by })
    hook.failIndexCas = 3
    await updateClass(c.id, { sessions: [ses('a', '2042-09-03T10:00:00Z', '2042-09-03T11:00:00Z')] }, by, 'moved')
    hook.failIndexCas = 0
    expect((await readIndex()).stale).toBe(true)
    expect((await listClasses({ fromIso: '2042-09-01T00:00:00Z', toIso: '2042-09-10T00:00:00Z' })).map((x) => x.id)).toEqual([c.id])
    expect((await readIndex()).stale).toBeFalsy()
  })
})

describe('blocked time', () => {
  it('adds, lists by range, removes', async () => {
    const b = await addBlocked({ startIso: '2045-05-01T12:00:00-05:00', endIso: '2045-05-01T20:00:00Z', reason: 'Plumber', by })
    expect(b.id).toMatch(/^blk_/); expect(b.startIso).toBe('2045-05-01T17:00:00.000Z')
    expect((await listBlocked({ fromIso: '2045-05-01T00:00:00Z', toIso: '2045-05-02T00:00:00Z' })).map((x) => x.id)).toEqual([b.id])
    expect(await listBlocked({ fromIso: '2045-06-01T00:00:00Z', toIso: '2045-06-02T00:00:00Z' })).toEqual([])
    await removeBlocked(b.id, by)
    expect(await listBlocked({ fromIso: '2045-05-01T00:00:00Z', toIso: '2045-05-02T00:00:00Z' })).toEqual([])
  })
  it('lists only live blocks in range, sorted by start, whatever order they were added', async () => {
    const c = await addBlocked({ startIso: '2046-02-03T10:00:00Z', endIso: '2046-02-03T11:00:00Z', reason: 'C', by })
    const a = await addBlocked({ startIso: '2046-02-01T10:00:00Z', endIso: '2046-02-01T11:00:00Z', reason: 'A', by })
    const gone = await addBlocked({ startIso: '2046-02-02T10:00:00Z', endIso: '2046-02-02T11:00:00Z', reason: 'X', by })
    const b = await addBlocked({ startIso: '2046-02-02T12:00:00Z', endIso: '2046-02-02T13:00:00Z', reason: 'B', by })
    await addBlocked({ startIso: '2046-03-01T10:00:00Z', endIso: '2046-03-01T11:00:00Z', reason: 'out of range', by })
    await removeBlocked(gone.id, by)
    const got = await listBlocked({ fromIso: '2046-02-01T00:00:00Z', toIso: '2046-02-04T00:00:00Z' })
    expect(got.map((x) => x.id)).toEqual([a.id, b.id, c.id])
  })
  it('refuses end before start and long reasons', async () => {
    await expect(addBlocked({ startIso: '2045-05-01T12:00:00Z', endIso: '2045-05-01T12:00:00Z', reason: '', by })).rejects.toThrow('end after it starts')
    await expect(addBlocked({ startIso: '2045-05-01T12:00:00Z', endIso: '2045-05-01T13:00:00Z', reason: 'x'.repeat(121), by })).rejects.toThrow('120')
    await expect(addBlocked({ startIso: 'nope', endIso: '2045-05-01T13:00:00Z', reason: '', by })).rejects.toThrow()
  })
})
