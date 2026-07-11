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

export function buildIcs(ev: CalendarEventInput): string {
  // Deterministic UID so the same booking never duplicates in a calendar.
  const uid = `party-${compactUtc(ev.startIso)}@homegrowncraftstudio.com`
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Homegrown Studio//Party Booking//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${compactUtc(ev.startIso)}`,
    `DTSTART:${compactUtc(ev.startIso)}`,
    `DTEND:${compactUtc(ev.endIso)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.details)}`,
    `LOCATION:${icsEscape(ev.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
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
  return `You're invited! We're making ${input.craftName} at Homegrown Studio — ${input.slotLabel}. 🎨`
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
      ? `You’re invited to ${input.title} at Homegrown Studio!`
      : 'You’re invited to a private craft party at Homegrown Studio!',
    '',
    `🎨 We’re making: ${input.craftName}`,
    `🗓 When: ${input.slotLabel}`,
    `📍 Where: ${input.where ?? 'Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL'}`,
    '',
    'Details + a quick RSVP (takes about a minute):',
    input.inviteUrl,
    ...(input.icsUrl ? ['', `📅 Add it to your calendar: ${input.icsUrl}`] : []),
    '',
    'Hope you can make it!',
  ].join('\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
