/**
 * What people read about the waitlist (stage 4): the consent next to the
 * tick, the panel's sentences and the refusals. Pure and browser-safe, so the
 * booking panel shows exactly the text the server stores with the entry.
 *
 * DRAFT copy for Kaden (tasks-9-10-report.md, COPY FOR KADEN).
 */
import { formatMoney } from '@lib/money'
import { policyWindows } from '@config/policy-content'

/**
 * Bumped whenever the consent sentence changes; stored with each entry. 2: the class and its date are named (I2).
 * 3: "even if the price goes up later" (D6). Entries joined under an older version keep their stored text and are
 * honoured as they are (the runner never reads the version).
 */
export const CONSENT_VERSION = 'wl-consent-3'

export const MAX_WAITING_PER_CLASS = 40

const TZ = 'America/Chicago'

/** "Sat, Oct 24 at 8 AM", "Sat, Oct 24 at 8:30 AM" (studio time). */
export function closesLabel(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(':00', '')
  return `${day} at ${time}`
}

/**
 * The sentence next to the unticked consent box. The panel shows it and the
 * server stores it, built from the same values (I2: the server refuses a join
 * whose amount or close time differs from what was shown).
 *   className  the class's name
 *   startIso   the first date they're waiting for; `more` when it has more than one
 *   closesIso  when the waitlist for these dates closes
 *   maxCents   the most they're ever charged
 */
export function consentText(input: { className: string; startIso: string; more?: boolean; closesIso: string; maxCents: number }): string {
  const when = `${input.more ? 'starts ' : ''}${closesLabel(input.startIso)}`
  return `Save my card with Square. If a spot opens in ${input.className} (${when}) before the waitlist closes on ${closesLabel(input.closesIso)} (so I’m never charged inside the ${policyWindows.workshopRefundHours}-hour no-refund window), Hometown Studio adds me and charges this card up to ${formatMoney(input.maxCents)}, even if the price goes up later, without asking again. I’ll get a text and an email right away. I can leave the waitlist any time and my card comes off.`
}

/** M-a: consent words compared without caring about spacing (browser and server may space "8 AM" differently). */
export const sameWords = (a: string, b: string) => norm(a) === norm(b)
const norm = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, ' ').trim()
/** The words carry the amount and the close time, however they're spaced. */
export const wordsCarry = (text: string, part: string) => norm(text).includes(norm(part))

export const WAITLIST_MESSAGES = {
  closed: 'The waitlist for this class has closed.',
  spotOpen: 'A spot just opened. Book it now.',
  duplicate: 'You’re already on the waitlist for this class. Your email has the link to leave it.',
  full: 'The waitlist for this class is full. Call or text us and we’ll see what we can do.',
  consent: 'Tick the box to let us save your card and charge it if a spot opens.',
  notOpen: 'This class isn’t taking a waitlist. Nothing was charged.',
  unavailable: 'We couldn’t add you to the waitlist just now. Nothing was charged. Try again in a minute.',
  notFound: 'We couldn’t find that waitlist spot. It may have been removed already.',
  /** M3/C1: a spot opened and a charge is being made or checked (it may stay unclear for a while). */
  charging: 'A spot opened and we tried to add you. We’re checking with Square whether your card was charged, and we’ll email you as soon as we know.',
  /** C1: they asked to leave while that charge is being checked. */
  leaveAsked: 'We’re checking with Square whether your card was charged. If it wasn’t, nothing will be: you come off the waitlist and your card comes off. If it was, you’re in the class. We’ll email you either way.',
} as const

/** I2: the price or close time changed since the panel showed the consent (or the page is too old to say); nothing was saved. */
export function consentChangedMessage(input: { why: 'price' | 'closes' | 'other'; maxCents: number; closesIso: string }): string {
  if (input.why === 'price') return `The price changed to ${formatMoney(input.maxCents)}. Check it and tick the box again. Nothing was charged.`
  if (input.why === 'closes') return `The waitlist now closes ${closesLabel(input.closesIso)}. Check it and tick the box again. Nothing was charged.`
  return 'The details changed. Check them and tick the box again. Nothing was charged.'
}

/** Panel: why the waitlist step is showing. */
export function waitlistReason(roomLeft: number, wanted: number): string {
  if (roomLeft <= 0) return 'This class is full. Join the waitlist and we’ll add you if a spot opens.'
  return `Only ${roomLeft} ${roomLeft === 1 ? 'seat is' : 'seats are'} left, not enough for ${wanted}. Join the waitlist and we’ll add you if ${wanted === 1 ? 'a spot opens' : 'spots open'}.`
}

/** Panel confirmation, after joining. */
export function joinedLine(position: number, last4: string, className: string): string {
  return `You’re number ${position} on the waitlist for ${className}. We’ll add you and charge your card ending ${last4} if a spot opens.`
}
