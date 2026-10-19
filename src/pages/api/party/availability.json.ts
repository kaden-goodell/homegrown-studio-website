import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { partyStartsOnDate, PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'

const logger = createLogger('api:party:availability')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** `{ id: count }` with plausible ids and whole counts only; anything else is dropped. */
function addOnsOf(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [id, n] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (id.length <= 100 && typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 1000) out[id] = n
  }
  return out
}

/**
 * The open party times on one studio-local date: `{ date, packageId?, addOns? }`
 * (an old page's `serviceVariationId` is accepted and ignored). From our party
 * settings and `@lib/parties/open-times`; when anything can't be read the
 * answer is 503 and no time is shown (never "every time").
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!bookingsOpen(request, 'parties')) return bookingsClosedResponse()
  if (rateLimited(`party-avail:${clientAddress}`, 30, 60_000)) {
    return json({ error: 'Too many requests — give it a minute.' }, 429)
  }
  const startTime = Date.now()
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid date' }, 400)
  }
  const date = body?.date
  // Public endpoint — validate inputs. Date must be a YYYY-MM-DD string.
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Invalid date' }, 400)
  const packageId = typeof body.packageId === 'string' && body.packageId.length <= 100 ? body.packageId : undefined

  try {
    const view = await partyStartsOnDate(date, { packageId, addOns: addOnsOf(body.addOns) })
    const durationMinutes = view.minutes
    const slots = view.open.map((startAt) => ({
      startAt,
      endAt: new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString(),
      durationMinutes,
    }))
    logger.info('Party availability complete', { duration_ms: Date.now() - startTime, date, slotCount: slots.length })
    // offered: how many times the day offers at all, so the panel can say when some are taken.
    return json({ data: { slots, offered: view.offered.length } })
  } catch (error) {
    logger.error('Party times could not be read', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return json({ error: PARTY_TIMES_UNREADABLE }, 503)
  }
}
