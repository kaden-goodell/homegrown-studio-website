import { describe, it, expect } from 'vitest'
import { buildAgreementCopy, buildDropOffDetails } from '@lib/agreement-email'
import { waiverContent } from '@config/waiver-content'
import type { WaiverRecord } from '@lib/waiver-store'
import type { StudioEvent } from '@lib/events'

function makeRecord(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: 'wvr_test_abc123',
    agreementVersion: 'v3',
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
  it('has the base subject, every legal section (including 4b), the minor and the record id', () => {
    const record = makeRecord()
    const { subject, html, text } = buildAgreementCopy({ record })

    expect(subject).toBe('Your Hometown Studio participation agreement')
    for (const section of waiverContent.legalSections) {
      expect(html).toContain(section.heading)
    }
    expect(html).toContain('4b. Drop-off programs')
    expect(html).toContain('Bobby')
    expect(html).toContain(record.id)
    expect(html).not.toMatch(/addendum/i)
    expect(text).toContain(record.id)
    expect(text).toContain('The only exception is a designated Studio drop-off program')
  })
})

describe('buildDropOffDetails', () => {
  it('names the event, when, the pickup-code rule with the masked phone, the late fee, no medication, and 4b', () => {
    const record = makeRecord({ authorizedPickup: [{ name: 'Grandma Sue', phone: '' }] })
    const event = makeEvent()
    const { subject, html, text } = buildDropOffDetails({ record, event })

    expect(subject).toBe(`Drop-off details for ${event.title}`)
    for (const body of [html.replace(/&#39;/g, "'"), text]) {
      expect(body).toContain('Check your child in with our crew at the door.')
      expect(body).toContain('phone ending ••34')
      expect(body).toContain('Whoever collects Bobby needs that code, and photo ID if we don')
      expect(body).toContain('Grandma Sue')
      expect(body).toContain('Late pickup: $1 per minute after a 15-minute grace.')
      expect(body).toContain('give medication')
      expect(body).toContain('Section 4b of the participation agreement you signed on September 1, 2026')
    }
  })

  it('omits the authorized-pickup line when none was given, and only names attending kids', () => {
    const record = makeRecord({
      minors: [
        { name: 'Bobby Test', dob: '2018-05-01', allergies: '', medications: '' },
        { name: 'Cara Test', dob: '2019-05-01', allergies: '', medications: '' },
      ],
    })
    const { text } = buildDropOffDetails({ record, event: makeEvent(), attending: ['adult', 'child:1'] })
    expect(text).not.toMatch(/Authorized pickup/)
    expect(text).toContain('Whoever collects Cara needs')
    expect(text).not.toContain('Bobby')
  })
})
