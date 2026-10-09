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
import { addClassAttendee } from '@lib/square-dashboard'

export const prerender = false

const logger = createLogger('api:staff:comp-seat')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const bad = (error: string, status = 400) => reply(status, { error })

/**
 * Staff-only: give someone a free workshop seat.
 *
 * Default: adds the seat in Square with no payment (through the saved Square
 * sign-in, see square-dashboard.ts), records the person and their picks for
 * the roster, and sends the usual confirmation email.
 *
 * `alreadyInSquare: true` is the fallback for when the Square sign-in has
 * expired: staff added the seat in Square's own screen, and this only records
 * it and sends the email.
 *
 * Never cancels anything. If Square adds some seats and then refuses one, the
 * seats it added are kept and recorded, and the reply says how many.
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

    const simulated = paymentBypassEnabled(request)
    const alreadyInSquare = body.alreadyInSquare === true
    // "Sell a seat": the same add, but the money is taken at the register.
    const payAtRegister = body.payAtRegister === true
    const what = payAtRegister ? 'Door seat' : 'Comped seat'
    let squareBookingIds: string[] = []
    let seatsAdded = seats
    let squareNote: string | null = null
    let refusal: string | null = null

    if (!alreadyInSquare && !simulated) {
      const customer = await providers.customer.findOrCreate({ email, givenName, familyName, ...(phone ? { phone } : {}) })
      for (let i = 0; i < seats; i++) {
        // Square lists one attendee per customer per class, so seats 2+ go to
        // name-only guest customers ("Gia Winner (guest 2 of 3)").
        let customerId = customer.id
        if (i > 0) {
          try {
            customerId = (await providers.customer.createGuest({
              givenName,
              familyName: `${familyName} (guest ${i + 1} of ${seats})`,
              note: `${what} ${i + 1} of ${seats} with ${givenName} ${familyName} <${email}>, ${workshop.name}.`,
            })).id
          } catch (err) {
            refusal = `guest customer: ${err instanceof Error ? err.message.slice(0, 150) : String(err)}`
            logger.error('Could not create a guest customer for a comped seat', { scheduleId, seat: i + 1, error: refusal })
            squareNote = `Square added ${squareBookingIds.length} of ${seats} seats, then stopped. Only those ${squareBookingIds.length} are recorded and in the email.`
            break
          }
        }
        const r = await addClassAttendee({ scheduleId, startAt: workshop.startAt, customerId })
        if (r.ok) { squareBookingIds.push(r.bookingId); continue }
        logger.error('Square refused a comped seat', { scheduleId, seat: i + 1, kind: r.kind, status: r.status, detail: r.detail })
        if (squareBookingIds.length === 0) {
          if (r.kind === 'signed_out') {
            return reply(409, { code: 'square_signed_out', error: 'The site’s Square sign-in has expired, so the seat wasn’t added. Add them in Square instead, then tap “I added them in Square”.' })
          }
          return reply(r.kind === 'refused' ? 422 : 502, {
            code: 'square_refused',
            error: r.kind === 'refused'
              ? `Square wouldn’t add the seat${/capacity|full|sold/i.test(r.detail) ? ' — the class looks full' : ''}. Nothing was added or sent.`
              : 'Square didn’t answer, so we can’t tell whether the seat was added. Check the class in Square before trying again.',
          })
        }
        refusal = `${r.kind}${r.status ? ` ${r.status}` : ''}: ${r.detail.slice(0, 150)}`
        squareNote = `Square added ${squareBookingIds.length} of ${seats} seats, then stopped. Only those ${squareBookingIds.length} are recorded and in the email.`
        break
      }
      seatsAdded = squareBookingIds.length
    }

    const dueCents = payAtRegister ? (workshop.priceCents ?? 0) * seatsAdded : 0
    const bookingId = squareBookingIds[0] ?? 'comp_' + randomUUID().slice(0, 10)
    const picks = checked.value.filter((p) => p.seat <= seatsAdded)
    await saveSeatChoices({
      eventKind: 'workshop',
      eventId: scheduleId,
      bookingId,
      orderId: null,
      customer: { givenName, familyName, email, phone },
      seats: seatsAdded,
      picks,
      at: new Date().toISOString(),
      attemptId: bookingId,
      ...(payAtRegister ? { payAtRegister: true as const } : { comped: true as const }),
      by: byOf(member),
      ...(squareBookingIds.length ? { squareBookingIds } : {}),
      ...(simulated ? { simulated: true as const } : {}),
    })

    let emailSent = false
    try {
      emailSent = await sendWorkshopConfirmation({
        origin: new URL(request.url).origin,
        bookingId,
        workshop,
        seats: seatsAdded,
        email,
        givenName,
        receiptUrl: null,
        options,
        picks,
        totalChargedCents: 0,
        ...(payAtRegister ? { dueAtStudioCents: dueCents } : { comped: true }),
      })
    } catch (err) {
      logger.error('Comp seat confirmation email failed', { bookingId, error: err instanceof Error ? err.message : String(err) })
    }
    if (!emailSent) logger.warn('Comp seat confirmation not sent', { bookingId })

    await recordAudit({
      by: member,
      action: payAtRegister ? 'seat.sold-at-door' : 'seat.comped',
      target: { kind: 'workshop', id: scheduleId, label: workshop.name },
      details: {
        bookingId, seats: seatsAdded, requested: seats, ...(payAtRegister ? { dueCents } : {}), email, name: `${givenName} ${familyName}`, emailSent,
        addedInSquare: alreadyInSquare ? 'by hand' : simulated ? 'simulated' : 'by the site',
        ...(squareBookingIds.length ? { squareBookingIds: squareBookingIds.join(',') } : {}),
        ...(refusal ? { squareRefusal: refusal } : {}),
      },
      ...(simulated ? { simulated: true as const } : {}),
    })
    return reply(200, { data: { bookingId, emailSent, seats: seatsAdded, ...(payAtRegister ? { dueCents } : {}), ...(squareNote ? { warning: squareNote } : {}) } })
  } catch (err) {
    logger.error('Comp seat failed', { scheduleId, error: err instanceof Error ? err.message : String(err) })
    return bad('Couldn’t record that seat — please try again.', 503)
  }
}
