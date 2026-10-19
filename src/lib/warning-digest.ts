/**
 * The daily warnings email, undated items (Task 14 concern 4): a counter sale
 * to match, a refund flag, an unpaid door seat, a counter-match check. Each
 * shows in full the first day it appears, then only in one line,
 * "N things still to decide on /admin", on later days, so the email doesn't
 * repeat the same list every morning. Dated warnings are untouched.
 *
 * First-seen days live in one small document; it is written only after the
 * email went (commit), so an email that never went shows the items in full
 * again tomorrow. If it can't be read, everything is shown in full.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { UNDATED_CODES, type Warning } from '@lib/warnings'

const logger = createLogger('warning-digest')
const kv = makeKvStore('warnings-seen', 'warnings-seen')

export const idOf = (w: Warning) => w.itemId ?? `${w.code}|${w.eventId}|${w.when}|${w.detail}`

export function stillToDecideLine(n: number): string {
  return `${n} ${n === 1 ? 'thing' : 'things'} still to decide on /admin`
}

export interface Digest {
  /** Lines to show in full: every dated warning, and undated ones new today. */
  full: Warning[]
  /** Undated items already shown on an earlier day. */
  stillToDecide: number
  /** Remember what was shown today. Call once the email went. Never throws. */
  commit(): Promise<void>
}

/** `scope` keeps tests apart; the job uses the default. */
export async function digestWarnings(warnings: Warning[], today: string, opts: { scope?: string } = {}): Promise<Digest> {
  const key = `seen-${opts.scope ?? 'daily'}`
  let seen: Record<string, string> | null = null
  try {
    const json = await kv.get(key)
    seen = json ? (JSON.parse(json).ids ?? {}) : {}
  } catch (err) {
    logger.warn('First-seen days unreadable: showing everything in full', { error: err instanceof Error ? err.message : String(err) })
  }
  const undated = warnings.filter((w) => UNDATED_CODES.has(w.code))
  const old = seen ? undated.filter((w) => seen![idOf(w)] && seen![idOf(w)] < today) : []
  const oldIds = new Set(old.map(idOf))
  const full = warnings.filter((w) => !(UNDATED_CODES.has(w.code) && oldIds.has(idOf(w))))
  return {
    full,
    stillToDecide: old.length,
    async commit() {
      // Only items still open are kept: one decided and back later is new again.
      const ids: Record<string, string> = {}
      for (const w of undated) ids[idOf(w)] = seen?.[idOf(w)] ?? today
      await kv.set(key, JSON.stringify({ ids })).catch((err) => logger.warn('First-seen days not saved', { error: String(err) }))
    },
  }
}
