/**
 * What owners decided in /admin › To decide (one small record per item), so
 * an item decided there stops showing anywhere else: the /staff warnings, the
 * daily email and the minimum-to-run alerts. Server only.
 */
import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'

export const decidedKv = makeKvStore('to-decide', 'to-decide')

/** An id the /admin address bar can carry (plain, at most 110 characters). The one form every decided id is kept in. */
export function tokenOf(raw: string): string {
  return /^[A-Za-z0-9._-]{1,110}$/.test(raw) ? raw : `h${createHash('sha1').update(raw).digest('hex').slice(0, 24)}`
}

/** The To decide id of "short of its minimum" for a class, in the same form as decided ids (N4). */
export const minimumItemId = (classId: string) => tokenOf(`min-${classId}`)

/** Ids decided (and not undone). A failed read counts as none decided: things show rather than hide. */
export async function decidedIds(): Promise<Set<string>> {
  try {
    const keys = (await decidedKv.list()).filter((k) => k.startsWith('done-'))
    const vals = await Promise.all(keys.map((k) => decidedKv.get(k)))
    return new Set(keys.filter((_, i) => !!vals[i]).map((k) => k.slice(5)))
  } catch {
    return new Set()
  }
}
