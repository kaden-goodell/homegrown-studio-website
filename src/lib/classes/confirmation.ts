/**
 * The customer's confirmation for one of our own classes. Same email as a
 * Square workshop seat (sendWorkshopConfirmationEmail), with the seats said
 * as "2 Adults, 1 Kid" and, for a class that meets more than once, every date.
 */
import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { inviteContent } from '@config/invite-content'
import { sendWorkshopConfirmationEmail } from '@lib/email'
import { buildIcs, googleCalendarUrl } from '@lib/party-share'
import { formatDayAndSpan, formatSlotLabel, formatTimeSpan } from '@lib/studio-time'
import { summarize } from '@lib/seo'
import { withUtm } from '@lib/utm'
import { makeKvStore } from '@lib/blob-store'
import type { ScheduledClass } from './types'

const sentKv = makeKvStore('class-confirmations', 'class-confirmations')

/**
 * One confirmation per booking: true for the first caller only (a create-only
 * write), so two finishes of the same booking (a retry racing the first try,
 * or Square's webhook confirming a booking whose answer was lost) never send
 * it twice. A failed read or write counts as claimed by us: better a rare
 * second email than none.
 */
export async function claimConfirmation(bookingId: string): Promise<boolean> {
  const k = `sent-${bookingId.replace(/[^A-Za-z0-9_-]/g, '_')}`
  try {
    const { value, etag } = await sentKv.getWithMeta(k)
    if (value) return false
    return await sentKv.setIfMatch(k, JSON.stringify({ at: new Date().toISOString() }), etag, value !== null)
  } catch {
    return true
  }
}

const retryKey = (bookingId: string) => `retry-${bookingId.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** N2: the confirmation sent from Square's payment notice failed: the nightly catch-up tries it once more. */
export async function markConfirmationRetry(bookingId: string): Promise<void> {
  await sentKv.set(retryKey(bookingId), JSON.stringify({ at: new Date().toISOString() })).catch(() => undefined)
}

/** Takes the one retry waiting for this booking: true for the first caller only, never again after. */
export async function takeConfirmationRetry(bookingId: string): Promise<boolean> {
  try {
    const { value, etag } = await sentKv.getWithMeta(retryKey(bookingId))
    if (!value) return false
    return await sentKv.setIfMatch(retryKey(bookingId), '', etag, true)
  } catch {
    return false
  }
}

/** The confirmation didn't go out: let a later finish try again. */
export async function releaseConfirmation(bookingId: string): Promise<void> {
  await sentKv.set(`sent-${bookingId.replace(/[^A-Za-z0-9_-]/g, '_')}`, '').catch(() => undefined)
}

export async function sendClassConfirmation(input: {
  origin: string
  bookingId: string
  cls: ScheduledClass
  /** the sessions this booking covers */
  sessionIds: string[]
  seats: number
  /** "2 Adults, 1 Kid" */
  seatsLabel: string
  email: string
  givenName: string
  receiptUrl: string | null
  totalChargedCents: number
  /** "Seat 1 · Pumpkin color Lavender", one per answer */
  pickLines?: string[]
  alsoTo?: string
  /** a free seat from /staff: says "comped", not an amount paid */
  comped?: boolean
  /** a door seat paid at the counter: what is still to pay there */
  dueAtStudioCents?: number
}): Promise<boolean> {
  const { cls, origin } = input
  const sessions = cls.sessions
    .filter((s) => input.sessionIds.includes(s.id))
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
  const first = sessions[0]
  if (!first) throw new Error('That booking has no sessions to confirm.')

  // The waiver page reads `workshop` as the event id; ours are cls_ ids, which never collide with Square's.
  const waiverUrl = withUtm(
    `${origin}/waiver?workshop=${encodeURIComponent(cls.id)}&booking=${encodeURIComponent(input.bookingId)}`,
    { source: 'email', medium: 'email', campaign: 'class_confirmation' },
  )
  const classUrl = withUtm(`${origin}/classes/${encodeURIComponent(cls.id)}`, { source: 'friend', medium: 'referral', campaign: 'class_share' })
  const calendarEvent = {
    title: `${cls.content.name} at Hometown Studio`,
    startIso: first.startIso,
    endIso: first.endIso,
    details: `Your class at Hometown Studio.\n\nSign the participation agreement before you come: ${waiverUrl}`,
    location: inviteContent.where,
  }

  const { sent } = await sendWorkshopConfirmationEmail({
    to: input.email,
    alsoTo: input.alsoTo,
    bookingId: input.bookingId,
    firstName: input.givenName,
    workshopName: cls.content.name,
    summary: summarize(cls.content.description, 280),
    ...(cls.content.imageUrl ? { imageUrl: cls.content.imageUrl } : {}),
    whenLabel: formatSlotLabel(first.startIso),
    timeRange: formatTimeSpan(first.startIso, first.endIso),
    seats: input.seats,
    seatsLabel: input.seatsLabel,
    totalChargedCents: input.totalChargedCents,
    ...(input.comped ? { comped: true } : {}),
    ...(input.dueAtStudioCents !== undefined ? { dueAtStudioCents: input.dueAtStudioCents } : {}),
    receiptUrl: input.receiptUrl,
    waiverUrl,
    workshopUrl: classUrl,
    directionsUrl: `https://maps.google.com/?q=${encodeURIComponent('Hometown Studio, 525 Hughes Rd, Suite F, Madison, AL 35758')}`,
    // A free or not-yet-paid seat has nothing to refund; ask them to free it up instead.
    policyLine: input.comped || input.dueAtStudioCents !== undefined
      ? 'Can’t make it? Text or email us so we can pass your seat to someone else'
      : checkoutPolicySummary.workshop,
    policyUrl: `${origin}${POLICY_PATH}#${POLICY_ANCHORS.workshops}`,
    googleCalendarUrl: googleCalendarUrl(calendarEvent),
    // Every session goes in the calendar file; Google's link can only hold one, so it stays the first.
    icsContent: buildIcs(sessions.map((s) => ({ ...calendarEvent, startIso: s.startIso, endIso: s.endIso })), { uidPrefix: 'class' }),
    bookingRef: input.bookingId,
    ...(sessions.length > 1 ? { sessionLines: sessions.map((s) => formatDayAndSpan(s.startIso, s.endIso)) } : {}),
    ...(input.pickLines?.length ? { pickLines: input.pickLines } : {}),
  })
  return sent
}
