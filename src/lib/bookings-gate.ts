/**
 * Pre-opening booking gate.
 *
 * The studio is not open yet, so the public must not be able to book or be
 * charged — but the marketing site stays live. This gates every money/booking
 * endpoint and the booking pages behind an env flag, with a secret preview
 * bypass so the owner can still exercise the real production flow.
 *
 * Controls (Netlify environment):
 *   BOOKINGS_OPEN=true   → bookings open to everyone (set this on grand-opening day)
 *   PREVIEW_TOKEN=<secret> → visiting any page with ?preview=<secret> drops a
 *                            cookie that unlocks booking for THAT browser only.
 *
 * Default (BOOKINGS_OPEN unset/anything-but-"true") = CLOSED.
 */

const PREVIEW_COOKIE = 'hg_preview'

function readEnv(key: string): string | undefined {
  try {
    const ime: any = (import.meta as any)?.env
    if (ime && ime[key] != null && ime[key] !== '') return String(ime[key])
  } catch {
    /* import.meta not available in this context */
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] != null && process.env[key] !== '') {
    return String(process.env[key])
  }
  return undefined
}

/** True when BOOKINGS_OPEN is explicitly "true". */
export function envBookingsOpen(): boolean {
  return readEnv('BOOKINGS_OPEN') === 'true'
}

/** The configured preview secret, or '' when none is set. */
export function previewToken(): string {
  return readEnv('PREVIEW_TOKEN') ?? ''
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/** True when the request carries the preview-unlock cookie matching PREVIEW_TOKEN. */
export function hasValidPreviewCookie(request: Request): boolean {
  const token = previewToken()
  if (!token) return false
  return cookieValue(request, PREVIEW_COOKIE) === token
}

/** True when a ?preview=<secret> query param matches PREVIEW_TOKEN. */
export function previewQueryMatches(url: URL): boolean {
  const token = previewToken()
  if (!token) return false
  return url.searchParams.get('preview') === token
}

/** The cookie name pages should set when previewQueryMatches() is true. */
export const previewCookieName = PREVIEW_COOKIE

/**
 * Whether bookings are open for this request. Open to everyone when
 * BOOKINGS_OPEN=true; otherwise only when the browser holds a valid preview
 * cookie. Endpoints pass their Request; call with no argument for the
 * everyone-or-nobody check.
 */
export function bookingsOpen(request?: Request): boolean {
  if (envBookingsOpen()) return true
  if (request && hasValidPreviewCookie(request)) return true
  return false
}

/** 403 response for a booking/payment endpoint hit while bookings are closed. */
export function bookingsClosedResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "Online booking isn't open yet — we'll start taking reservations closer to our grand opening. Thanks for your patience!",
    }),
    { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
