/**
 * Uniform event view for staff surfaces, across the three source systems:
 * parties (Netlify Blobs, id = bookingId), workshops (Square Classes, id =
 * classScheduleId), and programs/camps (hidden, no resolver yet). Merges the
 * source's data with the `event-meta` overlay (drop-off, multi-day) — see
 * `@lib/event-meta`. `open-studio` walk-ins are handled by the door check,
 * never as an event here.
 */
import { getPartyRecord, listParties, type PartyRecord } from '@lib/party-store'
import { providers } from '@config/providers'
import type { Workshop } from '@providers/interfaces/workshop'
import { getEventMeta, type EventMeta } from '@lib/event-meta'
import { studioDate } from '@lib/studio-time'
import type { By } from '@lib/staff-auth'
import { createLogger } from '@lib/logger'

const logger = createLogger('events')

import type { SeatOption } from '@lib/seat-options'
import { EVENT_KIND_RE, type EventKind } from '@lib/event-kinds'
export { EVENT_KIND_RE, type EventKind }

export interface StudioEvent {
  kind: EventKind
  id: string
  title: string
  startIso: string
  /** Studio-timezone YYYY-MM-DD dates this event spans — length 1 unless a
   *  meta override makes it multi-day. */
  days: string[]
  dropOff: boolean
  seats?: number
  /** Per-seat questions (classes only; [] when none). */
  options?: SeatOption[]
  /** The class's own sign-up cutoff in hours; null = the default. */
  signupCutoffHours?: number | null
  /** Seats the class holds in all, when Square says. */
  capacity?: number
  /** Present only when an event-meta override exists for this event. */
  updatedAt?: string
  by?: By
}

// Square's Classes API is slow — cache the active list for a minute so
// getEvent/listEvents don't hammer it on every roster poll.
let workshopCache: { at: number; list: Workshop[] } | null = null
const WORKSHOP_CACHE_MS = 60_000

/**
 * Prefers `listAllWorkshops` (no capacity or future-only filter) over
 * `listWorkshops` (the public, future-only listing) — staff surfaces need to
 * see an in-progress or multi-day-in-the-past class in a day's listing, not
 * just resolve one by id. A provider that doesn't implement it (mock today)
 * is treated as already returning such a list.
 */
async function cachedWorkshopList(): Promise<Workshop[]> {
  if (workshopCache && Date.now() - workshopCache.at < WORKSHOP_CACHE_MS) return workshopCache.list
  const list = await (providers.workshop.listAllWorkshops?.() ?? providers.workshop.listWorkshops())
  workshopCache = { at: Date.now(), list }
  return list
}

/**
 * Find a workshop by its classScheduleId. `listWorkshops()` filters out sold-
 * out classes — and a full class is exactly the one staff most need a roster
 * for — so ask the provider's `getWorkshop` first: it skips that filter and
 * matches on either the schedule id or the instance id. The cached active
 * list stays as the fallback for a provider that doesn't implement it (or
 * throws).
 */
async function findWorkshop(id: string): Promise<Workshop | null> {
  try {
    const w = await providers.workshop.getWorkshop?.(id)
    if (w) return w
  } catch {
    // fall through to the cached list
  }
  const list = await cachedWorkshopList()
  return list.find((w) => w.scheduleId === id) ?? null
}

function partyEvent(id: string, p: PartyRecord, meta: EventMeta | null): StudioEvent {
  return {
    kind: 'party',
    id,
    title: p.title ?? `${p.craftName} Party`,
    startIso: p.startIso,
    days: meta?.days ?? [studioDate(p.startIso)],
    // Meta overrides; the party record's own dropOff is a read-only fallback
    // for old data written before the event-meta store existed.
    dropOff: meta?.dropOff ?? p.dropOff ?? false,
    options: [],
    signupCutoffHours: null,
    ...(meta ? { updatedAt: meta.updatedAt, by: meta.by } : {}),
  }
}

function workshopEvent(id: string, w: Workshop, meta: EventMeta | null): StudioEvent {
  return {
    kind: 'workshop',
    id,
    title: w.name,
    startIso: w.startAt,
    days: meta?.days ?? [studioDate(w.startAt)],
    dropOff: meta?.dropOff ?? false,
    seats: w.availableCapacity,
    options: meta?.options ?? [],
    signupCutoffHours: meta?.signupCutoffHours ?? null,
    ...(typeof w.totalCapacity === 'number' ? { capacity: w.totalCapacity } : {}),
    ...(meta ? { updatedAt: meta.updatedAt, by: meta.by } : {}),
  }
}

export async function getEvent(kind: EventKind, id: string): Promise<StudioEvent | null> {
  if (kind === 'party') {
    const p = await getPartyRecord(id)
    if (!p) return null
    return partyEvent(id, p, await getEventMeta('party', id))
  }
  if (kind === 'workshop') {
    const w = await findWorkshop(id)
    if (!w) return null
    return workshopEvent(id, w, await getEventMeta('workshop', id))
  }
  // Programs/camps are hidden — resolver lands with the Programs follow-up ticket.
  return null
}

/** Whether each source system answered on this call. */
export interface EventSources {
  parties: 'ok' | 'error'
  workshops: 'ok' | 'error'
}

export interface EventListing {
  events: StudioEvent[]
  sources: EventSources
}

/**
 * Every event in a date window, from both source systems.
 *
 * The two sources are fetched INDEPENDENTLY: Square's Classes API going down
 * (or just timing out) must not take today's parties off the staff console
 * with it — the door screen is the one place that has to keep working when
 * the internet is flaky. A source that failed comes back as
 * `sources.workshops === 'error'` so the caller can say so in one line rather
 * than blanking the whole list.
 */
export async function listEvents({ from, to }: { from: string; to: string }): Promise<EventListing> {
  const [partiesResult, workshopsResult] = await Promise.allSettled([listParties(), cachedWorkshopList()])

  if (partiesResult.status === 'rejected') {
    logger.error('Party source unavailable', { error: String(partiesResult.reason) })
  }
  if (workshopsResult.status === 'rejected') {
    logger.error('Workshop source unavailable', { error: String(workshopsResult.reason) })
  }

  const parties = partiesResult.status === 'fulfilled' ? partiesResult.value : []
  const workshops = workshopsResult.status === 'fulfilled' ? workshopsResult.value : []

  const events = await Promise.all([
    ...parties.map(async (p) => partyEvent(p.bookingId, p, await getEventMeta('party', p.bookingId))),
    ...workshops.map(async (w) => workshopEvent(w.scheduleId, w, await getEventMeta('workshop', w.scheduleId))),
  ])

  return {
    events: events
      .filter((e) => e.days.some((d) => d >= from && d <= to))
      .sort((a, b) => a.startIso.localeCompare(b.startIso)),
    sources: {
      parties: partiesResult.status === 'fulfilled' ? 'ok' : 'error',
      workshops: workshopsResult.status === 'fulfilled' ? 'ok' : 'error',
    },
  }
}

/** Storage key for an event: parties stay bare (legacy checkin/waiver-index
 *  keys must not change); every other kind is namespaced. */
export function eventKey(kind: EventKind, id: string): string {
  return kind === 'party' ? id : `${kind}:${id}`
}

/** Calendar day (studio-local) one day before `ymd`. */
function ymdMinusOne(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/**
 * True once every day of the event is before yesterday (studio-local) — a
 * full grace day past the event's last day. Shared by `/waiver`'s own
 * "already happened" notice and `sign.json`'s server-side validation so the
 * two checks can't drift apart (HOM-213 carries this forward from a Task 2
 * deferred item).
 */
export function isEventPast(event: StudioEvent, now: Date = new Date()): boolean {
  const cutoff = ymdMinusOne(studioDate(now.toISOString()))
  return event.days.every((d) => d < cutoff)
}

/**
 * Which studio-local day (YYYY-MM-DD) a roster/check-in action defaults to
 * when the caller didn't ask for a specific one: today, if today is one of
 * the event's days; otherwise the event's first day (HOM-213). An explicit
 * `requested` day wins as long as it's actually one of the event's days —
 * a stale/foreign day falls back to the same default.
 */
export function resolveEventDay(event: StudioEvent | null, requested?: string | null): string {
  const today = studioDate(new Date().toISOString())
  const days = event?.days ?? []
  if (requested && days.includes(requested)) return requested
  if (days.includes(today)) return today
  return days[0] ?? today
}

/** Is `day` the last (chronologically latest) day of the event? An event
 *  with no known days (defensive default) counts as "last" so single-day
 *  code paths behave as before HOM-213. */
export function isLastEventDay(event: StudioEvent | null, day: string): boolean {
  const days = event?.days ?? []
  return days.length === 0 || day === days[days.length - 1]
}
