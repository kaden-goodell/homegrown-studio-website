/**
 * Overlay store for event settings the source system doesn't own: drop-off
 * (studio-run camps/PNO vs. host-supervised parties/workshops), multi-day
 * spans (a camp sold as one Square Class covering several dates), and — for
 * classes — the per-seat questions and the sign-up cutoff (spec A).
 * `getEvent`/`listEvents` (`@lib/events`) merge this on top of the source.
 *
 * Netlify Blobs in prod, `.data/event-meta/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import { hasSeatChoices } from '@lib/seat-choices'
import { optionsChangeRefusal, validateCutoffHours, validateOptions, SeatSettingsError, type SeatOption } from '@lib/seat-options'
import type { By } from '@lib/staff-auth'

const logger = createLogger('event-meta')
const kv = makeKvStore('event-meta', 'event-meta')

const HISTORY_CAP = 50

export interface EventMetaHistoryEntry {
  at: string // ISO
  by: By
  dropOff: boolean
  days: string[] | null
  /** Absent on entries written before seat questions existed. */
  options?: SeatOption[]
  signupCutoffHours?: number | null
}

export interface EventMeta {
  dropOff: boolean
  /** null = derive from the source event's startIso (single day). */
  days: string[] | null
  /** Per-seat questions; [] = none. */
  options: SeatOption[]
  /** null = the default (0 h, or 24 h once the class asks questions). */
  signupCutoffHours: number | null
  updatedAt: string // ISO
  by: By
  /** Append-only, capped at 50 (oldest dropped first). */
  history: EventMetaHistoryEntry[]
}

export interface EventMetaPatch {
  dropOff?: boolean
  days?: string[] | null
  options?: SeatOption[]
  signupCutoffHours?: number | null
}

function key(kind: string, id: string): string {
  return `event-meta-${kind}:${id}`
}

export function emptyEventMeta(): EventMeta {
  return {
    dropOff: false, days: null, options: [], signupCutoffHours: null,
    updatedAt: new Date(0).toISOString(), by: { id: '', name: '' }, history: [],
  }
}

export function normalizeEventMeta(raw: any): EventMeta {
  const options = validateOptions(raw?.options)
  return {
    dropOff: !!raw?.dropOff,
    days: Array.isArray(raw?.days) ? raw.days.map(String) : null,
    options: options.ok ? options.value : [],
    signupCutoffHours: typeof raw?.signupCutoffHours === 'number' ? raw.signupCutoffHours : null,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    by: raw?.by && typeof raw.by === 'object'
      ? { id: String(raw.by.id ?? ''), name: String(raw.by.name ?? '') }
      : { id: '', name: '' },
    history: Array.isArray(raw?.history) ? raw.history : [],
  }
}

export async function getEventMeta(kind: string, id: string): Promise<EventMeta | null> {
  const json = await kv.get(key(kind, id))
  return json ? normalizeEventMeta(JSON.parse(json)) : null
}

/**
 * The next record for a patch. Pure, so the CLI (scripts/set-event.ts)
 * applies exactly the rules the staff sheet does. `hasPicks` = someone has
 * already picked for this class (locks removing questions and choices).
 * Throws SeatSettingsError.
 */
export function mergeEventMeta(current: EventMeta, patch: EventMetaPatch, by: By, now: string, hasPicks: boolean): EventMeta {
  let options = current.options
  if (patch.options !== undefined) {
    const checked = validateOptions(patch.options)
    if (!checked.ok) throw new SeatSettingsError(checked.error)
    const refusal = optionsChangeRefusal(current.options, checked.value, hasPicks)
    if (refusal) throw new SeatSettingsError(refusal, 409)
    options = checked.value
  }
  let signupCutoffHours = current.signupCutoffHours
  if (patch.signupCutoffHours !== undefined) {
    const checked = validateCutoffHours(patch.signupCutoffHours)
    if (!checked.ok) throw new SeatSettingsError(checked.error)
    signupCutoffHours = checked.value
  }
  const dropOff = patch.dropOff ?? current.dropOff
  const days = patch.days !== undefined ? patch.days : current.days
  return {
    dropOff,
    days,
    options,
    signupCutoffHours,
    updatedAt: now,
    by,
    history: [...current.history, { at: now, by, dropOff, days, options, signupCutoffHours }].slice(-HISTORY_CAP),
  }
}

/**
 * Apply a patch with optimistic concurrency (3 attempts, matching
 * `mutateCheckin`'s CAS loop) and append to history.
 */
export async function setEventMeta(kind: string, id: string, patch: EventMetaPatch, by: By): Promise<EventMeta> {
  const k = key(kind, id)
  // Only a change to the questions needs to know whether anyone has picked.
  const hasPicks = patch.options !== undefined && kind === 'workshop' ? await hasSeatChoices('workshop', id) : false
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const current = value ? normalizeEventMeta(JSON.parse(value)) : emptyEventMeta()
    const next = mergeEventMeta(current, patch, by, new Date().toISOString(), hasPicks)
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) {
      logger.info('Event meta set', {
        kind, id, dropOff: next.dropOff, days: next.days, options: next.options.length, signupCutoffHours: next.signupCutoffHours,
      })
      return next
    }
  }
  throw new Error('Concurrent update — please retry')
}
