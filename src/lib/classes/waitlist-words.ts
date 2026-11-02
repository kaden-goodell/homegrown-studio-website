/**
 * What people read about the waitlist (stage 4): the consent next to the
 * tick, the panel's sentences and the refusals. Pure and browser-safe, so the
 * booking panel shows exactly the text the server stores with the entry.
 *
 * DRAFT copy for Kaden (tasks-9-10-report.md, COPY FOR KADEN).
 */
import { formatMoney } from '@lib/money'

/** Bumped whenever the consent sentence changes; stored with each entry. */
export const CONSENT_VERSION = 'wl-consent-1'

export const MAX_WAITING_PER_CLASS = 40

const TZ = 'America/Chicago'

/** "Sat, Oct 24 at 8 AM", "Sat, Oct 24 at 8:30 AM" (studio time). */
export function closesLabel(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(':00', '')
  return `${day} at ${time}`
}

/** The sentence next to the unticked consent box. `closesIso` = when the waitlist for these dates closes. */
export function consentText(closesIso: string, maxCents: number): string {
  return `Save my card with Square. If a spot opens before ${closesLabel(closesIso)}, Hometown Studio adds me and charges this card up to ${formatMoney(maxCents)} without asking again. I’ll get a text and an email right away. I can leave the waitlist any time and my card comes off.`
}

export const WAITLIST_MESSAGES = {
  closed: 'The waitlist for this class has closed.',
  spotOpen: 'A spot just opened. Book it now.',
  duplicate: 'You’re already on the waitlist for this class. Your email has the link to leave it.',
  full: 'The waitlist for this class is full. Call or text us and we’ll see what we can do.',
  consent: 'Tick the box to let us save your card and charge it if a spot opens.',
  notOpen: 'This class isn’t taking a waitlist. Nothing was charged.',
  unavailable: 'We couldn’t add you to the waitlist just now. Nothing was charged. Try again in a minute.',
  notFound: 'We couldn’t find that waitlist spot. It may have been removed already.',
  charging: 'A spot just opened and we’re adding you to the class right now. Check your email in a few minutes.',
} as const

/** Panel: why the waitlist step is showing. */
export function waitlistReason(roomLeft: number, wanted: number): string {
  if (roomLeft <= 0) return 'This class is full. Join the waitlist and we’ll add you if a spot opens.'
  return `Only ${roomLeft} ${roomLeft === 1 ? 'seat is' : 'seats are'} left, not enough for ${wanted}. Join the waitlist and we’ll add you if ${wanted === 1 ? 'a spot opens' : 'spots open'}.`
}

/** Panel confirmation, after joining. */
export function joinedLine(position: number, last4: string, className: string): string {
  return `You’re number ${position} on the waitlist for ${className}. We’ll add you and charge your card ending ${last4} if a spot opens.`
}
