/**
 * A read-only calendar feed (stage 3): an iCalendar file a phone subscribes
 * to. Pure: no imports with side effects, no clock (the caller passes `now`).
 *
 * RFC 5545 rules that matter for phones:
 * - lines end in CRLF and are folded at 75 octets (never inside a UTF-8 character);
 * - TEXT values escape backslash, semicolon, comma and newlines;
 * - times are written in UTC ("…Z"); all-day items use VALUE=DATE;
 * - UID is stable for an event however it moves, and SEQUENCE goes up when
 *   it does, so a calendar app moves the event instead of adding a second one;
 * - REFRESH-INTERVAL / X-PUBLISHED-TTL ask for a fresh copy hourly.
 */

export interface FeedEvent {
  uid: string
  sequence: number
  startIso: string
  endIso: string
  summary: string
  description: string
  status: 'CONFIRMED' | 'CANCELLED'
  url: string | null
  /** whole studio days ('YYYY-MM-DD', end exclusive) instead of times: a closed day */
  allDay?: { startYmd: string; endYmd: string }
}

const CRLF = '\r\n'
const encoder = new TextEncoder()

/** TEXT escaping (RFC 5545 3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds one content line at 75 octets; continuation lines start with a space. Never splits a character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = '', curBytes = 0, limit = 75
  for (const ch of line) {
    const b = encoder.encode(ch).length
    if (curBytes + b > limit) {
      out.push(cur)
      cur = ''
      curBytes = 0
      limit = 74 // the leading space takes one octet
    }
    cur += ch
    curBytes += b
  }
  out.push(cur)
  return out.join(`${CRLF} `)
}

/** 2026-10-25T18:00:00.000Z → 20261025T180000Z */
export function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

const icsDate = (ymd: string) => ymd.replace(/-/g, '')

export function buildFeed(events: FeedEvent[], opts: { name: string; now: Date; location?: string }): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hometown Studio//Staff calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    'X-WR-TIMEZONE:America/Chicago',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  const stamp = icsUtc(opts.now.toISOString())
  for (const ev of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeText(ev.uid)}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`SEQUENCE:${Math.max(0, Math.floor(ev.sequence))}`)
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.allDay.startYmd)}`)
      lines.push(`DTEND;VALUE=DATE:${icsDate(ev.allDay.endYmd)}`)
    } else {
      lines.push(`DTSTART:${icsUtc(ev.startIso)}`)
      lines.push(`DTEND:${icsUtc(ev.endIso)}`)
    }
    lines.push(`SUMMARY:${escapeText(ev.summary)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`)
    if (opts.location) lines.push(`LOCATION:${escapeText(opts.location)}`)
    lines.push(`STATUS:${ev.status}`)
    if (ev.status === 'CANCELLED') lines.push('TRANSP:TRANSPARENT')
    if (ev.url) lines.push(`URL:${ev.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join(CRLF) + CRLF
}
