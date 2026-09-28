/**
 * RSVP persistence: who from an on-file household is attending a specific
 * event. Separate from the signature itself (`WaiverRecord`, @lib/waiver-store)
 * which is immutable evidence — a returning household re-RSVPing to a new
 * event, or changing who's coming, must never clone or touch the signature
 * (HOM-210). One record per (event, waiverId); a re-RSVP overwrites in place.
 *
 * Never delete. Minor claims toll to age 21 in Alabama — see
 * `docs/CREW-OPERATIONS.md` §7 and the weekly self-archive in
 * `src/lib/archive-export.ts` (HOM-217).
 *
 * Production (Netlify): Netlify Blobs. Local dev: `.data/rsvps/` on disk.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { EventKind } from '@lib/events'
import type { By } from '@lib/staff-auth'
import type { AuthorizedPickup } from '@lib/waiver-store'

const logger = createLogger('rsvp-store')
const kv = makeKvStore('rsvps', 'rsvps')

export interface RsvpRecord {
  id: string // rsv_{base36 ms}_{6 random}
  waiverId: string // the signature this RSVP relies on
  event: { kind: EventKind; id: string }
  ref?: { bookingId?: string } // e.g. the Square seat booking (workshops)
  attending: string[] | null // 'adult' | 'child:N' ids from the waiver; null = everyone
  responsibleAdult: string | null
  addendumVersion: string | null // filled by the drop-off addendum ticket
  addendumSha256: string | null
  /**
   * Set only on the returning-household RSVP path (HOM-212), when the
   * on-file signature has no pickup info and the guest fills the compact
   * "Who may pick up?" block on the RSVP screen. Overrides the signature's
   * own `authorizedPickup`/`notAuthorized` for this event — the signature
   * itself is never mutated (HOM-210). `null`/absent when not set.
   */
  pickup?: { authorizedPickup: AuthorizedPickup[]; notAuthorized: string } | null
  at: string
  firstAt: string // preserved across re-RSVPs — when this household first RSVP'd to this event
  ip: string | null
  userAgent: string | null
  by?: By // present when created from the staff console
}

/** Deterministic key — one RSVP per (event, waiverId), so a re-RSVP is a
 *  plain overwrite rather than a search-and-replace like the waiver event
 *  index needs (the waiver id itself never changes across a re-RSVP). */
function rsvpKey(kind: EventKind, eventId: string, waiverId: string): string {
  return `rsvp-${kind}:${eventId}-${waiverId}`
}

function newRsvpId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `rsv_${Date.now().toString(36)}_${rand}`
}

/**
 * Add or replace this household's RSVP for an event. Keyed by
 * (event, waiverId), so calling this again for the same household/event
 * overwrites the previous RSVP (e.g. "who's coming" changed) while keeping
 * the original `firstAt`.
 */
export async function upsertRsvp(
  r: Omit<RsvpRecord, 'id' | 'firstAt'> & { id?: string },
): Promise<RsvpRecord> {
  const key = rsvpKey(r.event.kind, r.event.id, r.waiverId)
  const existingJson = await kv.get(key)
  const existing: RsvpRecord | null = existingJson ? JSON.parse(existingJson) : null
  const record: RsvpRecord = {
    ...r,
    id: r.id ?? newRsvpId(),
    firstAt: existing?.firstAt ?? r.at,
  }
  await kv.set(key, JSON.stringify(record, null, 2))
  logger.info('RSVP stored', { id: record.id, waiverId: record.waiverId, event: record.event })
  return record
}

export async function getRsvp(kind: EventKind, eventId: string, waiverId: string): Promise<RsvpRecord | null> {
  const json = await kv.get(rsvpKey(kind, eventId, waiverId))
  return json ? JSON.parse(json) : null
}

/** All RSVPs for an event — pairs with `listWaiversByEvent` (@lib/waiver-store)
 *  to join "who signed" with "who's actually coming". */
export async function listRsvpsByEvent(kind: EventKind, eventId: string): Promise<RsvpRecord[]> {
  const prefix = rsvpKey(kind, eventId, '')
  const keys = (await kv.list()).filter((k) => k.startsWith(prefix))
  const records = await Promise.all(
    keys.map(async (k) => {
      const json = await kv.get(k)
      return json ? (JSON.parse(json) as RsvpRecord) : null
    }),
  )
  return records.filter((r): r is RsvpRecord => r !== null)
}
