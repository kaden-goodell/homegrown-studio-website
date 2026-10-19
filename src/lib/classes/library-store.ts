import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { contentChanges } from './content-diff'
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

/**
 * A new version of a library class (`id`), or a new library class. `createId`
 * names the new one: if it already exists (a retried create, R35, or a class
 * linked twice at once, R36) it comes back as it is, never a second entry.
 * `expectedVersion`: the version the form was opened on; a save over a newer
 * one is refused (LibraryStaleError).
 */
export async function saveLibraryVersion(input: { id?: string; createId?: string; content: ClassContent; by: By; note: string; expectedVersion?: number }): Promise<LibraryClass> {
  const content = checked(input.content)
  const id = input.id ?? input.createId ?? newId('lib')
  let same: LibraryClass | null = null
  const saved = await mutate(id, (cur) => {
    if (input.createId && !input.id && cur) { same = cur; return cur }
    if (input.id && !cur) throw new Error('That class is not in the library.')
    if (input.expectedVersion !== undefined && cur && cur.versions[cur.versions.length - 1]?.version !== input.expectedVersion) throw new LibraryStaleError()
    const base: LibraryClass = cur ?? { id, archived: false, versions: [] }
    const prev = base.versions[base.versions.length - 1]
    const version = (prev?.version ?? 0) + 1
    const changed = prev ? contentChanges(prev.content, content) : []
    return { ...base, versions: [...base.versions, { version, at: new Date().toISOString(), by: input.by, content, note: input.note, changed }] }
  })
  return same ?? saved
}

/** A library save from a form opened on an older version. */
export class LibraryStaleError extends Error {
  constructor() { super('Someone else changed this library class. Your edits are kept; check them and save again.') }
}

export async function restoreLibraryVersion(id: string, version: number, by: By): Promise<LibraryClass> {
  return mutate(id, (cur) => {
    if (!cur) throw new Error('That class is not in the library.')
    const old = cur.versions.find((v) => v.version === version)
    if (!old) throw new Error('That version does not exist.')
    const prev = cur.versions[cur.versions.length - 1]
    const n = (prev?.version ?? 0) + 1
    const changed = prev ? contentChanges(prev.content, old.content) : []
    return {
      ...cur,
      versions: [...cur.versions, { version: n, at: new Date().toISOString(), by, content: structuredClone(old.content), note: `Restored version ${version}`, changed }],
    }
  })
}

export async function archiveLibrary(id: string, archived: boolean, _by: By): Promise<LibraryClass> {
  return mutate(id, (cur) => {
    if (!cur) throw new Error('That class is not in the library.')
    return { ...cur, archived }
  })
}
