import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { ClassContent, ClassStatus, ScheduledClass, Session } from './types'
import { newId, validateContent, validateSessions } from './validate'

const kv = makeKvStore('classes', 'classes')
const key = (id: string) => `class-${id}`
const HISTORY_CAP = 100

function okContent(c: unknown): ClassContent {
  const r = validateContent(c)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
function okSessions(s: unknown): Session[] {
  const r = validateSessions(s)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

export async function getClass(id: string): Promise<ScheduledClass | null> {
  const json = await kv.get(key(id))
  return json ? (JSON.parse(json) as ScheduledClass) : null
}

/**
 * The class index: one small document listing every class id with its first
 * session start and last session end, so a range query reads only the
 * classes that can fall in it rather than every class ever made (audit M2).
 * Kept up to date on create and update (cancelling is an update) with
 * compare-and-swap. It heals itself: a missing or unreadable index is rebuilt
 * by one full scan; a class the index never heard of (an older server wrote
 * it) is added on the next read; an index write that keeps losing marks the
 * index stale so the next read rebuilds it; and an index built more than a
 * day ago is rebuilt anyway, so a server that died between the class write
 * and the index write leaves it wrong for a day at most.
 *
 * A save always writes its own entry, even with no usable index (it then
 * starts a partial one, by compare-and-swap): a reader rebuilding from what
 * it read before that save then loses its own compare-and-swap, so it can
 * never put the class back where it was. Classes missing from a partial
 * index are read as strays and added.
 *
 * The answer is always the same as reading every class: the index only
 * narrows which ones are read.
 */
export const CLASS_INDEX_KEY = 'index'
/** Rebuild by a full scan once the index is older than this. */
export const CLASS_INDEX_MAX_AGE_MS = 24 * 3_600_000
interface IndexEntry { first: string | null; last: string | null; updatedAt: string }
interface ClassIndex { v: 1; stale?: boolean; builtAt?: string; entries: Record<string, IndexEntry> }

function entryOf(c: ScheduledClass): IndexEntry {
  const starts = c.sessions.map((s) => Date.parse(s.startIso)).filter(Number.isFinite)
  const ends = c.sessions.map((s) => Date.parse(s.endIso)).filter(Number.isFinite)
  return {
    first: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    last: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    updatedAt: c.updatedAt,
  }
}

function parseIndex(json: string | null): ClassIndex | null {
  if (!json) return null
  try {
    const v = JSON.parse(json)
    return v && v.v === 1 && v.entries && typeof v.entries === 'object' && !v.stale ? (v as ClassIndex) : null
  } catch {
    return null
  }
}

/** Upsert one class's entry; an older save never replaces a newer one's entry. */
async function indexClass(c: ScheduledClass): Promise<void> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value, etag } = await kv.getWithMeta(CLASS_INDEX_KEY)
      // No usable index (missing, unreadable or stale): start a partial one with this
      // class, so a reader rebuilding from older reads loses its CAS.
      const idx = parseIndex(value) ?? { v: 1, builtAt: new Date().toISOString(), entries: {} }
      const had = idx.entries[c.id]
      if (had && had.updatedAt > c.updatedAt) return
      idx.entries[c.id] = entryOf(c)
      if (await kv.setIfMatch(CLASS_INDEX_KEY, JSON.stringify(idx), etag, value !== null)) return
    }
  } catch {
    // fall through to marking it stale
  }
  // Could not keep it right: say so, so no read trusts it.
  await kv.set(CLASS_INDEX_KEY, JSON.stringify({ v: 1, stale: true, entries: {} })).catch(() => undefined)
}

/** Best effort: a lost write is fine, the next read tries again. */
async function saveIndex(idx: ClassIndex, etag: string | null, exists: boolean): Promise<void> {
  await kv.setIfMatch(CLASS_INDEX_KEY, JSON.stringify(idx), etag, exists).catch(() => false)
}

const overlaps = (c: ScheduledClass, from: number, to: number) =>
  c.sessions.some((s) => Date.parse(s.startIso) < to && Date.parse(s.endIso) > from)

const byFirstSession = (a: ScheduledClass, b: ScheduledClass) =>
  Date.parse(a.sessions[0]?.startIso ?? '') - Date.parse(b.sessions[0]?.startIso ?? '')

/** Classes with any session overlapping [fromIso, toIso); all when no range. Sorted by first session. */
export async function listClasses(range?: { fromIso: string; toIso: string }): Promise<ScheduledClass[]> {
  const [keys, meta] = await Promise.all([
    kv.list().then((ks) => ks.filter((k) => k.startsWith('class-'))),
    range ? kv.getWithMeta(CLASS_INDEX_KEY) : Promise.resolve(null),
  ])
  const readAll = async (ks: string[]) =>
    (await Promise.all(ks.map((k) => kv.get(k)))).filter((j): j is string => !!j).map((j) => JSON.parse(j) as ScheduledClass)

  if (!range) return (await readAll(keys)).sort(byFirstSession)
  const from = Date.parse(range.fromIso)
  const to = Date.parse(range.toIso)
  const parsed = parseIndex(meta!.value)
  const fresh = parsed && parsed.builtAt && Date.now() - Date.parse(parsed.builtAt) < CLASS_INDEX_MAX_AGE_MS
  const idx = fresh ? parsed : null

  if (!idx) {
    // No usable index, or a day old: one full scan, and build it from what was read.
    const all = await readAll(keys)
    const built: ClassIndex = { v: 1, builtAt: new Date().toISOString(), entries: Object.fromEntries(all.map((c) => [c.id, entryOf(c)])) }
    await saveIndex(built, meta!.etag, meta!.value !== null)
    return all.filter((c) => overlaps(c, from, to)).sort(byFirstSession)
  }

  const ids = keys.map((k) => k.slice('class-'.length))
  const unknown = ids.filter((id) => !idx.entries[id])
  const candidates = ids.filter((id) => {
    const e = idx.entries[id]
    return e && e.first !== null && e.last !== null && Date.parse(e.first) < to && Date.parse(e.last) > from
  })
  // Read in parallel: this sits on the public party picker path.
  const [known, strays] = await Promise.all([readAll(candidates.map(key)), readAll(unknown.map(key))])
  const gone = Object.keys(idx.entries).filter((id) => !ids.includes(id))
  if (strays.length || gone.length) {
    for (const c of strays) idx.entries[c.id] = entryOf(c)
    for (const id of gone) delete idx.entries[id]
    await saveIndex(idx, meta!.etag, true)
  }
  return [...known, ...strays].filter((c) => overlaps(c, from, to)).sort(byFirstSession)
}

/** `id`: the id a create key reserved (R35), so a retry finds the class instead of making a second one. */
export async function createClass(input: {
  content: ClassContent; sessions: Session[]; libraryId?: string; libraryVersion?: number; status: ClassStatus; by: By; id?: string
}): Promise<ScheduledClass> {
  const content = okContent(input.content)
  const sessions = okSessions(input.sessions)
  const now = new Date().toISOString()
  const cls: ScheduledClass = {
    id: input.id ?? newId('cls'),
    libraryId: input.libraryId ?? null,
    libraryVersion: input.libraryVersion ?? null,
    content,
    sessions,
    status: input.status,
    square: { itemId: null, variations: {} },
    createdAt: now,
    updatedAt: now,
    by: input.by,
    history: [{ at: now, by: input.by, change: 'Created' }],
  }
  // Create-only: a second create with the same reserved id (R35) never overwrites the first.
  if (!(await kv.setIfMatch(key(cls.id), JSON.stringify(cls), null, false))) throw new ClassExistsError(cls.id)
  await indexClass(cls)
  return cls
}

/** The class this create was going to make already exists (a retry or a parallel send of the same Add). */
export class ClassExistsError extends Error {
  constructor(public id: string) { super('That class already exists.') }
}

/** A save made from an older copy of the class than the one stored. */
export class StaleClassError extends Error {
  constructor() { super('Someone else changed this class. Reload to see their changes.') }
}

export async function updateClass(
  id: string,
  patch: {
    content?: ClassContent; sessions?: Session[]; status?: ClassStatus; square?: ScheduledClass['square']
    libraryId?: string | null; libraryVersion?: number | null
  },
  by: By,
  change: string,
  opts: { expectedUpdatedAt?: string } = {},
): Promise<ScheduledClass> {
  const content = patch.content !== undefined ? okContent(patch.content) : undefined
  const sessions = patch.sessions !== undefined ? okSessions(patch.sessions) : undefined
  const k = key(id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    if (!value) throw new Error('That class does not exist.')
    const cur = JSON.parse(value) as ScheduledClass
    // Checked on every attempt, against what was just read: a save from a form
    // loaded before someone else's save never overwrites theirs.
    if (opts.expectedUpdatedAt !== undefined && cur.updatedAt !== opts.expectedUpdatedAt) throw new StaleClassError()
    // Always later than the last save, even within the same millisecond, so updatedAt names one version.
    const now = new Date(Math.max(Date.now(), Date.parse(cur.updatedAt) + 1)).toISOString()
    const next: ScheduledClass = {
      ...cur,
      content: content ?? cur.content,
      sessions: sessions ?? cur.sessions,
      status: patch.status ?? cur.status,
      square: patch.square ?? cur.square,
      libraryId: patch.libraryId !== undefined ? patch.libraryId : cur.libraryId,
      libraryVersion: patch.libraryVersion !== undefined ? patch.libraryVersion : cur.libraryVersion,
      updatedAt: now,
      history: [...cur.history, { at: now, by, change }].slice(-HISTORY_CAP),
    }
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, true)) {
      await indexClass(next)
      return next
    }
  }
  throw new Error('Concurrent update — please retry')
}
