import type { APIRoute } from 'astro'
import { byOf, staffAuthorized } from '@lib/staff-auth'
import { getWaiverRecord, listWaiversByEvent } from '@lib/waiver-store'
import { getClass } from '@lib/classes/class-store'
import { nameSeatsFromWaiver } from '@lib/classes/staff-roster'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:staff:class-names')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only: a counter sale (or a door seat taken with no name) gets its
 * name from the family's waiver at check-in. Body { classId, bookingId,
 * recordId }; the waiver must be signed for this class. Seats that already
 * have a name keep it.
 */
export const POST: APIRoute = async ({ request }) => {
  const member = staffAuthorized(request)
  if (!member) return json(401, { error: 'Unauthorized' })
  const body = await request.json().catch(() => null)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const classId = str(body?.classId), bookingId = str(body?.bookingId), recordId = str(body?.recordId)
  if (!classId || !bookingId || !recordId) return json(400, { error: 'Pick the family these seats are for.' })
  try {
    const cls = await getClass(classId)
    if (!cls) return json(404, { error: 'That class isn’t on file.' })
    const signed = await listWaiversByEvent('workshop', cls.id)
    if (!signed.some((w) => w.id === recordId)) return json(409, { error: 'That family hasn’t signed for this class yet.' })
    const waiver = await getWaiverRecord(recordId)
    if (!waiver) return json(404, { error: 'That family isn’t on file.' })
    const named = await nameSeatsFromWaiver(cls.id, bookingId, waiver.adult)
    if (!named) return json(409, { error: 'Those seats already have a name.' })
    const name = `${waiver.adult.firstName} ${waiver.adult.lastName}`.trim()
    await recordAudit({
      by: member, action: 'class-seats-named', target: { kind: 'class', id: cls.id, label: cls.content.name },
      details: { bookingId, seats: named, waiverId: recordId, name },
    })
    return json(200, { data: { named, name, by: byOf(member) } })
  } catch (err) {
    logger.error('Naming seats failed', { classId, bookingId, error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: 'Couldn’t save that — check wifi and try again.' })
  }
}
