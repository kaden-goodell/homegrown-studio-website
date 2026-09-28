/**
 * Overlay store for event settings the source system doesn't own: drop-off
 * (studio-run camps/PNO vs. host-supervised parties/workshops) and multi-day
 * spans (a camp sold as one Square Class covering several dates). `getEvent`/
 * `listEvents` (`@lib/events`) merge this on top of the party/workshop source.
 *
 * Netlify Blobs in prod, `.data/event-meta/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'

const logger = createLogger('event-meta')
const kv = makeKvStore('event-meta', 'event-meta')

const HISTORY_CAP = 50

export interface EventMetaHistoryEntry {
  at: string // ISO
  by: By
  dropOff: boolean
  days: string[] | null
}

export interface EventMeta {
  dropOff: boolean
  /** null = derive from the source event's startIso (single day). */
  days: string[] | null
  updatedAt: string // ISO
  by: By
  /** Append-only, capped at 50 (oldest dropped first). */
  history: EventMetaHistoryEntry[]
}

export interface EventMetaPatch {
  dropOff?: boolean
  days?: string[] | null
}

function key(kind: string, id: string): string {
  return `event-meta-${kind}:${id}`
}

function emptyMeta(): EventMeta {
  return { dropOff: false, days: null, updatedAt: new Date(0).toISOString(), by: { id: '', name: '' }, history: [] }
}

function normalize(raw: any): EventMeta {
  return {
    dropOff: !!raw?.dropOff,
    days: Array.isArray(raw?.days) ? raw.days.map(String) : null,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    by: raw?.by && typeof raw.by === 'object'
      ? { id: String(raw.by.id ?? ''), name: String(raw.by.name ?? '') }
      : { id: '', name: '' },
    history: Array.isArray(raw?.history) ? raw.history : [],
  }
}

export async function getEventMeta(kind: string, id: string): Promise<EventMeta | null> {
  const json = await kv.get(key(kind, id))
  return json ? normalize(JSON.parse(json)) : null
}

/**
 * Apply a patch (dropOff and/or days) with optimistic concurrency (3
 * attempts, matching `mutateCheckin`'s CAS loop) and append to history.
 */
export async function setEventMeta(kind: string, id: string, patch: EventMetaPatch, by: By): Promise<EventMeta> {
  const k = key(kind, id)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const current = value ? normalize(JSON.parse(value)) : emptyMeta()
    const dropOff = patch.dropOff ?? current.dropOff
    const days = patch.days !== undefined ? patch.days : current.days
    const now = new Date().toISOString()
    const next: EventMeta = {
      dropOff,
      days,
      updatedAt: now,
      by,
      history: [...current.history, { at: now, by, dropOff, days }].slice(-HISTORY_CAP),
    }
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) {
      logger.info('Event meta set', { kind, id, dropOff, days })
      return next
    }
  }
  throw new Error('Concurrent update — please retry')
}
