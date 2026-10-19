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
import type { ScheduledClass } from './types'

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
    receiptUrl: input.receiptUrl,
    waiverUrl,
    workshopUrl: classUrl,
    directionsUrl: `https://maps.google.com/?q=${encodeURIComponent('Hometown Studio, 525 Hughes Rd, Suite F, Madison, AL 35758')}`,
    policyLine: checkoutPolicySummary.workshop,
    policyUrl: `${origin}${POLICY_PATH}#${POLICY_ANCHORS.workshops}`,
    googleCalendarUrl: googleCalendarUrl(calendarEvent),
    // Every session goes in the calendar file; Google's link can only hold one, so it stays the first.
    icsContent: buildIcs(sessions.map((s) => ({ ...calendarEvent, startIso: s.startIso, endIso: s.endIso }))),
    bookingRef: input.bookingId,
    ...(sessions.length > 1 ? { sessionLines: sessions.map((s) => formatDayAndSpan(s.startIso, s.endIso)) } : {}),
    ...(input.pickLines?.length ? { pickLines: input.pickLines } : {}),
  })
  return sent
}
