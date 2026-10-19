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

/** Classes with any session overlapping [fromIso, toIso); all when no range. Sorted by first session. */
export async function listClasses(range?: { fromIso: string; toIso: string }): Promise<ScheduledClass[]> {
  const from = range ? Date.parse(range.fromIso) : 0
  const to = range ? Date.parse(range.toIso) : 0
  const keys = (await kv.list()).filter((k) => k.startsWith('class-'))
  // Read in parallel: this sits on the public party picker path.
  const jsons = await Promise.all(keys.map((k) => kv.get(k)))
  const out: ScheduledClass[] = []
  for (const json of jsons) {
    if (!json) continue
    const c = JSON.parse(json) as ScheduledClass
    if (range && !c.sessions.some((s) => Date.parse(s.startIso) < to && Date.parse(s.endIso) > from)) continue
    out.push(c)
  }
  return out.sort((a, b) => Date.parse(a.sessions[0]?.startIso ?? '') - Date.parse(b.sessions[0]?.startIso ?? ''))
}

export async function createClass(input: {
  content: ClassContent; sessions: Session[]; libraryId?: string; libraryVersion?: number; status: ClassStatus; by: By
}): Promise<ScheduledClass> {
  const content = okContent(input.content)
  const sessions = okSessions(input.sessions)
  const now = new Date().toISOString()
  const cls: ScheduledClass = {
    id: newId('cls'),
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
  await kv.set(key(cls.id), JSON.stringify(cls))
  return cls
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
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, true)) return next
  }
  throw new Error('Concurrent update — please retry')
}
