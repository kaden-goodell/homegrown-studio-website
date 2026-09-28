/**
 * Caching for the public, read-only lists (calendar, workshops).
 *
 * Most visitors get the answer from Netlify's edge, without waiting on Square:
 *   - fresh for a minute
 *   - for ten minutes after that, the stored answer is served straight away
 *     while a new one is fetched behind it
 *
 * A browser holding the owner's preview cookie sees bookable rows the public
 * does not, so its answers are never stored or shared.
 *
 * Booking and payment endpoints do not use this. They are never cached.
 */
import { previewCookieName } from '@lib/bookings-gate'

const FRESH_SECONDS = 60
const SERVE_WHILE_REFRESHING_SECONDS = 600

function hasPreviewCookie(request: Request): boolean {
  const raw = request.headers.get('cookie') ?? ''
  return raw.split(';').some((part) => part.trim().startsWith(`${previewCookieName}=`))
}

export function publicListHeaders(request: Request, options: { failed?: boolean } = {}): Record<string, string> {
  const json = { 'Content-Type': 'application/json' }
  // A failed lookup must not be remembered as "nothing on".
  if (options.failed || hasPreviewCookie(request)) {
    return { ...json, 'Cache-Control': 'private, no-store' }
  }
  return {
    ...json,
    'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
    'Netlify-CDN-Cache-Control': `public, durable, max-age=${FRESH_SECONDS}, stale-while-revalidate=${SERVE_WHILE_REFRESHING_SECONDS}`,
    'Netlify-Vary': `query,cookie=${previewCookieName}`,
  }
}
