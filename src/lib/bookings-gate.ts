/**
 * Pre-opening booking gate.
 *
 * The studio is not open yet, so the public must not be able to book or be
 * charged — but the marketing site stays live. This gates every money/booking
 * endpoint and the booking pages behind an env flag, with a secret preview
 * bypass so the owner can still exercise the real production flow.
 *
 * Controls (Netlify environment):
 *   BOOKINGS_OPEN=true   → every kind of booking open to everyone
 *   BOOKINGS_OPEN=parties → only the listed kinds open (comma list of
 *                           parties, workshops, kits); everything else stays closed
 *   PREVIEW_TOKEN=<secret> → visiting any page with ?preview=<secret> drops a
 *                            cookie that unlocks booking for THAT browser only.
 *
 * Default (BOOKINGS_OPEN unset/anything-but-"true") = CLOSED.
 */

const PREVIEW_COOKIE = 'hg_preview'

function readEnv(key: string): string | undefined {
  try {
    // Must be written exactly `import.meta.env`: Vite substitutes that
    // expression at build time, and `import.meta?.env` is left alone (so it
    // read as undefined on the dev server and the gate stayed closed locally).
    const ime: any = (import.meta as any).env
    if (ime && ime[key] != null && ime[key] !== '') return String(ime[key])
  } catch {
    /* import.meta not available in this context */
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] != null && process.env[key] !== '') {
    return String(process.env[key])
  }
  return undefined
}

/** What can be booked. Older flows (hidden programs, legacy checkout) are 'other'. */
export type BookingKind = 'parties' | 'workshops' | 'kits' | 'other'

/** The kinds BOOKINGS_OPEN opens: "true" = all of them, else a comma list. */
function openKinds(): { all: boolean; kinds: Set<string> } {
  const raw = (readEnv('BOOKINGS_OPEN') ?? '').trim().toLowerCase()
  if (raw === 'true') return { all: true, kinds: new Set() }
  // Only real kind names count, so "false", "off" or a typo opens nothing.
  const known = new Set(['parties', 'workshops', 'kits', 'other'])
  return { all: false, kinds: new Set(raw.split(',').map((k) => k.trim()).filter((k) => known.has(k))) }
}

/**
 * True when BOOKINGS_OPEN opens this kind for everyone. With no kind: true when
 * ANY kind is open (used for "is anything bookable" questions).
 */
export function envBookingsOpen(kind?: BookingKind): boolean {
  const { all, kinds } = openKinds()
  if (all) return true
  if (!kind) return kinds.size > 0
  return kinds.has(kind)
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
 * Whether this kind of booking is open for this request: open to everyone when
 * BOOKINGS_OPEN opens it; otherwise only when the browser holds a valid preview
 * cookie (which unlocks every kind, for the owner's testing).
 */
export function bookingsOpen(request: Request | undefined, kind: BookingKind): boolean {
  if (envBookingsOpen(kind)) return true
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
