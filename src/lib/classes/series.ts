/**
 * A weekly class made by Repeat is one class per date, linked by `seriesId`
 * (final review I3). On a class sheet a change or a cancel can then go to
 * "All dates in this series": the dates still to come that aren't cancelled.
 *
 * Safe by the same rules as one class (updateScheduledClass / cancelClass do
 * every check): seats taken never go below what's booked, a price someone
 * booked can't be removed, nobody is refunded or freed. On top of that a date
 * with people booked never has its ways to book, kinds of seat, extras or
 * questions changed from another date's sheet (that would change what booked
 * people bought); it's listed as skipped, with why, and the others go ahead.
 * Cancelling lists who's booked on each date first (seriesInfo).
 */
import type { By } from '@lib/staff-auth'
import { formatDay } from '@lib/studio-time'
import { ActionError, ADMIN_BY, bookedPeople, cancelClass, updateScheduledClass, type BookedPerson } from './admin-actions'
import { getClass, listClasses, StaleClassError } from './class-store'
import { getLedger } from './seat-ledger'
import { takesSeat } from './seat-status'
import { shiftEarlyBird } from './repeat'
import type { ClassContent, ScheduledClass } from './types'

/** Content parts that change what someone booked: never changed on a booked date from another date's sheet. */
const BOOKED_KEEPS: (keyof ClassContent)[] = ['passes', 'ticketTypes', 'addOns', 'questions']
const KEEP_NAME: Partial<Record<keyof ClassContent, string>> = { passes: 'ways to book', ticketTypes: 'kinds of seat', addOns: 'extras', questions: 'questions' }

export interface SeriesMember { id: string; startIso: string; endIso: string; status: ScheduledClass['status']; updatedAt: string; booked: Pick<BookedPerson, 'name' | 'phone' | 'email' | 'seats'>[] }
export interface SeriesSkip { id: string; date: string; reason: string }

const firstStart = (c: ScheduledClass) => c.sessions[0]?.startIso ?? ''
const dateOf = (c: ScheduledClass) => formatDay(firstStart(c)).replace(',', '')
const upcoming = (c: ScheduledClass, now: Date) => c.status !== 'cancelled' && c.sessions.some((s) => Date.parse(s.endIso) > now.getTime())

async function mustClass(id: unknown): Promise<ScheduledClass> {
  const cls = typeof id === 'string' && id ? await getClass(id) : null
  if (!cls) throw new ActionError(404, 'That class is not here any more.')
  return cls
}

/** Every date of the series still to come (this one too), in date order. */
async function members(cls: ScheduledClass, now: Date): Promise<ScheduledClass[]> {
  if (!cls.seriesId) return []
  return (await listClasses())
    .filter((c) => c.seriesId === cls.seriesId && upcoming(c, now))
    .sort((a, b) => firstStart(a).localeCompare(firstStart(b)))
}

/** GET: the series this class is in, each date with who's booked (for the sheet's choices and the cancel list). */
export async function seriesInfo(id: unknown, now = new Date()): Promise<{ data: { members: SeriesMember[] } }> {
  const cls = await mustClass(id)
  const list = await members(cls, now)
  const out = await Promise.all(list.map(async (m): Promise<SeriesMember> => ({
    id: m.id, startIso: firstStart(m), endIso: m.sessions[m.sessions.length - 1]?.endIso ?? '', status: m.status, updatedAt: m.updatedAt,
    booked: bookedPeople(await getLedger(m.id)).map((p) => ({ name: p.name, phone: p.phone, email: p.email, seats: p.seats })),
  })))
  return { data: { members: out } }
}

const differs = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)

function reasonOf(e: unknown): string {
  if (e instanceof ActionError) return e.message
  if (e instanceof StaleClassError) return 'Someone else changed it just now. Open it and try again.'
  throw e
}

/**
 * "All dates in this series" on Details: saves this class exactly as Save
 * does (refusals are hers to fix), then the parts that changed go to every
 * other date still to come. A date that refuses is skipped with why.
 */
export async function updateSeries(body: { id?: unknown; content?: unknown; expectedUpdatedAt?: unknown }, by: By = ADMIN_BY, now = new Date()) {
  const cls = await mustClass(body.id)
  const saved = await updateScheduledClass({ id: cls.id, content: body.content, expectedUpdatedAt: body.expectedUpdatedAt }, by)
  const after = saved.data.class.content
  const keys = (Object.keys({ ...cls.content, ...after }) as (keyof ClassContent)[]).filter((k) => differs(cls.content[k], after[k]))
  const changed: string[] = []
  const skipped: SeriesSkip[] = []
  for (const m of await members(cls, now)) {
    if (m.id === cls.id) continue
    const booked = (await getLedger(m.id)).lines.some((l) => takesSeat(l, now))
    const kept = booked ? keys.filter((k) => BOOKED_KEEPS.includes(k)) : []
    if (kept.length) {
      skipped.push({ id: m.id, date: dateOf(m), reason: `People are booked, so its ${kept.map((k) => KEEP_NAME[k]).join(' and ')} weren’t changed. Change it on its own sheet.` })
      continue
    }
    const next: ClassContent = { ...m.content }
    for (const k of keys) (next as any)[k] = k === 'earlyBird' ? shiftEarlyBird(after.earlyBird, firstStart(saved.data.class), firstStart(m), now) : after[k]
    try {
      await updateScheduledClass({ id: m.id, content: next, expectedUpdatedAt: m.updatedAt }, by)
      changed.push(dateOf(m))
    } catch (e) {
      skipped.push({ id: m.id, date: dateOf(m), reason: reasonOf(e) })
    }
  }
  return { data: { class: saved.data.class, series: { changed, skipped } }, ...(saved.warning ? { warning: saved.warning } : {}) }
}

/** "All dates in this series" for the seats: every date of every class still to come gets `capacity` (never below what's booked). */
export async function seriesCapacity(body: { id?: unknown; capacity?: unknown }, by: By = ADMIN_BY, now = new Date()) {
  const cls = await mustClass(body.id)
  const capacity = Number(body.capacity)
  if (!Number.isInteger(capacity) || capacity < 1) throw new ActionError(400, 'Type how many seats, like 12.', { field: 'sessions' })
  const changed: string[] = []
  const skipped: SeriesSkip[] = []
  let mine: ScheduledClass | null = null
  for (const m of await members(cls, now)) {
    try {
      const r = await updateScheduledClass({ id: m.id, sessions: m.sessions.map((s) => ({ ...s, capacity })), expectedUpdatedAt: m.updatedAt }, by)
      if (m.id === cls.id) mine = r.data.class
      changed.push(dateOf(m))
    } catch (e) {
      skipped.push({ id: m.id, date: dateOf(m), reason: reasonOf(e) })
    }
  }
  return { data: { class: mine ?? (await mustClass(cls.id)), series: { changed, skipped } } }
}

/** "All dates in this series" on Cancel: each date still to come is cancelled as Cancel does (never refunds). */
export async function cancelSeries(body: { id?: unknown }, by: By = ADMIN_BY, now = new Date()) {
  const cls = await mustClass(body.id)
  const list = await members(cls, now)
  if (!list.length) throw new ActionError(409, 'There are no dates left to cancel in this series.')
  const cancelled: { id: string; date: string; booked: BookedPerson[] }[] = []
  const skipped: SeriesSkip[] = []
  const warnings: string[] = []
  for (const m of list) {
    try {
      const r = await cancelClass({ id: m.id, expectedUpdatedAt: m.updatedAt }, by)
      cancelled.push({ id: m.id, date: dateOf(m), booked: r.data.booked })
      if (r.warning) warnings.push(`${dateOf(m)}: ${r.warning}`)
    } catch (e) {
      skipped.push({ id: m.id, date: dateOf(m), reason: reasonOf(e) })
    }
  }
  return { data: { class: await mustClass(cls.id), series: { cancelled, skipped } }, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
}
