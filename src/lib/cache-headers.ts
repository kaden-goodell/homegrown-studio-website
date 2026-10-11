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

/**
 * The /workshops and /calendar pages themselves. Their HTML is the same for
 * every visitor (the lists load live from the JSON above), so Netlify keeps a
 * copy: fresh for five minutes, and after that the kept copy is handed out at
 * once while a new one is built behind it. Without this, the first tap after a
 * quiet spell waited 1–3 s for a sleeping server, with no sign on screen.
 * A deploy clears the copy, so a changed page is never served stale.
 *
 * Not stored (null): a shared one-class link (?w=, its preview names that
 * class), and anything carrying the owner's preview link or cookie.
 */
const PAGE_FRESH_SECONDS = 300
const PAGE_SERVE_WHILE_REFRESHING_SECONDS = 7 * 24 * 60 * 60

export function publicPageHeaders(request: Request, url: URL): Record<string, string> | null {
  if (url.searchParams.has('w') || url.searchParams.has('preview') || hasPreviewCookie(request)) return null
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, durable, max-age=${PAGE_FRESH_SECONDS}, stale-while-revalidate=${PAGE_SERVE_WHILE_REFRESHING_SECONDS}`,
    'Netlify-Vary': `query,cookie=${previewCookieName}`,
  }
}
