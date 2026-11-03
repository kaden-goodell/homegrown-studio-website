import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { createLogger } from '@lib/logger'
import { getClass } from '@lib/classes/class-store'
import { isOwnClassId } from '@lib/classes/staff-view'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { cleanSeats } from '@lib/classes/checkout'
import type { BookingRequest } from '@lib/classes/pricing'
import { isPhone } from '@lib/contact-rules'
import { readerStatus } from '@lib/classes/reader-setting'
import { checkReaderSale, letReaderSeatGo, ReaderError, startReaderSale, takeReaderReturn } from '@lib/classes/reader-flow'

export const prerender = false

const logger = createLogger('api:staff:reader')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BOOKING_RE = /^bkg_[A-Za-z0-9_-]{1,120}$/

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => reply(status, { error, ...extra })

/**
 * GET (staff): is Charge on the reader on, and can it be used here?
 * → { data: { on, linked, message } }. `message` is the plain sentence the
 * sheet shows when it's on but the website isn't linked to the Square app.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await staffAuthorized(request))) return bad('Unauthorized', 401)
  const s = await readerStatus()
  return reply(200, { data: { on: s.on, linked: s.linked, message: s.message } })
}

/**
 * POST:
 *   { action: 'start', classId, passId, tickets, sessionIds?, picks?, givenName, familyName, email, phone?,
 *     attempt, overCapacity?, sendEmail? } (staff) → { data: { bookingId, amountCents, posUrl } }; 404 when it's turned off
 *   { action: 'return', data }    the Square app's answer, from /staff/pos-return. Needs no staff sign-in: the
 *                                 signed state in `data` is what lets it in, and a payment is only ever marked
 *                                 paid after Square's own order checks out. → { data: ReaderAnswer }
 *   { action: 'check', bookingId } (staff) ask Square for the payment → { data: ReaderAnswer }
 *   { action: 'let-go', bookingId } (staff) Square is asked first; refused when it shows paid → { data: ReaderAnswer }
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('Invalid request body')
  const origin = new URL(request.url).origin
  const action = String(body.action ?? '')
  // R41: a test site with no store of its own never touches the live seats.
  const testSite = classWritesRefusal(request)
  if (testSite) return bad(testSite, 503)

  try {
    if (action === 'return') return reply(200, { data: await takeReaderReturn(body.data, origin) })

    const member = await staffAuthorized(request)
    if (!member) return bad('Sign in to /staff first.', 401)

    if (action === 'check' || action === 'let-go') {
      const bookingId = typeof body.bookingId === 'string' && BOOKING_RE.test(body.bookingId) ? body.bookingId : ''
      if (!bookingId) return bad('Pick a sale.')
      const data = action === 'check'
        ? await checkReaderSale(bookingId, origin)
        : await letReaderSeatGo(bookingId, { ...byOf(member), role: member.role }, origin)
      return reply(200, { data })
    }

    if (action !== 'start') return bad('That isn’t something this can do.')
    const classId = typeof body.classId === 'string' ? body.classId.trim() : ''
    if (!isOwnClassId(classId)) return bad('Pick a class.')
    const givenName = String(body.givenName ?? '').trim()
    const familyName = String(body.familyName ?? '').trim()
    const email = String(body.email ?? '').trim()
    const phone = String(body.phone ?? '').trim()
    if (givenName.length < 1 || givenName.length > 60) return bad('Add a first name (60 characters or fewer).')
    if (familyName.length < 1 || familyName.length > 60) return bad('Add a last name (60 characters or fewer).')
    if (!EMAIL_RE.test(email)) return bad('That email doesn’t look right.')
    if (phone && !isPhone(phone)) return bad('That phone number doesn’t look right.')
    const attempt = typeof body.attempt === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(body.attempt) ? body.attempt : ''
    if (!attempt) return bad('This sheet is out of date. Close it and start again.')

    const cls = await getClass(classId)
    if (!cls) return bad('Class not found', 404)
    const passId = typeof body.passId === 'string' ? body.passId : ''
    const tickets: Record<string, number> = {}
    if (body.tickets && typeof body.tickets === 'object') {
      for (const [k, v] of Object.entries(body.tickets as Record<string, unknown>)) tickets[k] = Number(v)
    }
    const count = Object.values(tickets).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
    if (count < 1 || count > 10) return bad('Seats must be a whole number from 1 to 10.')
    const picks: { seat: number; optionId: string; choice: string }[] = Array.isArray(body.picks) ? body.picks : []
    const needsSeats = cls.content.questions.length > 0 || cls.content.addOns.length > 0
    const seats = needsSeats
      ? cleanSeats(cls, Array.from({ length: count }, (_, i) => ({
          answers: Object.fromEntries(picks.filter((p) => Number(p?.seat) === i + 1 && p?.choice).map((p) => [String(p.optionId), String(p.choice)])),
        })))
      : undefined
    const req: BookingRequest = {
      passId, tickets,
      ...(Array.isArray(body.sessionIds) ? { sessionIds: body.sessionIds.map(String) } : {}),
      ...(seats ? { seats } : {}),
    }
    const started = await startReaderSale({
      cls, request: req, customer: { givenName, familyName, email, phone }, member,
      overCapacity: body.overCapacity === true, sendEmail: body.sendEmail === true, attempt, origin,
    })
    if (!started.ok) return bad(started.error, started.status, started.code ? { code: started.code } : {})
    return reply(200, { data: { bookingId: started.bookingId, amountCents: started.amountCents, posUrl: started.posUrl, seatsLabel: started.seatsLabel, ...(started.replayed ? { replayed: true } : {}) } })
  } catch (err) {
    if (err instanceof ReaderError) return bad(err.message, err.status, err.code ? { code: err.code } : {})
    logger.error('Reader request failed', { action, error: err instanceof Error ? err.message : String(err) })
    return bad(action === 'start' ? 'Couldn’t start the sale. Nothing was charged. Try again.' : 'That didn’t work. Try again, or tap Check again on the class list.', 503)
  }
}
