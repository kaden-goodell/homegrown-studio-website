/**
 * Open Studio walk-in presence: a day-keyed headcount, not a custody ledger.
 * Open Studio is pay-per-craft, no booking, no drop-off — so unlike
 * `@lib/checkin-store` there's no expected/presence/pickup-code machinery,
 * just "this household showed up today" and who logged it. No pickup codes,
 * no per-person checkout.
 *
 * Netlify Blobs in prod, `.data/open-studio/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'

const logger = createLogger('open-studio-store')
const kv = makeKvStore('open-studio', 'open-studio')

export interface OpenStudioEntry {
  personIds: string[]
  at: string // ISO — last time this household was logged in today
  by: By
}

/** recordId (waiver id) → entry, for one studio-local calendar day. */
export type OpenStudioDay = Record<string, OpenStudioEntry>

function key(date: string): string {
  return `open-studio-${date}`
}

export async function getOpenStudioDay(date: string): Promise<OpenStudioDay> {
  const json = await kv.get(key(date))
  return json ? JSON.parse(json) : {}
}

/**
 * Log a household as present today. Idempotent — checking in the same
 * recordId again just updates `personIds`/`at`/`by`, it doesn't add a
 * second entry. CAS retry (3 attempts) so two devices checking in
 * different households at once don't clobber each other.
 */
export async function checkInOpenStudio(
  date: string,
  recordId: string,
  personIds: string[],
  by: By,
): Promise<OpenStudioDay> {
  const k = key(date)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const day: OpenStudioDay = value ? JSON.parse(value) : {}
    day[recordId] = { personIds, at: new Date().toISOString(), by }
    if (await kv.setIfMatch(k, JSON.stringify(day), etag, value !== null)) {
      logger.info('Open Studio check-in', { date, recordId, count: personIds.length })
      return day
    }
    // Lost the CAS race — retry
  }
  throw new Error('Concurrent update — please retry')
}

/** Total people logged in for the day (summed across households) — the
 *  Today header's "n here now (open studio)" count. */
export async function hereNowCount(date: string): Promise<number> {
  const day = await getOpenStudioDay(date)
  return Object.values(day).reduce((n, e) => n + e.personIds.length, 0)
}
