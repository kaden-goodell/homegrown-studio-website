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

export type EventKind = 'party' | 'workshop' | 'program'

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
  /** Present only when an event-meta override exists for this event. */
  updatedAt?: string
  by?: By
}

// Square's Classes API is slow — cache the active list for a minute so
// getEvent/listEvents don't hammer it on every roster poll.
let workshopCache: { at: number; list: Workshop[] } | null = null
const WORKSHOP_CACHE_MS = 60_000

async function cachedWorkshopList(): Promise<Workshop[]> {
  if (workshopCache && Date.now() - workshopCache.at < WORKSHOP_CACHE_MS) return workshopCache.list
  const list = await providers.workshop.listWorkshops()
  workshopCache = { at: Date.now(), list }
  return list
}

/**
 * Find a workshop by its classScheduleId. `listWorkshops()` filters out sold-
 * out classes, so try the provider's `getWorkshop` first (it skips that
 * filter) — it's optional on the interface and some implementations key it
 * by the instance id rather than the schedule id, so this is a best-effort;
 * the cached active list is the reliable fallback either way.
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

export async function listEvents({ from, to }: { from: string; to: string }): Promise<StudioEvent[]> {
  const [parties, workshops] = await Promise.all([listParties(), cachedWorkshopList()])

  const events = await Promise.all([
    ...parties.map(async (p) => partyEvent(p.bookingId, p, await getEventMeta('party', p.bookingId))),
    ...workshops.map(async (w) => workshopEvent(w.scheduleId, w, await getEventMeta('workshop', w.scheduleId))),
  ])

  return events
    .filter((e) => e.days.some((d) => d >= from && d <= to))
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/** Storage key for an event: parties stay bare (legacy checkin/waiver-index
 *  keys must not change); every other kind is namespaced. */
export function eventKey(kind: EventKind, id: string): string {
  return kind === 'party' ? id : `${kind}:${id}`
}
