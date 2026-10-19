import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { localDate } from '@lib/party-slots'
import { partyStartsInWindow, PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:available-dates')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Every open party time across the booking window, grouped by date, with the
 * times riding along so picking a date shows them at once. `{ packageId?,
 * days? }` (an old page's `serviceVariationId` is accepted and ignored).
 * From our party settings and `@lib/parties/open-times`; when anything can't
 * be read the answer is 503 and no date is shown (never "every date").
 */
export const POST: APIRoute = async ({ request }) => {
  if (!bookingsOpen(request, 'parties')) return bookingsClosedResponse()
  const startTime = Date.now()
  let body: any = {}
  try {
    body = (await request.json()) ?? {}
  } catch {
    body = {}
  }
  const packageId = typeof body.packageId === 'string' && body.packageId.length <= 100 ? body.packageId : undefined
  const asked = Number(body.days)
  const days = Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(Math.floor(asked), 1), 366) : undefined

  try {
    const now = new Date()
    const view = await partyStartsInWindow(now, { packageId, days })

    // How many times each date offers at all, so the panel can say when some are taken.
    const offered: Record<string, number> = {}
    for (const s of view.offered) { const d = localDate(s); offered[d] = (offered[d] ?? 0) + 1 }

    const durationMinutes = view.minutes
    const times: Record<string, { startAt: string; endAt: string; durationMinutes: number }[]> = {}
    for (const startAt of view.open) {
      ;(times[localDate(startAt)] ??= []).push({
        startAt,
        endAt: new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString(),
        durationMinutes,
      })
    }
    const dates = Object.keys(times).sort()

    // Dates whose party times were all taken by other parties: shown as
    // "Booked", so a customer can tell "taken" from "not offered". A day a
    // class or blocked time has taken is simply not offered — it was never booked.
    const bookedDates = Array.from(new Set(view.unblocked.map((s) => localDate(s))))
      .filter((d) => !times[d])
      .sort()

    logger.info('Party available-dates complete', { duration_ms: Date.now() - startTime, dateCount: dates.length })
    return json({ data: { dates, times, bookedDates, windowDays: view.windowDays, offered } })
  } catch (error) {
    logger.error('Party times could not be read', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return json({ error: PARTY_TIMES_UNREADABLE }, 503)
  }
}
