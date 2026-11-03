/**
 * Share + add-to-calendar helpers for the party booking confirmation.
 * Pure string builders — no DOM, no clock — so they're trivially testable.
 */

export interface CalendarEventInput {
  title: string
  startIso: string
  endIso: string
  details: string
  location: string
}

/** "20260711T163000Z" from an ISO timestamp. */
function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function googleCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${compactUtc(ev.startIso)}/${compactUtc(ev.endIso)}`,
    details: ev.details,
    location: ev.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Escape per RFC 5545 TEXT rules: backslash, comma, semicolon, newline. */
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n')
}

/**
 * One calendar file; a list (a class that meets on several days) gets one
 * VEVENT per entry. `uid` (one event only): a UID that stays the same for
 * the booking, with `sequence` counting its changes, so importing a newer
 * file replaces the event instead of adding a second one. Without it the
 * UID comes from the start (`uidPrefix`-start). `stamp`: when the file was
 * made (DTSTAMP and LAST-MODIFIED); defaults to the start so the file is
 * the same every time.
 */
export function buildIcs(
  input: CalendarEventInput | CalendarEventInput[],
  opts: { uidPrefix?: string; uid?: string; sequence?: number; stamp?: string } = {},
): string {
  const prefix = opts.uidPrefix ?? 'party'
  const events = Array.isArray(input) ? input : [input]
  const one = events.length === 1 && opts.uid
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hometown Studio//Party Booking//EN',
    'METHOD:PUBLISH',
    ...events.flatMap((ev) => [
      'BEGIN:VEVENT',
      // Deterministic UID so the same booking never duplicates in a calendar.
      one ? `UID:${opts.uid}@ourhometownstudio.com` : `UID:${prefix}-${compactUtc(ev.startIso)}@ourhometownstudio.com`,
      ...(one ? [`SEQUENCE:${Math.max(0, Math.floor(opts.sequence ?? 0))}`] : []),
      `DTSTAMP:${compactUtc(opts.stamp ?? ev.startIso)}`,
      ...(opts.stamp ? [`LAST-MODIFIED:${compactUtc(opts.stamp)}`] : []),
      `DTSTART:${compactUtc(ev.startIso)}`,
      `DTEND:${compactUtc(ev.endIso)}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      `DESCRIPTION:${icsEscape(ev.details)}`,
      `LOCATION:${icsEscape(ev.location)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n')
}

/**
 * The calendar ids every party calendar file uses (the confirmation email,
 * the host page, the guest invite): UID from the booking id, so it never
 * changes with the time, and SEQUENCE from the party's `calendarSeq`, bumped
 * on every move, edit and extra-time change. A file added again after a move
 * replaces the old event in Apple Calendar and Outlook instead of adding a
 * second one.
 */
export function partyCalendarIds(bookingId: string, calendarSeq: number | undefined, now: Date = new Date()): { uid: string; sequence: number; stamp: string } {
  return { uid: `party-${bookingId}`, sequence: calendarSeq ?? 0, stamp: now.toISOString() }
}

export function icsDataUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`
}

/** Deep link to /book with a craft preselected — used by card share buttons. */
export function craftShareUrl(craftId: string, origin: string): string {
  return `${origin}/book?craft=${encodeURIComponent(craftId)}`
}

/** Invite text the host shares with her guests after booking. */
export function partyInviteText(input: { craftName: string; slotLabel: string }): string {
  return `You're invited! We're making ${input.craftName} at Hometown Studio — ${input.slotLabel}. 🎨`
}

/**
 * Guest waiver link for a booked party. Each guest household signs their own
 * participation agreement here before the event — a host can't sign for other
 * people's kids. `bookingId` scopes the signature to this party.
 */
export function partyWaiverUrl(bookingId: string, origin: string): string {
  return `${origin}/waiver?party=${encodeURIComponent(bookingId)}`
}

/**
 * Shareable invitation link. Guests land on a friendly invite page whose RSVP
 * button is the household waiver — party details ride in the query string so
 * no backend lookup is needed. `title` is the host-chosen party name
 * (e.g. "Ari's 7th Birthday") and only warms the headline when present.
 */
export function partyInviteUrl(
  input: { bookingId: string; craftName: string; slotLabel: string; startIso: string; title?: string },
  origin: string
): string {
  const params = new URLSearchParams({
    party: input.bookingId,
    craft: input.craftName,
    when: input.slotLabel,
    start: input.startIso,
  })
  if (input.title) params.set('title', input.title)
  // Hosts send this to their guests: a guest who books later came from a party.
  params.set('utm_source', 'party_invite')
  params.set('utm_medium', 'referral')
  params.set('utm_campaign', 'party_invite')
  return `${origin}/invite?${params.toString()}`
}

/** end = start + durationMinutes, as an ISO string. For invite calendar links. */
export function addMinutesIso(startIso: string, minutes: number): string {
  return new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString()
}

/** Guest-facing downloadable calendar file for a party (served by the API). */
export function partyInviteIcsUrl(bookingId: string, origin: string): string {
  return `${origin}/api/party/invite.ics?party=${encodeURIComponent(bookingId)}`
}

/**
 * mailto: link that opens the host's mail app with a ready-to-send invitation
 * — subject and body pre-filled, guests land on the invite/RSVP page. The host
 * just adds addresses and hits send. Plain text only (mailto bodies can't
 * carry HTML or attachments — the calendar ride-along is a hosted .ics link),
 * structured to mirror the invitation page's details.
 */
export function partyInviteMailto(input: {
  craftName: string
  slotLabel: string
  inviteUrl: string
  title?: string
  /** Venue line; defaults to the studio address. */
  where?: string
  /** Hosted .ics link (mailto can't attach files) — added as a body line. */
  icsUrl?: string
}): string {
  const subject = input.title ? `You’re invited — ${input.title}!` : 'You’re invited to a craft party!'
  const body = [
    'Hi!',
    '',
    input.title
      ? `You’re invited to ${input.title} at Hometown Studio!`
      : 'You’re invited to a private craft party at Hometown Studio!',
    '',
    `We’re making ${input.craftName}`,
    input.slotLabel,
    `At ${input.where ?? 'Hometown Studio · 525 Hughes Rd Ste F, Madison, AL'}`,
    '',
    'See the details and RSVP here',
    input.inviteUrl,
    ...(input.icsUrl ? ['', `Add it to your calendar ${input.icsUrl}`] : []),
    '',
    'Hope you can make it!',
  ].join('\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** sessionStorage key: the craft picked earlier in this visit, so opening
 *  another date keeps it (written by PartyModal, read by PartyLanding). */
export const PICKED_CRAFT_KEY = 'hs_party_craft'
