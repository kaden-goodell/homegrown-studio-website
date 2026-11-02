import { describe, it, expect } from 'vitest'
import { buildFeed, escapeText, foldLine, icsUtc, type FeedEvent } from '@lib/staffing/ics-feed'
import { parseIcs } from './ics-parse'

const now = new Date('2026-11-01T15:00:00.000Z')
const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  uid: 'ses:ses_1@ourhometownstudio.com', sequence: 0, startIso: '2026-11-08T18:00:00.000Z', endIso: '2026-11-08T20:00:00.000Z',
  summary: 'Needlepoint 101', description: 'With Catherine.', status: 'CONFIRMED', url: null, ...over,
})
const bytes = (s: string) => new TextEncoder().encode(s).length

describe('ics-feed', () => {
  it('CRLF everywhere, calendar name, hourly refresh, UTC times', () => {
    const ics = buildFeed([ev()], { name: 'Hometown Studio · my shifts', now, location: 'Hometown Studio, 525 Hughes Rd, Suite F' })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    const { cal, events } = parseIcs(ics)
    expect(cal['X-WR-CALNAME']).toBe('Hometown Studio · my shifts')
    expect(cal['REFRESH-INTERVAL;VALUE=DURATION']).toBe('PT1H')
    expect(cal['X-PUBLISHED-TTL']).toBe('PT1H')
    expect(events[0]).toMatchObject({ UID: 'ses:ses_1@ourhometownstudio.com', DTSTAMP: '20261101T150000Z', DTSTART: '20261108T180000Z', DTEND: '20261108T200000Z', SEQUENCE: '0', STATUS: 'CONFIRMED', SUMMARY: 'Needlepoint 101', LOCATION: 'Hometown Studio, 525 Hughes Rd, Suite F' })
  })

  it('escapes backslash, semicolon, comma and newlines, and reads back the same', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe(String.raw`a\\b\;c\,d\ne`)
    const description = 'Kaden, Jessica; and \\ Sam\nsecond line'
    const { events } = parseIcs(buildFeed([ev({ description })], { name: 'x', now }))
    expect(events[0].DESCRIPTION).toBe(description)
  })

  it('folds at 75 octets and never splits a character (an emoji on the boundary)', () => {
    const summary = '⚠ ' + 'x'.repeat(62) + '🎨🎨 Needlepoint with a long name that goes on'
    const ics = buildFeed([ev({ summary })], { name: 'x', now })
    for (const line of ics.split('\r\n')) expect(bytes(line)).toBeLessThanOrEqual(75)
    expect(parseIcs(ics).events[0].SUMMARY).toBe(summary)
    // the fold itself, character by character
    const folded = foldLine('SUMMARY:' + 'é'.repeat(80))
    for (const part of folded.split('\r\n')) expect(bytes(part)).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'é'.repeat(80))
    expect(folded).not.toContain('�')
  })

  it('UID stays when the start changes; SEQUENCE carries the bump', () => {
    const a = parseIcs(buildFeed([ev()], { name: 'x', now })).events[0]
    const b = parseIcs(buildFeed([ev({ startIso: '2026-11-08T19:00:00.000Z', endIso: '2026-11-08T21:00:00.000Z', sequence: 1 })], { name: 'x', now })).events[0]
    expect(b.UID).toBe(a.UID)
    expect([a.SEQUENCE, b.SEQUENCE]).toEqual(['0', '1'])
    expect(b.DTSTART).toBe('20261108T190000Z')
  })

  it('a cancelled event says so; a closed day is all day', () => {
    const { events } = parseIcs(buildFeed([
      ev({ status: 'CANCELLED' }),
      ev({ uid: 'closed-2026-12-25@x', summary: 'Closed for Christmas', description: '', allDay: { startYmd: '2026-12-25', endYmd: '2026-12-26' } }),
    ], { name: 'x', now }))
    expect(events[0].STATUS).toBe('CANCELLED')
    expect(events[1]['DTSTART;VALUE=DATE']).toBe('20261225')
    expect(events[1]['DTEND;VALUE=DATE']).toBe('20261226')
    expect(events[1].DESCRIPTION).toBeUndefined()
  })

  it('icsUtc', () => {
    expect(icsUtc('2026-11-02T00:00:00.000Z')).toBe('20261102T000000Z')
  })
})
