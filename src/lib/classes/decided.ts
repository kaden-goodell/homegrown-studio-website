/**
 * What owners decided in /admin › To decide (one small record per item), so
 * an item decided there stops showing anywhere else: the /staff warnings, the
 * daily email and the minimum-to-run alerts. Server only.
 */
import { makeKvStore } from '@lib/blob-store'

export const decidedKv = makeKvStore('to-decide', 'to-decide')

/** The To decide id of "short of its minimum" for a class. */
export const minimumItemId = (classId: string) => `min-${classId}`

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
