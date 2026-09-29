import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { getEvent, resolveEventDay, EVENT_KIND_RE } from '@lib/events'
import { getWaiverRecord, upsertWaiverInEventIndex } from '@lib/waiver-store'
import { upsertRsvp } from '@lib/rsvp-store'
import { markPresent, migrateCheckinOnReplace } from '@lib/checkin-actions'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:rsvp')

export const prerender = false

type DoorKind = 'party' | 'workshop' // EVENT_KIND_RE below admits only these

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * "+ Add family" at the door: a household that's already on file (signed, in
 * date) turns up for an event they never RSVP'd to. One call adds them to the
 * event's roster AND marks the chosen people here — the same presence path as
 * the roster's ✓ Here (a drop-off event still issues + texts the pickup code).
 *
 * POST { kind, id, recordId, attending: string[], day? }
 * Idempotent: a household already on the roster just gets marked here again.
 * No adult naming, no extra fields — the signature is the check.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const by = byOf(staff)

  const body = await request.json().catch(() => null)
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  const attending: string[] = Array.isArray(body?.attending)
    ? [...new Set<string>(body.attending.map((s: unknown) => String(s).trim()).filter(Boolean))]
    : []
  if (!EVENT_KIND_RE.test(kind) || !id || !recordId) return json({ error: 'Missing event/record' }, 400)
  if (attending.length === 0) return json({ error: 'No one selected.' }, 400)

  let event
  let waiver
  try {
    event = await getEvent(kind as DoorKind, id)
    waiver = await getWaiverRecord(recordId)
  } catch (err) {
    logger.error('Event/waiver lookup failed', { error: String(err) })
    return json({ error: 'Couldn’t reach storage — check wifi and try again.' }, 503)
  }
  // Fail closed: an event we can't resolve is not "a non-drop-off event".
  if (!event) return json({ error: 'Couldn’t confirm this event — refresh the roster and try again.' }, 404)
  if (!waiver) return json({ error: 'That family isn’t on file.' }, 404)
  if (new Date(waiver.validUntil).getTime() <= Date.now()) {
    return json({ error: 'That agreement has expired — they need to sign again.' }, 409)
  }

  const valid = new Set(['adult', ...waiver.minors.map((_, i) => `child:${i}`)])
  const people = attending.filter((p) => valid.has(p))
  if (people.length === 0) return json({ error: 'No one selected.' }, 400)

  const requestedDay = typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null
  const day = resolveEventDay(event, requestedDay)

  try {
    const rsvp = await upsertRsvp({
      waiverId: recordId,
      event: { kind: kind as DoorKind, id },
      attending: people,
      responsibleAdult: null,
      at: new Date().toISOString(),
      ip: null,
      userAgent: null,
      by,
    })
    const { replacedRecordId } = await upsertWaiverInEventIndex(kind as DoorKind, id, waiver, rsvp.id)
    await migrateCheckinOnReplace(kind as DoorKind, id, replacedRecordId, recordId)
    const { state, oneTimeCode, smsFailed } = await markPresent({
      event, kind: kind as DoorKind, id, recordId, waiverRecord: waiver,
      personIds: people, day, by, ...(kind === 'party' ? { expected: people } : {}),
    })
    return json({
      data: {
        rsvpId: rsvp.id,
        day,
        presence: state.days[day]?.presence ?? {},
        ...(oneTimeCode ? { oneTimeCode } : {}),
        ...(smsFailed ? { smsFailed: true } : {}),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Add family failed', { kind, id, recordId, error: msg })
    if (msg.includes('Concurrent update')) {
      return json({ error: 'Another device just updated this family — try again.' }, 409)
    }
    return json({ error: 'Couldn’t reach storage — check wifi and try again.' }, 503)
  }
}
