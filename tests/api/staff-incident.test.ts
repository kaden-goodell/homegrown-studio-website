/**
 * Staff incident-report endpoints (HOM-215):
 *  - POST /api/staff/incident.json — validate, save, cross-log into the
 *    household's custody log when tied to a waiver, email both owners
 *    (non-fatal on failure).
 *  - GET /api/staff/incidents.json?kind=&id= — list an event's incidents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

const mockCreateIncident = vi.fn()
const mockListIncidentsByEvent = vi.fn()
vi.mock('@lib/incident-store', () => ({
  createIncident: (...a: any[]) => mockCreateIncident(...a),
  listIncidentsByEvent: (...a: any[]) => mockListIncidentsByEvent(...a),
}))

const mockMutateCheckin = vi.fn()
vi.mock('@lib/checkin-store', () => ({
  mutateCheckin: (...a: any[]) => mockMutateCheckin(...a),
}))

vi.mock('@lib/events', () => ({
  eventKey: (kind: string, id: string) => (kind === 'party' ? id : `${kind}:${id}`),
  EVENT_KIND_RE: /^(party|workshop)$/,
}))

const mockSendIncidentEmail = vi.fn()
vi.mock('@lib/email', () => ({
  sendIncidentEmail: (...a: any[]) => mockSendIncidentEmail(...a),
}))

vi.mock('@config/site.config', () => ({
  siteConfig: { ownerEmails: ['kaden@ourhometownstudio.com', 'catherine@ourhometownstudio.com'] },
}))

function postCtx(body: any) {
  const request = new Request('http://localhost/api/staff/incident.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

function getCtx(qs: string) {
  const url = new URL(`http://localhost/api/staff/incidents.json?${qs}`)
  const request = new Request(url)
  return { request, url } as any
}

const record = {
  id: 'inc_1',
  at: '2026-09-28T20:00:00.000Z',
  reportedAt: '2026-09-28T20:01:00.000Z',
  by: { id: 'k', name: 'Kaden' },
  event: { kind: 'party', id: 'p1', title: 'Pottery Party', day: '2026-09-28' },
  who: [{ waiverId: 'wvr_1', personId: 'child:0', name: 'Remy' }],
  what: 'Scraped knee on the concrete step.',
  firstAid: 'Cleaned and bandaged.',
  witnesses: '',
  parentNotified: { at: null, by: 'Kaden', how: 'not-yet' },
  followUp: '',
}

let POST: any
let GET: any

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 'k', name: 'Kaden', role: 'crew' }
  mockCreateIncident.mockResolvedValue(record)
  mockMutateCheckin.mockResolvedValue({})
  mockSendIncidentEmail.mockResolvedValue({ sent: true })
  mockListIncidentsByEvent.mockResolvedValue([record])
  const incidentMod = await import('@pages/api/staff/incident.json')
  const incidentsMod = await import('@pages/api/staff/incidents.json')
  POST = incidentMod.POST
  GET = incidentsMod.GET
})

describe('POST /api/staff/incident.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(postCtx({ what: 'Scraped knee on the concrete step.' }))
    expect(res.status).toBe(401)
    expect(mockCreateIncident).not.toHaveBeenCalled()
  })

  it('refuses "what" under 10 characters', async () => {
    const res = await POST(postCtx({ what: 'Fell down' }))
    expect(res.status).toBe(400)
    expect(mockCreateIncident).not.toHaveBeenCalled()
  })

  it('saves a valid report, appends an incident event per distinct waiverId, and emails both owners', async () => {
    mockAudit.mockClear()
    const res = await POST(postCtx({
      at: '2026-09-28T20:00:00.000Z',
      event: { kind: 'party', id: 'p1', title: 'Pottery Party', day: '2026-09-28' },
      who: [
        { waiverId: 'wvr_1', personId: 'child:0', name: 'Remy' },
        { waiverId: 'wvr_1', personId: 'adult', name: 'Jamie' },
        { name: 'A visiting grandparent' },
      ],
      what: 'Scraped knee on the concrete step.',
      firstAid: 'Cleaned and bandaged.',
      witnesses: '',
      parentNotified: { how: 'not-yet' },
      followUp: '',
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.incident).toEqual(record)
    expect(json.data.emailed).toBe(true)

    expect(mockCreateIncident).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'incident.filed', by: expect.objectContaining({ id: expect.any(String), role: expect.stringMatching(/^(owner|crew)$/) }), target: expect.objectContaining({ kind: 'incident', id: 'inc_1' }) }))

    // One waiverId → one mutateCheckin call, not one per person.
    expect(mockMutateCheckin).toHaveBeenCalledTimes(1)
    expect(mockMutateCheckin).toHaveBeenCalledWith('p1', 'wvr_1', expect.any(Function))
    const fn = mockMutateCheckin.mock.calls[0][2]
    const state = { events: [] as any[] }
    fn(state)
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ action: 'incident', incidentId: 'inc_1', by: { id: 'k', name: 'Kaden' } })

    expect(mockSendIncidentEmail).toHaveBeenCalledTimes(1)
    expect(mockSendIncidentEmail.mock.calls[0][0].to).toEqual(['kaden@ourhometownstudio.com', 'catherine@ourhometownstudio.com'])
  })

  it('does not touch the custody log when no event is set (open studio)', async () => {
    const res = await POST(postCtx({ event: null, who: [{ name: 'A walk-in kid' }], what: 'Scraped knee on the concrete step.' }))
    expect(res.status).toBe(200)
    expect(mockMutateCheckin).not.toHaveBeenCalled()
  })

  it('does not touch the custody log when who[] has no waiverId', async () => {
    const res = await POST(postCtx({
      event: { kind: 'party', id: 'p1', title: 'Pottery Party', day: '2026-09-28' },
      who: [{ name: 'A visiting grandparent' }],
      what: 'Scraped knee on the concrete step.',
    }))
    expect(res.status).toBe(200)
    expect(mockMutateCheckin).not.toHaveBeenCalled()
  })

  it('returns 200 with emailed:false when the email send throws', async () => {
    mockSendIncidentEmail.mockRejectedValue(new Error('smtp down'))
    const res = await POST(postCtx({ what: 'Scraped knee on the concrete step.' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.emailed).toBe(false)
    expect(json.data.incident).toEqual(record)
  })

  it('saves fine when the custody-log append throws (non-fatal)', async () => {
    mockMutateCheckin.mockRejectedValue(new Error('storage hiccup'))
    const res = await POST(postCtx({
      event: { kind: 'party', id: 'p1', title: 'Pottery Party', day: '2026-09-28' },
      who: [{ waiverId: 'wvr_1', personId: 'child:0', name: 'Remy' }],
      what: 'Scraped knee on the concrete step.',
    }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/staff/incidents.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(getCtx('kind=party&id=p1'))
    expect(res.status).toBe(401)
  })

  it('lists incidents for the given event', async () => {
    const res = await GET(getCtx('kind=party&id=p1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.incidents).toEqual([record])
    expect(mockListIncidentsByEvent).toHaveBeenCalledWith('party', 'p1')
  })

  it('400s on missing kind/id', async () => {
    const res = await GET(getCtx('kind=party'))
    expect(res.status).toBe(400)
  })
})
