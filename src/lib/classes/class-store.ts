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
  const out: ScheduledClass[] = []
  for (const k of await kv.list()) {
    if (!k.startsWith('class-')) continue
    const json = await kv.get(k)
    if (!json) continue
    const c = JSON.parse(json) as ScheduledClass
    if (range) {
      const from = Date.parse(range.fromIso), to = Date.parse(range.toIso)
      if (!c.sessions.some((s) => Date.parse(s.startIso) < to && Date.parse(s.endIso) > from)) continue
    }
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

export async function updateClass(
  id: string,
  patch: { content?: ClassContent; sessions?: Session[]; status?: ClassStatus; square?: ScheduledClass['square'] },
  by: By,
  change: string,
): Promise<ScheduledClass> {
  const content = patch.content !== undefined ? okContent(patch.content) : undefined
  const sessions = patch.sessions !== undefined ? okSessions(patch.sessions) : undefined
  const k = key(id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    if (!value) throw new Error('That class does not exist.')
    const cur = JSON.parse(value) as ScheduledClass
    const now = new Date().toISOString()
    const next: ScheduledClass = {
      ...cur,
      content: content ?? cur.content,
      sessions: sessions ?? cur.sessions,
      status: patch.status ?? cur.status,
      square: patch.square ?? cur.square,
      updatedAt: now,
      history: [...cur.history, { at: now, by, change }].slice(-HISTORY_CAP),
    }
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, true)) return next
  }
  throw new Error('Concurrent update — please retry')
}
