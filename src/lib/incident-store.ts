/**
 * Incident reports (HOM-215) — any injury or notable event during an event
 * or open studio. Distinct from the custody log (`checkin-store`): an
 * incident is CROSS-REFERENCED into a household's `CheckinEvent[]` (the
 * `'incident'` action, see checkin-store) when it names a waiver, but this
 * store holds the incident's own record of truth (what/first aid/witnesses/
 * parent notification/follow-up).
 *
 * Never delete. Minor claims toll to age 21 in Alabama — see
 * `docs/CREW-OPERATIONS.md` §7 and the weekly self-archive in
 * `src/lib/archive-export.ts` (HOM-217).
 *
 * Netlify Blobs in prod, `.data/incidents/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'

const logger = createLogger('incident-store')
const kv = makeKvStore('incidents', 'incidents')

export interface IncidentRecord {
  id: string // inc_{base36 ms}_{6 random}
  at: string // ISO — when it happened (defaults to now at save time, staff-editable)
  reportedAt: string // ISO — when the report was saved
  by: By // who filed the report
  /** null = open studio / no event on screen. */
  event: { kind: EventKind; id: string; title: string; day: string } | null
  /** Roster picks carry `waiverId`/`personId`; free-text ("Someone else") entries carry only `name`. */
  who: { waiverId?: string; personId?: string; name: string }[]
  what: string // required, >= 10 chars (enforced by the endpoint, not here)
  firstAid: string // '' allowed
  witnesses: string
  parentNotified: { at: string | null; by: string; how: 'phone' | 'in-person' | 'text' | 'not-yet' }
  followUp: string
}

function newId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `inc_${Date.now().toString(36)}_${rand}`
}

/** Save a new incident report. The id and `reportedAt` are assigned here. */
export async function createIncident(input: Omit<IncidentRecord, 'id' | 'reportedAt'>): Promise<IncidentRecord> {
  const record: IncidentRecord = { ...input, id: newId(), reportedAt: new Date().toISOString() }
  await kv.set(record.id, JSON.stringify(record, null, 2))
  logger.info('Incident recorded', { id: record.id, event: record.event, by: record.by })
  return record
}

export async function getIncident(id: string): Promise<IncidentRecord | null> {
  const json = await kv.get(id)
  return json ? (JSON.parse(json) as IncidentRecord) : null
}

async function listAll(): Promise<IncidentRecord[]> {
  const keys = (await kv.list()).filter((k) => k !== '__probe__')
  const records = await Promise.all(keys.map(getIncident))
  return records.filter((r): r is IncidentRecord => r !== null)
}

/** All incidents tied to one event, newest first. Never returns incidents
 *  filed with `event: null` (open studio) — those have no event to match. */
export async function listIncidentsByEvent(kind: EventKind, id: string): Promise<IncidentRecord[]> {
  const all = await listAll()
  return all
    .filter((r) => r.event?.kind === kind && r.event?.id === id)
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** All incidents that happened at/after `date` (ISO), newest first. */
export async function listIncidentsSince(date: string): Promise<IncidentRecord[]> {
  const all = await listAll()
  return all.filter((r) => r.at >= date).sort((a, b) => b.at.localeCompare(a.at))
}
