import { describe, it, expect } from 'vitest'
import {
  googleCalendarUrl,
  buildIcs,
  icsDataUrl,
  craftShareUrl,
  partyInviteText,
  partyInviteMailto,
} from '@lib/party-share'

const EVENT = {
  title: 'Junk Journaling Party — Homegrown Studio',
  startIso: '2026-07-11T16:30:00.000Z',
  endIso: '2026-07-11T18:00:00.000Z',
  details: 'Private party at Homegrown Studio. homegrowncraftstudio.com',
  location: 'Homegrown Studio',
}

describe('googleCalendarUrl', () => {
  it('builds a render?action=TEMPLATE link with compact UTC dates', () => {
    const url = googleCalendarUrl(EVENT)
    expect(url).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE')
    expect(url).toContain('dates=20260711T163000Z%2F20260711T180000Z')
    expect(url).toContain('text=Junk+Journaling+Party+%E2%80%94+Homegrown+Studio')
    expect(url).toContain('location=Homegrown+Studio')
  })
})

describe('buildIcs', () => {
  it('emits a valid VCALENDAR with escaped text', () => {
    const ics = buildIcs({ ...EVENT, details: 'Line one\nWith, comma; semicolon' })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('DTSTART:20260711T163000Z')
    expect(ics).toContain('DTEND:20260711T180000Z')
    expect(ics).toContain('SUMMARY:Junk Journaling Party — Homegrown Studio')
    expect(ics).toContain('Line one\\nWith\\, comma\\; semicolon')
    expect(ics).toContain('END:VCALENDAR')
  })

  it('is deterministic for the same event (stable UID)', () => {
    expect(buildIcs(EVENT)).toBe(buildIcs(EVENT))
  })
})

describe('icsDataUrl', () => {
  it('wraps the ics in a text/calendar data url', () => {
    const url = icsDataUrl('BEGIN:VCALENDAR')
    expect(url).toBe('data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR')
  })
})

describe('craftShareUrl', () => {
  it('deep-links a craft on /book', () => {
    expect(craftShareUrl('ABC123', 'https://homegrowncraftstudio.com')).toBe(
      'https://homegrowncraftstudio.com/book?craft=ABC123'
    )
  })
  it('encodes ids', () => {
    expect(craftShareUrl('A B', 'https://x.com')).toBe('https://x.com/book?craft=A%20B')
  })
})

describe('partyInviteText', () => {
  it('mentions the craft, studio, and date', () => {
    const text = partyInviteText({ craftName: 'Junk Journaling', slotLabel: 'Sat, Jul 11 · 11:30 AM' })
    expect(text).toContain('Junk Journaling')
    expect(text).toContain('Homegrown Studio')
    expect(text).toContain('Sat, Jul 11 · 11:30 AM')
  })
})

describe('partyInviteMailto', () => {
  it('builds a mailto with pre-filled subject and body containing the invite link', () => {
    const url = partyInviteMailto({
      craftName: 'Junk Journaling',
      slotLabel: 'Sat, Jul 18 · 2:00 PM CT',
      inviteUrl: 'https://example.com/invite?party=abc',
      title: 'Maya’s Birthday',
    })
    expect(url.startsWith('mailto:?subject=')).toBe(true)
    const params = new URLSearchParams(url.slice('mailto:?'.length))
    expect(params.get('subject')).toBe('You’re invited — Maya’s Birthday!')
    expect(params.get('body')).toContain('Junk Journaling')
    expect(params.get('body')).toContain('https://example.com/invite?party=abc')
  })

  it('falls back to a generic subject without a title', () => {
    const url = partyInviteMailto({ craftName: 'X', slotLabel: 'Y', inviteUrl: 'https://z' })
    const params = new URLSearchParams(url.slice('mailto:?'.length))
    expect(params.get('subject')).toBe('You’re invited to a craft party!')
  })
})
