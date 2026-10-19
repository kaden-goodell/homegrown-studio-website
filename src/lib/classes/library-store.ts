import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { ClassContent, LibraryClass } from './types'
import { newId, validateContent } from './validate'

const kv = makeKvStore('class-library', 'class-library')
const key = (id: string) => `lib-${id}`

function checked(content: unknown): ClassContent {
  const r = validateContent(content)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** Read-modify-write with compare-and-set, three attempts. */
async function mutate(id: string, fn: (cur: LibraryClass | null) => LibraryClass): Promise<LibraryClass> {
  const k = key(id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const next = fn(value ? (JSON.parse(value) as LibraryClass) : null)
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) return next
  }
  throw new Error('Concurrent update — please retry')
}

export async function listLibrary(opts?: { includeArchived?: boolean }): Promise<LibraryClass[]> {
  const out: LibraryClass[] = []
  for (const k of await kv.list()) {
    if (!k.startsWith('lib-')) continue
    const json = await kv.get(k)
    if (!json) continue
    const lib = JSON.parse(json) as LibraryClass
    if (lib.archived && !opts?.includeArchived) continue
    out.push(lib)
  }
  const last = (l: LibraryClass) => l.versions[l.versions.length - 1]?.at ?? ''
  return out.sort((a, b) => last(b).localeCompare(last(a)))
}

export async function getLibrary(id: string): Promise<LibraryClass | null> {
  const json = await kv.get(key(id))
  return json ? (JSON.parse(json) as LibraryClass) : null
}

export async function saveLibraryVersion(input: { id?: string; content: ClassContent; by: By; note: string }): Promise<LibraryClass> {
  const content = checked(input.content)
  const id = input.id ?? newId('lib')
  return mutate(id, (cur) => {
    if (input.id && !cur) throw new Error('That class is not in the library.')
    const base: LibraryClass = cur ?? { id, archived: false, versions: [] }
    const version = (base.versions[base.versions.length - 1]?.version ?? 0) + 1
    return { ...base, versions: [...base.versions, { version, at: new Date().toISOString(), by: input.by, content, note: input.note }] }
  })
}

export async function restoreLibraryVersion(id: string, version: number, by: By): Promise<LibraryClass> {
  return mutate(id, (cur) => {
    if (!cur) throw new Error('That class is not in the library.')
    const old = cur.versions.find((v) => v.version === version)
    if (!old) throw new Error('That version does not exist.')
    const n = (cur.versions[cur.versions.length - 1]?.version ?? 0) + 1
    return {
      ...cur,
      versions: [...cur.versions, { version: n, at: new Date().toISOString(), by, content: structuredClone(old.content), note: `Restored version ${version}` }],
    }
  })
}

export async function archiveLibrary(id: string, archived: boolean, _by: By): Promise<LibraryClass> {
  return mutate(id, (cur) => {
    if (!cur) throw new Error('That class is not in the library.')
    return { ...cur, archived }
  })
}

/**
 * A class brought in from Square, as version 1. The library id comes from the
 * import key, so two runs (even at the same moment) can't both add it: the
 * write is create-only. Returns null when it is already there.
 */
export async function importLibraryClass(input: {
  importKey: string
  legacyScheduleIds: string[]
  content: ClassContent
  by: By
  note: string
}): Promise<LibraryClass | null> {
  const content = checked(input.content)
  const id = importedLibraryId(input.importKey)
  const k = key(id)
  const { value, etag } = await kv.getWithMeta(k)
  if (value !== null) return null
  const lib: LibraryClass = {
    id,
    archived: false,
    versions: [{ version: 1, at: new Date().toISOString(), by: input.by, content, note: input.note }],
    importKey: input.importKey,
    legacyScheduleIds: [...input.legacyScheduleIds],
  }
  return (await kv.setIfMatch(k, JSON.stringify(lib), etag, false)) ? lib : null
}

/** 'lib_sq' + 12 hex of the import key's hash: stable, and safe in a key. */
export function importedLibraryId(importKey: string): string {
  return `lib_sq${createHash('sha256').update(importKey).digest('hex').slice(0, 12)}`
}
