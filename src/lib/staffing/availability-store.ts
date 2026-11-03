/**
 * When each person can work (stage 3). kv `staff-availability`, one record
 * per person (`person-{staffId}`), written compare-and-set with 3 attempts.
 * A save names the `updatedAt` it started from; anything else is refused as
 * stale (409) with what is saved now. The last 50 changes are kept.
 *
 * Nothing is ever stored under a fallback id ('kaden' / 'catherine') or a
 * malformed id. Every write is refused on a test site that shares the live
 * stores (R41). Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import type { By } from '@lib/staff-auth'
import { BUSY_SAVING, StaffingError, STALE_AVAILABILITY, StaleError } from './errors'
import { storableStaffId } from './ids'
import { dayLabel } from './rules'
import type { Availability, DayMark } from './types'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const kv = makeKvStore('staff-availability', 'staff-availability')
const PARALLEL = 8
export const AVAILABILITY_HISTORY_CAP = 50

const keyOf = (staffId: string) => `person-${staffId}`
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parse(json: string | null): Availability | null {
  if (!json) return null
  const a = JSON.parse(json) as Availability | null
  return a ? { ...a, weekly: a.weekly ?? {}, dates: a.dates ?? {}, history: a.history ?? [] } : null
}

export async function getAvailability(staffId: string): Promise<Availability | null> {
  if (!storableStaffId(staffId)) return null
  return parse(await kv.get(keyOf(staffId)))
}

/** Map of the people who have saved something. Reads 8 at a time; throws when the store fails. */
export async function getAvailabilityMany(ids: string[]): Promise<Map<string, Availability>> {
  const wanted = [...new Set(ids.filter(storableStaffId))]
  const out = new Map<string, Availability>()
  for (let i = 0; i < wanted.length; i += PARALLEL) {
    const batch = wanted.slice(i, i + PARALLEL)
    const got = await Promise.all(batch.map((id) => getAvailability(id)))
    got.forEach((a, j) => { if (a) out.set(batch[j], a) })
  }
  return out
}

const same = (a: DayMark | DayMark[] | null | undefined, b: DayMark | DayMark[] | null | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** "Usual week: Sat, Sun; Dates: Sat, Oct 31" — what a save changed, in plain words. */
export function describeAvailabilityChange(before: Pick<Availability, 'weekly' | 'dates'> | null, after: Pick<Availability, 'weekly' | 'dates'>): string {
  const days = ['0', '1', '2', '3', '4', '5', '6'].filter((d) => !same(before?.weekly?.[d], after.weekly[d])).map((d) => DAY_NAMES[+d])
  const allDates = [...new Set([...Object.keys(before?.dates ?? {}), ...Object.keys(after.dates)])].sort()
  const dates = allDates.filter((d) => !same(before?.dates?.[d], after.dates[d])).map(dayLabel)
  const parts: string[] = []
  if (days.length) parts.push(`Usual week: ${days.join(', ')}`)
  if (dates.length) parts.push(`Dates: ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? ` and ${dates.length - 5} more` : ''}`)
  return parts.length ? parts.join('; ') : 'No change'
}

/**
 * Saves a person's times (already checked by validateAvailability).
 * `expectedUpdatedAt`: what the screen loaded (null = nothing saved yet).
 * Stale → StaleError(409, current). updatedAt only moves forward.
 */
export async function saveAvailability(
  staffId: string,
  name: string,
  next: Pick<Availability, 'weekly' | 'dates'>,
  by: By,
  expectedUpdatedAt: string | null,
): Promise<Availability> {
  if (!storableStaffId(staffId)) throw new StaffingError(403, "You're not on the staff list any more. Ask an owner.")
  assertClassWritesAllowed() // R41
  const key = keyOf(staffId)
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(key)
    const cur = parse(value)
    if ((cur?.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) {
      throw new StaleError(STALE_AVAILABILITY, cur ?? emptyAvailability(staffId, name))
    }
    const now = new Date()
    const stamp = cur?.updatedAt && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const change = describeAvailabilityChange(cur, next)
    const saved: Availability = {
      staffId,
      name,
      weekly: next.weekly,
      dates: next.dates,
      updatedAt: stamp,
      history: [{ at: stamp, by, change }, ...(cur?.history ?? [])].slice(0, AVAILABILITY_HISTORY_CAP),
    }
    if (await kv.setIfMatch(key, JSON.stringify(saved), etag, value !== null)) return saved
  }
  throw new StaffingError(503, BUSY_SAVING)
}

export function emptyAvailability(staffId: string, name: string): Availability {
  return {
    staffId, name,
    weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null },
    dates: {}, updatedAt: null, history: [],
  }
}
