// @vitest-environment node
/**
 * B1: the waiver link in every class confirmation email (/waiver?workshop=cls_…)
 * must find our own class, and a signature must file under ('workshop', cls_id)
 * so the roster, print day and check-in see it. Real class store, waiver store
 * and RSVP store (temp dir); no Square, no email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@lib/rate-limit', () => ({ rateLimited: () => false }))
vi.mock('@lib/email', () => ({
  sendAgreementCopyEmail: vi.fn(async () => ({ sent: true })),
  sendDropOffDetailsEmail: vi.fn(async () => ({ sent: true })),
}))
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { getWorkshop: vi.fn(async () => { throw new Error('Square must not be asked about our classes') }), listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
    customer: {
      findOrCreate: vi.fn(async () => ({ id: 'cust-1', email: 'ada@example.com', givenName: 'Ada', familyName: 'Lovelace' })),
      appendNote: vi.fn(async () => undefined),
    },
  },
}))

import { createClass } from '@lib/classes/class-store'
import { listWaiversByEvent } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
import { waiverEventOutcome } from '@lib/waiver-event'
import { flowPropsFor } from '@lib/waiver-page'
import { POST } from '@pages/api/waiver/sign.json'
import { defaultRules } from '@lib/classes/validate'

const NOW = new Date('2026-10-20T15:00:00.000Z')
const content = () => ({
  name: 'Clay Camp', description: 'Make pots.', imageUrl: null, instructor: null, rules: { ...defaultRules(), dropOff: false },
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' as const } }],
  prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120,
})
const sessions = [
  { id: 'ses_w1', startIso: '2026-10-24T15:00:00.000Z', endIso: '2026-10-24T17:00:00.000Z', capacity: 8 },
  { id: 'ses_w2', startIso: '2026-10-25T15:00:00.000Z', endIso: '2026-10-25T17:00:00.000Z', capacity: 8 },
]
const by = { id: 'admin', name: 'Owner' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('a cls_ waiver link (B1)', () => {
  it('renders as a link for that class: its name and first date, no warning', async () => {
    const cls = await createClass({ content: content(), sessions, status: 'open', by })
    const outcome = await waiverEventOutcome('workshop', cls.id)
    expect(outcome).toMatchObject({ kind: 'ok', id: cls.id, dropOff: false })
    expect(outcome.kind === 'ok' && outcome.label).toMatch(/^Clay Camp · Sat, Oct 24/)
    const flow = flowPropsFor('workshop', outcome)
    expect(flow).toMatchObject({ workshopId: cls.id, notice: null })
    expect(flow.eventTitle).toMatch(/^Clay Camp/)
  })

  it('a cancelled class says so: nothing to sign', async () => {
    const gone = await createClass({ content: content(), sessions, status: 'cancelled', by })
    const outcome = await waiverEventOutcome('workshop', gone.id)
    expect(outcome).toEqual({ kind: 'cancelled', notice: 'This class was cancelled. Nothing to sign.' })
    // only the notice: no agreement form under it
    expect(flowPropsFor('workshop', outcome)).toMatchObject({ workshopId: undefined, notice: 'This class was cancelled. Nothing to sign.', showForm: false })
    expect(flowPropsFor('workshop', { kind: 'unknown', notice: 'x' }).showForm).toBe(true)
  })

  it('a draft class or an unknown cls_ id is not recognized', async () => {
    const draft = await createClass({ content: content(), sessions, status: 'draft', by })
    expect((await waiverEventOutcome('workshop', draft.id)).kind).toBe('unknown')
    expect((await waiverEventOutcome('workshop', 'cls_zzzzzzzzzz')).kind).toBe('unknown')
  })

  it('a signature from that link files under (workshop, cls id) with the booking it came from', async () => {
    const cls = await createClass({ content: content(), sessions, status: 'open', by })
    const body = {
      adult: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '2565551234', ageConfirmed: true },
      minors: [{ name: 'Byron Lovelace', dob: '2016-05-01', allergies: '' }],
      emergency: { name: 'Bob', phone: '2565555678', relationship: 'Spouse' },
      authorizedPickup: [], notAuthorized: '', adultAllergies: '', photoConsent: true, agreeRelease: true,
      signature: 'Ada Lovelace', partyId: null, workshopId: cls.id, booking: 'bkg_abc123',
      attending: ['adult', 'child:0'], responsibleAdult: '',
    }
    const request = new Request('http://localhost/api/waiver/sign.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const res = await POST({ request, url: new URL(request.url), params: {}, locals: {}, clientAddress: '127.0.0.1', redirect: () => new Response() } as any)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.context).toEqual({ kind: 'workshop', id: cls.id })
    const filed = await listWaiversByEvent('workshop', cls.id)
    expect(filed.map((w) => w.adult.email)).toEqual(['ada@example.com'])
    const rsvp = await getRsvp('workshop', cls.id, filed[0].id)
    expect(rsvp).toMatchObject({ event: { kind: 'workshop', id: cls.id }, attending: ['adult', 'child:0'] })
  })
})
