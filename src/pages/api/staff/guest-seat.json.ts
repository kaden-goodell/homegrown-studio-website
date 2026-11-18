import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { getEvent, resolveEventDay } from '@lib/events'
import { listWaiversByEvent } from '@lib/waiver-store'
import { attachGuest, detachGuest, guestSeatView, listGuestLinks } from '@lib/guest-links'
import { seatRecordsForDay } from '@lib/guest-roster'
import { recordAudit } from '@lib/audit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:guest-seat')
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[\w-]{1,128}$/

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Staff-only: "With Shelby Taylor" at check-in. Ties a signed household to
 * a booker's open guest seat on this class (or takes it off again).
 * POST { kind: 'workshop', id, day?, recordId, action: 'attach', bookingId } | { …, action: 'detach' }
 *
 * Only a link between a waiver household and a seat already booked: it never
 * changes money, seats or Square. Attaching twice is the same as once.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json(401, { error: 'Unauthorized' })
  const body = await request.json().catch(() => null)
  const kind = body?.kind
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const recordId = typeof body?.recordId === 'string' ? body.recordId.trim() : ''
  const action = body?.action
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : ''
  const dayParam = typeof body?.day === 'string' && DAY_RE.test(body.day) ? body.day : null
  if (kind !== 'workshop' || !ID_RE.test(id) || !ID_RE.test(recordId) || (action !== 'attach' && action !== 'detach') || (action === 'attach' && !ID_RE.test(bookingId))) {
    return json(400, { error: 'Missing class, family or booking.' })
  }

  try {
    const event = await getEvent('workshop', id)
    if (!event) return json(404, { error: 'Couldn’t find that class. Refresh and try again.' })
    const day = resolveEventDay(event, dayParam)
    const waivers = await listWaiversByEvent('workshop', id)
    const w = waivers.find((x) => x.id === recordId)
    if (!w) return json(404, { error: 'That family isn’t signed in for this class. Refresh and try again.' })
    const label = `${w.adult.firstName} ${w.adult.lastName}`.trim()
    const simulated = paymentBypassEnabled(request) ? { simulated: true as const } : {}

    if (action === 'detach') {
      const removed = await detachGuest(id, recordId)
      if (removed) {
        await recordAudit({ by: staff, action: 'guest-seat.removed', target: { kind: 'household', id: recordId, label }, details: { eventKind: 'workshop', eventId: id }, ...simulated })
      }
      return json(200, { data: { removed } })
    }

    const records = await seatRecordsForDay(event, day)
    const households = waivers.map((x) => ({ recordId: x.id, email: x.adult.email, signer: `${x.adult.firstName} ${x.adult.lastName}`.trim() }))
    const links = await listGuestLinks(id)
    const view = guestSeatView(records, households, links)
    const already = view.guestOf[recordId]
    if (already && already.bookingId === bookingId) return json(200, { data: { guestOf: already } })

    const booking = records.find((r) => r.bookingId === bookingId)
    if (!booking || !booking.customer.email.trim()) return json(409, { error: 'That booking isn’t on this class today. Refresh and try again.' })
    const email = w.adult.email.trim().toLowerCase()
    if (records.some((r) => r.customer.email.trim().toLowerCase() === email)) {
      return json(409, { error: 'They already have a seat of their own on this class.' })
    }
    if (!view.matches.some((m) => m.bookingId === bookingId)) {
      return json(409, { error: `${booking.customer.givenName}’s booking has no open seat left. Use Sell a seat or Comp a seat.` })
    }

    await attachGuest({ eventId: id, bookingId, recordId, via: 'staff', by: byOf(staff) })
    const after = guestSeatView(records, households, await listGuestLinks(id)).guestOf[recordId] ?? null
    await recordAudit({
      by: staff,
      action: 'guest-seat.attached',
      target: { kind: 'household', id: recordId, label },
      details: { eventKind: 'workshop', eventId: id, bookingId, booker: `${booking.customer.givenName} ${booking.customer.familyName}`.trim(), seat: after?.seat ?? null },
      ...simulated,
    })
    return json(200, { data: { guestOf: after } })
  } catch (err) {
    logger.error('Guest seat change failed', { id, recordId, action, error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: 'Couldn’t save that. Check wifi and try again.' })
  }
}
