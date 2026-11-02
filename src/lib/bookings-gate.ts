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
 *
 * Server only.
 */
import { envKindOpen, envOpenKinds, envPreviewToken, getSwitchState, type SwitchState } from '@lib/booking-switch'

const PREVIEW_COOKIE = 'hg_preview'

/** What can be booked. Older flows (hidden programs, legacy checkout) are 'other'. */
export type BookingKind = 'parties' | 'workshops' | 'kits' | 'other'

/**
 * BOOKINGS_OPEN alone (the hosting setting), ignoring the owners' switch. With
 * no kind: true when ANY kind is open. Kept for the fallback and its tests;
 * booking paths use kindOpen()/bookingsOpen().
 */
export function envBookingsOpen(kind?: BookingKind): boolean {
  const { all, kinds } = envOpenKinds()
  if (all) return true
  if (!kind) return kinds.size > 0
  return kinds.has(kind)
}

function openIn(state: SwitchState, kind: BookingKind): boolean {
  return kind === 'other' ? envKindOpen('other') : state.open[kind]
}

/** True when this kind is open to everyone right now. With no kind: when any switched kind is open. */
export async function kindOpen(kind?: BookingKind): Promise<boolean> {
  const state = await getSwitchState()
  if (!kind) return state.open.parties || state.open.workshops || state.open.kits
  return openIn(state, kind)
}

/** The test link's secret in force, or '' when there is none. */
export async function previewToken(): Promise<string> {
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
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/** True when the request carries the test-link cookie matching the secret in force. */
export async function hasValidPreviewCookie(request: Request): Promise<boolean> {
  const token = await previewToken()
  if (!token) return false
  return cookieValue(request, PREVIEW_COOKIE) === token
}

/** True when a ?preview=<secret> query param matches the secret in force. */
export async function previewQueryMatches(url: URL): Promise<boolean> {
  const token = await previewToken()
  if (!token) return false
  return url.searchParams.get('preview') === token
}

/** The cookie name pages should set when previewQueryMatches() is true. */
export const previewCookieName = PREVIEW_COOKIE

/**
 * Whether this kind of booking is open for this request: open to everyone when
 * the switch (or, before the first save, BOOKINGS_OPEN) opens it; otherwise
 * only when the browser holds a valid test-link cookie (which unlocks every
 * kind, for the owner's testing).
 */
export async function bookingsOpen(request: Request | undefined, kind: BookingKind): Promise<boolean> {
  if (await kindOpen(kind)) return true
  if (request && (await hasValidPreviewCookie(request))) return true
  return false
}

/** What customers read while booking is paused: the owners' note, or the plain default. */
export async function pauseNote(): Promise<string> {
  return (await getSwitchState()).pauseNote
}

/** 403 response for a booking/payment endpoint hit while that kind is paused. */
export async function bookingsClosedResponse(): Promise<Response> {
  return new Response(JSON.stringify({ error: await pauseNote() }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** Cookie setter the booking pages hand in (Astro.cookies.set). */
type SetCookie = (name: string, value: string, opts: { path: string; httpOnly: boolean; sameSite: 'lax'; maxAge: number }) => void

/**
 * One booking page's gate, in one call: open for everyone, or for this browser
 * through the test link (a matching ?preview= sets the cookie for 30 days),
 * and the pause note to show when it isn't.
 */
export async function bookingPageGate(
  page: { url: URL; request: Request; setCookie?: SetCookie },
  kind: BookingKind,
): Promise<{ open: boolean; preview: boolean; note: string }> {
  const state = await getSwitchState()
  const token = state.previewToken
  const queryMatch = !!token && page.url.searchParams.get('preview') === token
  if (queryMatch && page.setCookie) page.setCookie(PREVIEW_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
  const preview = queryMatch || (!!token && cookieValue(page.request, PREVIEW_COOKIE) === token)
  return { open: openIn(state, kind) || preview, preview, note: state.pauseNote }
}
