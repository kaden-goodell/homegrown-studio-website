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
import { addGuestSeats } from '@lib/guest-seats'
import { getWaiverRecord } from '@lib/waiver-store'
import { addAttending, personIdsOf } from '@lib/attending'
import { substantiveSince, compareVersions } from '@config/waiver-content'

export const prerender = false

const logger = createLogger('api:staff:comp-seat')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const bad = (error: string, status = 400) => reply(status, { error })
const alreadyInSquareOf = (body: any) => body.alreadyInSquare === true

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
 * `customerId` puts the seat on a customer picked from "Find a customer"
 * instead of matching by email. `waiverId` + `people` (+ `guests`, names not
 * on the waiver) seat the people picked from that household's waiver, one
 * seat each, named in Square, and add them to the roster as attending (only
 * ever widening who's attending).
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
  const customerId = typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : null
  const waiverId = typeof body.waiverId === 'string' && body.waiverId.trim() ? body.waiverId.trim() : null
  const people: string[] = Array.isArray(body.people) ? [...new Set<string>(body.people.map((p: unknown) => String(p).trim()).filter(Boolean))] : []
  const guests: string[] = Array.isArray(body.guests) ? body.guests.map((g: unknown) => String(g).trim()).filter(Boolean) : []
  if (guests.some((g) => g.length > 60)) return bad('Keep each name to 60 characters or fewer.')
  const seats = waiverId ? people.length + guests.length : Number(body.seats)
  if (waiverId && seats < 1) return bad('Pick who’s coming.')
  if (!Number.isInteger(seats) || seats < 1 || seats > 10) return bad('Seats must be a whole number from 1 to 10.')

  try {
    const meta = await getEventMeta('workshop', scheduleId)
    const options = meta?.options ?? []
    const checked = validatePicks(options, seats, body.picks)
    if (!checked.ok) return bad(checked.error)

    const workshops = (await providers.workshop.listAllWorkshops?.()) ?? []
    const workshop = workshops.find((w) => w.scheduleId === scheduleId)
    if (!workshop) return bad('Class not found', 404)

    // The household picked from the waiver: in date, on the current agreement, real people.
    const waiver = waiverId ? await getWaiverRecord(waiverId) : null
    if (waiverId) {
      if (!waiver) return bad('That waiver isn’t on file.', 404)
      if (new Date(waiver.validUntil).getTime() <= Date.now() || compareVersions(waiver.agreementVersion, substantiveSince) < 0) {
        return bad('That waiver is out of date, so they’ll need to sign again. Use Seats instead.', 409)
      }
      const valid = new Set(personIdsOf(waiver))
      if (people.some((p) => !valid.has(p))) return bad('Someone picked isn’t on that waiver.')
    }
    const nameOf = (id: string) => id === 'adult' ? `${waiver!.adult.firstName} ${waiver!.adult.lastName}`.trim() : waiver!.minors[Number(id.split(':')[1])].name
    const seatNames = waiver ? [...people.map(nameOf), ...guests] : undefined

    if (customerId && !alreadyInSquareOf(body) && !paymentBypassEnabled(request)) {
      const known = await providers.customer.getById(customerId)
      if (!known) return bad('That customer isn’t in Square anymore. Search again.', 404)
    }

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
      const holderId = customerId ?? (await providers.customer.findOrCreate({ email, givenName, familyName, ...(phone ? { phone } : {}) })).id
      const first = await addClassAttendee({ scheduleId, startAt: workshop.startAt, customerId: holderId })
      if (!first.ok) {
        logger.error('Square refused a comped seat', { scheduleId, seat: 1, kind: first.kind, status: first.status, detail: first.detail })
        if (first.kind === 'signed_out') {
          return reply(409, { code: 'square_signed_out', error: 'The site’s Square sign-in has expired, so the seat wasn’t added. Add them in Square instead, then tap “I added them in Square”.' })
        }
        return reply(first.kind === 'refused' ? 422 : 502, {
          code: 'square_refused',
          error: first.kind === 'refused'
            ? `Square wouldn’t add the seat${/capacity|full|sold/i.test(first.detail) ? ' — the class looks full' : ''}. Nothing was added or sent.`
            : 'Square didn’t answer, so we can’t tell whether the seat was added. Check the class in Square before trying again.',
        })
      }
      squareBookingIds.push(first.bookingId)
      // Square lists one attendee per customer per class, so seats 2+ go to
      // name-only guest customers ("Gia Winner (guest 2 of 3)"), shared with
      // the online booking (src/lib/guest-seats.ts).
      if (seats > 1) {
        const guests = await addGuestSeats({
          scheduleId,
          startAt: workshop.startAt,
          className: workshop.name,
          holder: { givenName, familyName, email },
          firstSeat: 2,
          totalSeats: seats,
          what,
          ...(seatNames ? { seatNames } : {}),
        })
        squareBookingIds.push(...guests.bookingIds)
        if (guests.stopped) {
          refusal = `${guests.stopped.kind}${guests.stopped.status ? ` ${guests.stopped.status}` : ''}: ${guests.stopped.detail.slice(0, 150)}`
          squareNote = `Square added ${squareBookingIds.length} of ${seats} seats, then stopped. Only those ${squareBookingIds.length} are recorded and in the email.`
        }
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
      ...(seatNames ? { seatNames: seatNames.slice(0, seatsAdded) } : {}),
      ...(simulated ? { simulated: true as const } : {}),
    })

    // Seats go in waiver people first, so the first `seatsAdded` are the ones Square took.
    let rosterNote: string | null = null
    const attendingAdded = people.slice(0, seatsAdded)
    if (waiver && attendingAdded.length) {
      try {
        await addAttending({ kind: 'workshop', id: scheduleId, waiver, people: attendingAdded, by: byOf(member) })
      } catch (err) {
        logger.error('Comp seat: could not mark them attending', { scheduleId, waiverId, error: err instanceof Error ? err.message : String(err) })
        rosterNote = 'The seat is in, but they didn’t make it onto the roster. Add them with + Add family at the door.'
      }
    }

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
        ...(customerId ? { customerId } : {}),
        ...(waiverId ? { waiverId, attending: attendingAdded.join(',') } : {}),
      },
      ...(simulated ? { simulated: true as const } : {}),
    })
    return reply(200, { data: { bookingId, emailSent, seats: seatsAdded, ...(payAtRegister ? { dueCents } : {}), ...(squareNote || rosterNote ? { warning: [squareNote, rosterNote].filter(Boolean).join(' ') } : {}) } })
  } catch (err) {
    logger.error('Comp seat failed', { scheduleId, error: err instanceof Error ? err.message : String(err) })
    return bad('Couldn’t record that seat — please try again.', 503)
  }
}
