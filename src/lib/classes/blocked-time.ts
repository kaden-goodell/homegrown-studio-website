import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { newId, toIso } from './validate'

export interface BlockedTime { id: string; startIso: string; endIso: string; reason: string; by: By; at: string }

// The kv store has no delete, so a removed block stays as a tombstone that listings skip.
interface Stored extends BlockedTime { removed?: { by: By; at: string } }

const kv = makeKvStore('blocked-time', 'blocked-time')
const key = (id: string) => `blocked-${id}`
const MAX_REASON = 120

export async function listBlocked(range?: { fromIso: string; toIso: string }): Promise<BlockedTime[]> {
  const from = range ? Date.parse(range.fromIso) : 0
  const to = range ? Date.parse(range.toIso) : 0
  const keys = (await kv.list()).filter((k) => k.startsWith('blocked-'))
  // Read in parallel: this sits on the public party picker path.
  const jsons = await Promise.all(keys.map((k) => kv.get(k)))
  const out: BlockedTime[] = []
  for (const json of jsons) {
    if (!json) continue
    const b = JSON.parse(json) as Stored
    if (b.removed) continue
    if (range && !(Date.parse(b.startIso) < to && Date.parse(b.endIso) > from)) continue
    out.push(b)
  }
  return out.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
}

export async function addBlocked(input: { startIso: string; endIso: string; reason: string; by: By }): Promise<BlockedTime> {
  const startIso = toIso(input.startIso), endIso = toIso(input.endIso)
  if (!startIso || !endIso) throw new Error('Blocked time needs a start and an end time.')
  if (Date.parse(endIso) <= Date.parse(startIso)) throw new Error('Blocked time has to end after it starts.')
  const reason = (input.reason ?? '').trim()
  if (reason.length > MAX_REASON) throw new Error(`The reason can be up to ${MAX_REASON} characters.`)
  const b: BlockedTime = { id: newId('blk'), startIso, endIso, reason, by: input.by, at: new Date().toISOString() }
  await kv.set(key(b.id), JSON.stringify(b))
  return b
}

export async function removeBlocked(id: string, by: By): Promise<void> {
  const k = key(id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    if (!value) return
    const cur = JSON.parse(value) as Stored
    if (cur.removed) return
    const next: Stored = { ...cur, removed: { by, at: new Date().toISOString() } }
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, true)) return
  }
  throw new Error('Concurrent update — please retry')
}
