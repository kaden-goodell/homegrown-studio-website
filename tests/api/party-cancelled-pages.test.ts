// @vitest-environment node
/**
 * A cancelled party (stage 2 Task 13): the guest's RSVP page and invite
 * calendar file say "This party was cancelled." and take no RSVP; a booked
 * party's calendar file keeps one id across moves and ends with its extra
 * time. Real party and waiver stores (temp dir); no Square, no email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@lib/rate-limit', () => ({ rateLimited: () => false }))
vi.mock('@lib/email', () => ({
  sendAgreementCopyEmail: vi.fn(async () => ({ sent: true })),
  sendDropOffDetailsEmail: vi.fn(async () => ({ sent: true })),
}))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
    customer: {
      findOrCreate: vi.fn(async () => ({ id: 'cust-1', email: 'ada@example.com', givenName: 'Ada', familyName: 'Lovelace' })),
      appendNote: vi.fn(async () => undefined),
    },
  },
}))

import { createPartyRecord, type PartyRecord } from '@lib/party-store'
import { waiverEventOutcome } from '@lib/waiver-event'
import { flowPropsFor } from '@lib/waiver-page'
import { listWaiversByEvent } from '@lib/waiver-store'
import { POST as sign } from '@pages/api/waiver/sign.json'
import { GET as ics } from '@pages/api/party/invite.ics'
import { GET as roster } from '@pages/api/party/roster.json'

const NOW = new Date('2026-11-02T15:00:00.000Z')
let n = 0
async function party(over: Partial<PartyRecord> = {}): Promise<PartyRecord> {
  const id = `pty_cxl${String(++n).padStart(13, '0')}`
  const rec: PartyRecord = {
    bookingId: id, hostToken: 'host-key', craftName: 'Suncatchers', startIso: '2026-11-14T20:00:00.000Z', durationMinutes: 90,
    hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '2565550100', guestCount: 10, title: null, dropOff: false,
    createdAt: NOW.toISOString(), source: 'ours', status: 'booked', endIso: '2026-11-14T22:00:00.000Z', payToken: 'pay-key', calendarSeq: 3,
    items: [], charges: [], refunds: [], ...over,
  }
  await createPartyRecord(rec)
  return rec
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('a cancelled party', () => {
  it('the RSVP page says so and shows no form', async () => {
    const p = await party({ status: 'cancelled' })
    const outcome = await waiverEventOutcome('party', p.bookingId)
    expect(outcome).toEqual({ kind: 'cancelled', notice: 'This party was cancelled.' })
    expect(flowPropsFor('party', outcome)).toMatchObject({ showForm: false, notice: 'This party was cancelled.', partyId: undefined })
  })

  it('an RSVP sent anyway is refused and nothing is filed', async () => {
    const p = await party({ status: 'cancelled' })
    const body = {
      adult: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '2565551234', ageConfirmed: true },
      minors: [], emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', adultAllergies: '',
      photoConsent: true, agreeRelease: true, signature: 'Ada Lovelace', partyId: p.bookingId, workshopId: null, attending: ['adult'], responsibleAdult: '',
    }
    const request = new Request('http://localhost/api/waiver/sign.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const res = await sign({ request, url: new URL(request.url), params: {}, locals: {}, clientAddress: '127.0.0.1', redirect: () => new Response() } as any)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('This party was cancelled.')
    expect(await listWaiversByEvent('party', p.bookingId)).toEqual([])
  })

  it('the guest calendar file is refused with the same words', async () => {
    const p = await party({ status: 'cancelled' })
    const res = await ics({ url: new URL(`http://localhost/api/party/invite.ics?party=${p.bookingId}`), clientAddress: '1.1.1.1' } as any)
    expect(res.status).toBe(410)
    expect(await res.text()).toBe('This party was cancelled.')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('calendar files are never cached (Task 14 follow-up)', () => {
  it('the guest .ics and the host page’s calendar data say no-store, so a moved party’s new time reaches everyone at once', async () => {
    const p = await party()
    const res = await ics({ url: new URL(`http://localhost/api/party/invite.ics?party=${p.bookingId}`), clientAddress: '1.1.1.3' } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const missing = await ics({ url: new URL('http://localhost/api/party/invite.ics?party=pty_nope000000000000'), clientAddress: '1.1.1.4' } as any)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBe('no-store')
    const host = await roster({ url: new URL(`http://localhost/api/party/roster.json?party=${p.bookingId}&key=host-key`) } as any)
    expect(host.status).toBe(200)
    expect(host.headers.get('Cache-Control')).toBe('no-store')
    expect((await host.json()).data.party).toMatchObject({ startIso: p.startIso, calendarSeq: 3 })
  })
})

describe('a booked party’s guest calendar file', () => {
  it('ends with the extra time, keeps one id (booking id + sequence) and names no host or payment', async () => {
    const p = await party()
    const res = await ics({ url: new URL(`http://localhost/api/party/invite.ics?party=${p.bookingId}`), clientAddress: '1.1.1.2' } as any)
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain(`UID:party-${p.bookingId}@ourhometownstudio.com`)
    expect(text).toContain('SEQUENCE:3')
    expect(text).toContain('DTEND:20261114T220000Z')
    expect(text).not.toMatch(/Stefanie|stef@example|2565550100|pay-key|host-key/)
  })

  it('the RSVP page takes RSVPs as before', async () => {
    const p = await party()
    expect((await waiverEventOutcome('party', p.bookingId)).kind).toBe('ok')
  })
})
