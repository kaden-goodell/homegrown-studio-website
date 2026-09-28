import { describe, it, expect } from 'vitest'
import { buildAgreementCopy } from '@lib/agreement-email'
import { waiverContent, dropOffAddendum } from '@config/waiver-content'
import type { WaiverRecord } from '@lib/waiver-store'
import type { StudioEvent } from '@lib/events'

function makeRecord(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: 'wvr_test_abc123',
    agreementVersion: 'v2',
    agreementSha256: 'deadbeef',
    signedAt: '2026-09-01T18:00:00.000Z',
    validUntil: '2027-09-01T18:00:00.000Z',
    adult: {
      firstName: 'Alice',
      lastName: 'Test',
      email: 'alice@test.com',
      phone: '2565551234',
      dob: '1990-01-01',
      allergies: '',
    },
    minors: [
      { name: 'Bobby Test', dob: '2018-05-01', allergies: '', medications: '' },
    ],
    emergency: { name: 'Bob Test', phone: '2565555678', relationship: 'Spouse' },
    authorizedPickup: [],
    notAuthorized: '',
    photoConsent: true,
    signature: 'Alice Test',
    squareCustomerId: null,
    ip: null,
    userAgent: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<StudioEvent> = {}): StudioEvent {
  return {
    kind: 'party',
    id: 'party-123',
    title: 'Bobby’s Drop-off Camp',
    startIso: '2099-01-01T14:00:00.000Z',
    days: ['2099-01-01'],
    dropOff: true,
    ...overrides,
  }
}

describe('buildAgreementCopy', () => {
  it('(a) fresh sign, no addendum — subject is the base agreement subject, html has every legal section heading + minor first name + record id, no addendum content', () => {
    const record = makeRecord()
    const { subject, html, text } = buildAgreementCopy({ record })

    expect(subject).toBe('Your Hometown Studio participation agreement')
    for (const section of waiverContent.legalSections) {
      expect(html).toContain(section.heading)
    }
    expect(html).toContain('Bobby')
    expect(html).toContain(record.id)
    expect(html).not.toContain(dropOffAddendum.title)
    expect(text).toContain(record.id)
  })

  it('(b) fresh sign + addendum — subject includes "+ Drop-off Addendum", html has base sections AND addendum sections + record id', () => {
    const record = makeRecord()
    const event = makeEvent()
    const { subject, html, text } = buildAgreementCopy({
      record,
      addendum: { version: dropOffAddendum.version, acceptedAt: record.signedAt },
      event,
    })

    expect(subject).toBe('Your Hometown Studio participation agreement + Drop-off Addendum')
    for (const section of waiverContent.legalSections) {
      expect(html).toContain(section.heading)
    }
    for (const section of dropOffAddendum.sections) {
      expect(html).toContain(section.heading)
    }
    expect(html).toContain(event.title)
    expect(html).toContain(record.id)
    expect(text).toContain(record.id)
  })

  it('(c) returning + addendum accepted — subject is the addendum-only subject, html has ONLY addendum sections + the "unchanged" line + record id', () => {
    const record = makeRecord()
    const event = makeEvent()
    const acceptedAt = '2026-09-28T12:00:00.000Z'
    const { subject, html, text } = buildAgreementCopy({
      record,
      addendum: { version: dropOffAddendum.version, acceptedAt },
      event,
      returning: true,
    })

    expect(subject).toBe(`Your Drop-off Addendum for ${event.title}`)
    for (const section of dropOffAddendum.sections) {
      expect(html).toContain(section.heading)
    }
    // The base agreement text is NOT re-rendered on the returning path.
    for (const section of waiverContent.legalSections) {
      expect(html).not.toContain(section.heading)
    }
    expect(html).toMatch(/unchanged/i)
    expect(html).toContain(record.id)
    expect(text).toContain(record.id)
    expect(text).toMatch(/unchanged/i)
  })

  it('never renders an addendum block when none is passed', () => {
    const record = makeRecord()
    const { html } = buildAgreementCopy({ record })
    expect(html).not.toContain(dropOffAddendum.title)
    for (const section of dropOffAddendum.sections) {
      expect(html).not.toContain(section.heading)
    }
  })
})
