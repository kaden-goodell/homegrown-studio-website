/**
 * The online booking gate: every booking and payment endpoint and every
 * booking page asks here whether a kind of booking is open.
 *
 * What's open comes from the owners' switch (/admin › More › Online booking,
 * src/lib/booking-switch.ts), read at request time with a 30-second memory,
 * so a flip there needs no redeploy. Until an owner first saves the switch,
 * the hosting settings apply exactly as before:
 *   BOOKINGS_OPEN=true    → every kind open to everyone
 *   BOOKINGS_OPEN=parties → only the listed kinds (comma list of parties,
 *                           workshops, kits); everything else closed
 *   PREVIEW_TOKEN=<secret> → ?preview=<secret> drops a cookie that unlocks
 *                            booking for THAT browser only (the test link).
 * Once saved, the switch wins over both (its own test link replaces
 * PREVIEW_TOKEN). 'other' (the hidden older flows) stays with BOOKINGS_OPEN.
 * If the switch can't be read on a fresh server, every switched kind reads
 * as paused (booking-switch.ts fails closed).
 *
 * Every gate answer is a Promise and every name ends in `Now`
 * (bookingsOpenNow, kindOpenNow, pauseNoteNow, ...): call them with `await`.
 * The older synchronous names (bookingsOpen, envBookingsOpen, previewToken,
 * hasValidPreviewCookie, previewQueryMatches) are gone on purpose, so code
 * written against them fails to compile instead of reading a Promise as
 * "open" (`!promise` is always false). tests/lib/bookings-gate-await.test.ts
 * fails on any un-awaited gate call under src/.
 *
 * Server only.
 */
import { timingSafeEqual } from 'node:crypto'
import { envKindOpen, envPreviewToken, getSwitchState, type SwitchState } from '@lib/booking-switch'

const PREVIEW_COOKIE = 'hg_preview'

/** What can be booked. Older flows (hidden programs, legacy checkout) are 'other'. */
export type BookingKind = 'parties' | 'workshops' | 'kits' | 'other'

function openIn(state: SwitchState, kind: BookingKind): boolean {
  return kind === 'other' ? envKindOpen('other') : state.open[kind]
}

/** Constant-time string compare (the test-link secret). */
export function secretMatches(given: string | null | undefined, secret: string): boolean {
  if (!secret || typeof given !== 'string' || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** True when this kind is open to everyone right now. With no kind: when any switched kind is open. */
export async function kindOpenNow(kind?: BookingKind): Promise<boolean> {
  const state = await getSwitchState()
  if (!kind) return state.open.parties || state.open.workshops || state.open.kits
  return openIn(state, kind)
}

/**
 * Whether saved-card charges for freed class seats (the stage-4 waitlist
 * runner) may run now. Owner decision: while classes & workshops are paused
 * the runner does NOT charge anyone; it picks up again once they're reopened.
 */
export async function waitlistChargesAllowedNow(): Promise<boolean> {
  // Concurrency minor 2: read fresh (not this server's 30-second memory), so a pause saved a moment ago on
  // another server stops saved-card charges at once.
  return openIn(await getSwitchState({ fresh: true }), 'workshops')
}

/** The test link's secret in force, or '' when there is none. */
export async function previewTokenNow(): Promise<string> {
  return (await getSwitchState()).previewToken
}

/** PREVIEW_TOKEN alone (tests and the fallback). */
export { envPreviewToken }

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** True when the request carries the test-link cookie matching the secret in force. */
export async function hasValidPreviewCookieNow(request: Request): Promise<boolean> {
  return secretMatches(cookieValue(request, PREVIEW_COOKIE), await previewTokenNow())
}

/** True when a ?preview=<secret> query param matches the secret in force. */
export async function previewQueryMatchesNow(url: URL): Promise<boolean> {
  return secretMatches(url.searchParams.get('preview'), await previewTokenNow())
}

/** The cookie name pages should set when the test link matches. */
export const previewCookieName = PREVIEW_COOKIE

/**
 * Whether this kind of booking is open for this request: open to everyone when
 * the switch (or, before the first save, BOOKINGS_OPEN) opens it; otherwise
 * only when the browser holds a valid test-link cookie (which unlocks every
 * kind, for the owner's testing). Always `await` it.
 */
export async function bookingsOpenNow(request: Request | undefined, kind: BookingKind): Promise<boolean> {
  if (await kindOpenNow(kind)) return true
  if (request && (await hasValidPreviewCookieNow(request))) return true
  return false
}

/** What customers read while booking is paused: the owners' note, or the plain default. */
export async function pauseNoteNow(): Promise<string> {
  return (await getSwitchState()).pauseNote
}

/** 403 response for a booking/payment endpoint hit while that kind is paused. */
export async function bookingsClosedResponse(): Promise<Response> {
  return new Response(JSON.stringify({ error: await pauseNoteNow() }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** Cookie setter the booking pages hand in (Astro.cookies.set). */
type SetCookie = (name: string, value: string, opts: { path: string; httpOnly: boolean; sameSite: 'lax'; maxAge: number }) => void

/** The same address without `preview` (where the test link sends the browser once its cookie is set). */
export function urlWithoutPreview(url: URL): string {
  const clean = new URL(url.toString())
  clean.searchParams.delete('preview')
  return clean.pathname + clean.search + clean.hash
}

/**
 * One booking page's gate, in one call: open for everyone, or for this browser
 * through the test link, and the pause note to show when it isn't.
 *
 * A `?preview=` that matches sets the cookie for 30 days and returns
 * `redirect`: the same address without `preview`. Pages answer with it
 * (`if (gate.redirect) return Astro.redirect(gate.redirect, 302)`) so the
 * secret never reaches analytics, the address bar or browser history.
 */
export async function bookingPageGate(
  page: { url: URL; request: Request; setCookie?: SetCookie },
  kind: BookingKind,
): Promise<{ open: boolean; preview: boolean; note: string; redirect?: string }> {
  const state = await getSwitchState()
  const token = state.previewToken
  const queryMatch = secretMatches(page.url.searchParams.get('preview'), token)
  let redirect: string | undefined
  if (queryMatch && page.setCookie) {
    page.setCookie(PREVIEW_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
    redirect = urlWithoutPreview(page.url)
  }
  const preview = queryMatch || secretMatches(cookieValue(page.request, PREVIEW_COOKIE), token)
  return { open: openIn(state, kind) || preview, preview, note: state.pauseNote, ...(redirect ? { redirect } : {}) }
}
