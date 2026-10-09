import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { inviteContent } from '@config/invite-content'
import { formatRange } from '@config/hours'
import { partyConfig } from '@config/party.config'
import { sendWorkshopConfirmationEmail } from '@lib/email'
import { buildIcs, googleCalendarUrl, addMinutesIso } from '@lib/party-share'
import { formatSlotLabel } from '@lib/studio-time'
import { summarize } from '@lib/seo'
import { PICKS_FINAL_LINE, seatPickLines, type SeatOption, type SeatPick } from '@lib/seat-options'
import type { Workshop } from '@providers/interfaces/workshop'

const TZ = partyConfig.timezone

/** "19:00" in studio time, for the shared range formatter. */
function studioClock(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

export async function sendWorkshopConfirmation(input: {
  origin: string
  bookingId: string
  workshop: Workshop
  seats: number
  email: string
  givenName: string
  receiptUrl: string | null
  options: SeatOption[]
  picks: SeatPick[]
  totalChargedCents: number
  comped?: boolean
  /** Added at the door; paid at the register. */
  dueAtStudioCents?: number
}): Promise<boolean> {
  const { workshop } = input

  const { origin } = input
  const endIso = addMinutesIso(workshop.startAt, workshop.durationMinutes)
  // The waiver page reads `workshop` as the class schedule id and `booking` as
  // the seat booking — the same link the booking modal builds.
  const waiverUrl = `${origin}/waiver?workshop=${encodeURIComponent(workshop.scheduleId)}&booking=${encodeURIComponent(input.bookingId)}`
  const workshopUrl = `${origin}/workshops?w=${encodeURIComponent(workshop.id)}`
  const calendarEvent = {
    title: `${workshop.name} at Hometown Studio`,
    startIso: workshop.startAt,
    endIso,
    details: `Your workshop at Hometown Studio.\n\nSign the participation agreement before you come: ${waiverUrl}`,
    location: inviteContent.where,
  }

  const { sent } = await sendWorkshopConfirmationEmail({
    to: input.email,
    firstName: input.givenName,
    workshopName: workshop.name,
    summary: summarize(workshop.description, 280),
    imageUrl: workshop.imageUrl,
    whenLabel: formatSlotLabel(workshop.startAt),
    timeRange: formatRange(studioClock(workshop.startAt), studioClock(endIso)),
    seats: input.seats,
    totalChargedCents: input.totalChargedCents,
    ...(input.comped ? { comped: true } : {}),
    ...(input.dueAtStudioCents !== undefined ? { dueAtStudioCents: input.dueAtStudioCents } : {}),
    receiptUrl: input.receiptUrl,
    waiverUrl,
    workshopUrl,
    directionsUrl: `https://maps.google.com/?q=${encodeURIComponent('Hometown Studio, 525 Hughes Rd, Suite F, Madison, AL 35758')}`,
    // A free seat has nothing to refund; ask them to free it up instead.
    policyLine: input.comped || input.dueAtStudioCents !== undefined
      ? 'Can’t make it? Text or email us so we can pass your seat to someone else'
      : checkoutPolicySummary.workshop,
    policyUrl: `${origin}${POLICY_PATH}#${POLICY_ANCHORS.workshops}`,
    googleCalendarUrl: googleCalendarUrl(calendarEvent),
    icsContent: buildIcs(calendarEvent),
    bookingRef: input.bookingId,
    ...(input.picks.length > 0
      ? { pickLines: seatPickLines(input.options, input.picks), picksFinalLine: PICKS_FINAL_LINE }
      : {}),
  })
  return sent
}
