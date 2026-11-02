import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { getClass } from '@lib/classes/class-store'
import { quote as quoteFor, type BookingRequest } from '@lib/classes/pricing'
import { CLASS_TAX_PERCENT, cleanSeats, publicQuote } from '@lib/classes/checkout'
import { getPromo, getUses } from '@lib/promos/promo-store'
import { normalizeCode, promoRefusal, PROMO_REFUSALS, usesLeft } from '@lib/promos/rules'
import { staffAuthorized } from '@lib/staff-auth'

export const prerender = false
const logger = createLogger('api:classes:promo')
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
const refuse = (status: number, detail: string) => answer(status, { error: 'Code not applied', detail })

/**
 * "Have a code?" on the pay step: POST { classId, code, request } → the
 * booking priced with the code (the early-bird too), or the sentence saying
 * why it doesn't work. Nothing is held or reserved here; the booking itself
 * checks the code again and reserves its use. Unknown and turned-off codes
 * read the same (no probing). 10 tries a minute per address. `?door=1`:
 * signed-in staff pricing a door sale (a session stays open until it ends).
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const door = new URL(request.url).searchParams.get('door') === '1'
  if (door && !staffAuthorized(request)) return refuse(401, 'Sign in to /staff first.')
  if (!door && !bookingsOpen(request, 'workshops')) return bookingsClosedResponse()
  if (rateLimited(`class-promo:${clientAddress}`, 10, 60_000)) {
    return refuse(429, 'That’s a lot of codes in a row. Give it a minute, then try again.')
  }
  let body: any
  try {
    body = await request.json()
  } catch {
    return refuse(400, PROMO_REFUSALS.invalid)
  }
  const classId = typeof body?.classId === 'string' ? body.classId : ''
  const r = body?.request
  if (!classId || !r || typeof r !== 'object' || typeof r.passId !== 'string' || !r.tickets || typeof r.tickets !== 'object') {
    return refuse(400, 'Reload the page and try again.')
  }
  const code = normalizeCode(typeof body.code === 'string' ? body.code.slice(0, 60) : '')
  if (!code) return refuse(409, PROMO_REFUSALS.invalid)

  try {
    const cls = await getClass(classId)
    if (!cls || (cls.status !== 'open' && !(door && cls.status === 'closed'))) return refuse(409, 'This class isn’t open for booking.')
    const req: BookingRequest = {
      passId: r.passId,
      tickets: r.tickets,
      ...(Array.isArray(r.sessionIds) ? { sessionIds: r.sessionIds.map(String) } : {}),
      ...(Array.isArray(r.seats) ? { seats: cleanSeats(cls, r.seats) } : {}),
    }
    const now = new Date()
    const promo = await getPromo(code)
    const uses = promo ? await getUses(code) : null
    const refusal = promoRefusal(promo, cls, now, promo ? usesLeft(promo, uses, now) : null)
    if (refusal) return refuse(409, refusal)
    const priced = quoteFor(cls, req, now, CLASS_TAX_PERCENT, { ...(door ? { door: true } : {}), promo })
    if (!priced.ok) return refuse(priced.field ? 400 : 409, priced.error)
    return answer(200, { data: { code, quote: publicQuote(priced.value) } })
  } catch (err) {
    logger.error('Code check failed', { classId, error: err instanceof Error ? err.message : String(err) })
    return refuse(503, 'We couldn’t check that code just now. Try again in a minute.')
  }
}
