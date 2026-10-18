/**
 * Put people from an on-file household on an event as attending. Shared by
 * the door's "+ Add family" (/api/staff/rsvp.json) and Comp / Sell a seat
 * (/api/staff/comp-seat.json), so both follow one rule: attending is only
 * ever widened, never narrowed, and the household's pickup list, booking ref
 * and responsible adult carry over.
 */
import { upsertRsvp, getRsvp, type RsvpRecord } from '@lib/rsvp-store'
import { upsertWaiverInEventIndex, lookupHouseholdEntry, type WaiverRecord } from '@lib/waiver-store'
import { effectivePickup, storablePickup } from '@lib/pickup'
import { migrateCheckinOnReplace } from '@lib/checkin-actions'
import { substantiveSince, compareVersions } from '@config/waiver-content'
import type { By } from '@lib/staff-auth'

type Kind = 'party' | 'workshop'

/** 'adult', 'child:0', 'child:1'… for a signature. */
export function personIdsOf(w: Pick<WaiverRecord, 'minors'>): string[] {
  return ['adult', ...w.minors.map((_, i) => `child:${i}`)]
}

export async function addAttending(params: { kind: Kind; id: string; waiver: WaiverRecord; people: string[]; by: By }): Promise<{ rsvp: RsvpRecord; alreadyRsvpd: boolean }> {
  const { kind, id, waiver, people, by } = params
  const existing = await getRsvp(kind, id, waiver.id)
  const attendingNow = existing ? [...new Set([...(existing.attending ?? personIdsOf(waiver)), ...people])] : people
  // The household's pickup list / may-NOT-collect follow it to this event.
  const eff = await effectivePickup({ waiver })
  // Store the RAW note (a "None" clear persists); never drop an existing RSVP's pickup.
  const pickup = storablePickup(eff) ?? existing?.pickup ?? null
  const rsvp = await upsertRsvp({
    ...(existing ? { id: existing.id, ref: existing.ref } : {}),
    ...(pickup ? { pickup } : {}),
    waiverId: waiver.id,
    event: { kind, id },
    attending: attendingNow,
    responsibleAdult: existing?.responsibleAdult ?? null,
    at: new Date().toISOString(),
    ip: null,
    userAgent: null,
    by,
  })
  const { replacedRecordId } = await upsertWaiverInEventIndex(kind, id, waiver, rsvp.id)
  await migrateCheckinOnReplace(kind, id, replacedRecordId, waiver.id)
  return { rsvp, alreadyRsvpd: !!existing }
}

export interface SeatHousehold {
  recordId: string
  /** 'ok' = in date and on the current agreement, so people can be picked. */
  status: 'ok' | 'expired' | 'outdated'
  people: { id: string; name: string; adult: boolean }[]
}

/** The household on file for a customer's email (then phone), as Comp a seat shows it. */
export async function householdForSeats(contact: { email?: string; phone?: string }, now = new Date()): Promise<SeatHousehold | null> {
  const tries = [contact.email, contact.phone].filter((c): c is string => !!c && !!c.trim())
  for (const c of tries) {
    const h = await lookupHouseholdEntry(c)
    if (!h) continue
    const status = new Date(h.validUntil).getTime() <= now.getTime()
      ? 'expired'
      : compareVersions(h.agreementVersion, substantiveSince) < 0 ? 'outdated' : 'ok'
    return {
      recordId: h.recordId,
      status,
      people: [
        { id: 'adult', name: `${h.firstName} ${h.lastName}`.trim(), adult: true },
        ...h.minors.map((m, i) => ({ id: `child:${i}`, name: m.name, adult: false })),
      ],
    }
  }
  return null
}
