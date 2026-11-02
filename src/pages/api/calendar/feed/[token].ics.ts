import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { createLogger } from '@lib/logger'
import { isActiveStaffId } from '@lib/staff-directory'
import { findFeed, touchFeed } from '@lib/staffing/feed-store'
import { feedFor, studioLocation } from '@lib/staffing/feed-events'
import { buildFeed } from '@lib/staffing/ics-feed'

export const prerender = false

const logger = createLogger('api:calendar-feed')

/** Every refusal answers exactly like this: a wrong, stopped, replaced or departed person's link looks missing. */
const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/**
 * A read-only calendar link for a phone (stage 3). No cookie: the secret
 * token in the URL is the key. What it shows comes from the stored link
 * (crew → their own shifts, owners → everything); anything in the query
 * string is ignored. A schedule that can't be read is a 503, so a calendar
 * app keeps its last copy instead of emptying it.
 */
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  if (rateLimited(`calendar-feed:${clientAddress ?? 'unknown'}`, 60, 60_000)) {
    return new Response('Too many requests', { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' } })
  }
  const token = typeof params.token === 'string' ? params.token : ''
  let record
  try {
    record = await findFeed(token)
    if (record && record.scope === 'mine' && !(record.staffId && (await isActiveStaffId(record.staffId)))) record = null
  } catch (err) {
    logger.error('Calendar link check failed', { error: err instanceof Error ? err.message : String(err) })
    return new Response('Try again soon', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' } })
  }
  if (!record) return notFound()

  const now = new Date()
  let body: string
  try {
    const { name, events } = await feedFor(record, now, new URL(request.url).origin)
    body = buildFeed(events, { name, now, location: studioLocation() })
  } catch (err) {
    logger.error('Calendar feed could not be built', { error: err instanceof Error ? err.message : String(err) })
    return new Response('Try again soon', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' } })
  }
  await touchFeed(record.hash, now)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline; filename="hometown-studio.ics"',
    },
  })
}
