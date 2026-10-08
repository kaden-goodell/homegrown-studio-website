import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { providers } from '@config/providers'
import { getEventMeta } from '@lib/event-meta'
import { validatePicks } from '@lib/seat-options'
import { saveSeatChoices } from '@lib/seat-choices'
import { sendWorkshopConfirmation } from '@lib/workshop-confirmation'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'

export const prerender = false

const logger = createLogger('api:staff:comp-seat')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const bad = (error: string, status = 400) => reply(status, { error })

/**
 * Staff-only: record a comped (free) workshop seat. Staff add the seat itself
 * in Square's dashboard; this keeps the person and their picks on the roster
 * and sends the confirmation email.
 */
export const POST: APIRoute = async ({ request }) => {
  const member = staffAuthorized(request)
  if (!member) return bad('Unauthorized', 401)

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('Invalid request body')

  const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId.trim() : ''
  const givenName = String(body.givenName ?? '').trim()
  const familyName = String(body.familyName ?? '').trim()
  const email = String(body.email ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  if (!scheduleId) return bad('Pick a class.')
  if (givenName.length < 1 || givenName.length > 60) return bad('Add a first name (60 characters or fewer).')
  if (familyName.length < 1 || familyName.length > 60) return bad('Add a last name (60 characters or fewer).')
  if (!EMAIL_RE.test(email)) return bad('That email doesn’t look right.')
  const seats = Number(body.seats)
  if (!Number.isInteger(seats) || seats < 1 || seats > 10) return bad('Seats must be a whole number from 1 to 10.')

  try {
    const meta = await getEventMeta('workshop', scheduleId)
    const options = meta?.options ?? []
    const checked = validatePicks(options, seats, body.picks)
    if (!checked.ok) return bad(checked.error)

    const workshops = (await providers.workshop.listAllWorkshops?.()) ?? []
    const workshop = workshops.find((w) => w.scheduleId === scheduleId)
    if (!workshop) return bad('Class not found', 404)

    const bookingId = 'comp_' + randomUUID().slice(0, 10)
    await saveSeatChoices({
      eventKind: 'workshop',
      eventId: scheduleId,
      bookingId,
      orderId: null,
      customer: { givenName, familyName, email, phone },
      seats,
      picks: checked.value,
      at: new Date().toISOString(),
      attemptId: bookingId,
      comped: true,
      by: byOf(member),
      ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
    })

    let emailSent = false
    try {
      emailSent = await sendWorkshopConfirmation({
        origin: new URL(request.url).origin,
        bookingId,
        workshop,
        seats,
        email,
        givenName,
        receiptUrl: null,
        options,
        picks: checked.value,
        totalChargedCents: 0,
        comped: true,
      })
    } catch (err) {
      logger.error('Comp seat confirmation email failed', { bookingId, error: err instanceof Error ? err.message : String(err) })
    }
    if (!emailSent) logger.warn('Comp seat confirmation not sent', { bookingId })

    await recordAudit({
      by: member,
      action: 'seat.comped',
      target: { kind: 'workshop', id: scheduleId, label: workshop.name },
      details: { bookingId, seats, email, name: `${givenName} ${familyName}`, emailSent },
      ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
    })
    return reply(200, { data: { bookingId, emailSent } })
  } catch (err) {
    logger.error('Comp seat failed', { scheduleId, error: err instanceof Error ? err.message : String(err) })
    return bad('Couldn’t record that seat — please try again.', 503)
  }
}
