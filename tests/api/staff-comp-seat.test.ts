import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'sam', name: 'Sam', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

const mockList = vi.fn()
vi.mock('@config/providers', () => ({ providers: { workshop: { listAllWorkshops: (...a: any[]) => mockList(...a) } } }))

const mockMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockMeta(...a) }))

const mockSave = vi.fn()
vi.mock('@lib/seat-choices', () => ({ saveSeatChoices: (...a: any[]) => mockSave(...a) }))

const mockSend = vi.fn()
vi.mock('@lib/workshop-confirmation', () => ({ sendWorkshopConfirmation: (...a: any[]) => mockSend(...a) }))

let bypass = false
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => bypass }))

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Lavender', 'Black'] }
const WORKSHOP = { id: 'inst_1', scheduleId: 'clssch_pails', name: 'Pumpkin Pails', startAt: '2026-10-18T18:00:00.000Z', durationMinutes: 90 }

function req(body: unknown) {
  return { request: new Request('http://localhost/api/staff/comp-seat.json', { method: 'POST', body: JSON.stringify(body) }) } as any
}
const good = {
  scheduleId: 'clssch_pails', givenName: 'Gia', familyName: 'Winner', email: 'gia@x.com', seats: 2,
  picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }],
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  authed = { id: 'sam', name: 'Sam', role: 'crew' }
  bypass = false
  mockMeta.mockResolvedValue({ options: [PAILS] })
  mockList.mockResolvedValue([WORKSHOP])
  mockSend.mockResolvedValue(true)
  POST = (await import('@pages/api/staff/comp-seat.json')).POST
})

describe('POST /api/staff/comp-seat.json', () => {
  it('401s without staff auth', async () => {
    authed = null
    expect((await POST(req(good))).status).toBe(401)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('400s naming the pick problem when the class has options and picks are missing', async () => {
    const res = await POST(req({ ...good, picks: [] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/asks a question for each seat/)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('400s on a bad email or seat count', async () => {
    expect((await POST(req({ ...good, email: 'nope' }))).status).toBe(400)
    expect((await POST(req({ ...good, seats: 11 }))).status).toBe(400)
  })

  it('404s an unknown class', async () => {
    mockList.mockResolvedValue([])
    const res = await POST(req(good))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Class not found')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('records a comped seat and sends the confirmation once', async () => {
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.bookingId).toMatch(/^comp_/)
    expect(data.emailSent).toBe(true)
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.calls[0][0]).toMatchObject({
      eventKind: 'workshop', eventId: 'clssch_pails', orderId: null, comped: true, by: { id: 'sam', name: 'Sam' }, seats: 2,
      customer: { givenName: 'Gia', familyName: 'Winner', email: 'gia@x.com', phone: '' },
    })
    const saved = mockSave.mock.calls[0][0]
    expect(saved.picks).toEqual(good.picks)
    expect(saved.bookingId).toBe(data.bookingId)
    expect(saved.attemptId).toBe(saved.bookingId)
    expect(saved.simulated).toBeUndefined()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toMatchObject({ comped: true, totalChargedCents: 0, receiptUrl: null, email: 'gia@x.com', origin: 'http://localhost' })
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'seat.comped',
      by: expect.objectContaining({ id: 'sam', name: 'Sam', role: expect.any(String) }),
      target: expect.objectContaining({ kind: 'workshop', id: 'clssch_pails' }),
      details: expect.objectContaining({ seats: 2, email: 'gia@x.com' }),
    }))
  })

  it('an email that returns false or throws still answers 200 with emailSent false', async () => {
    mockSend.mockResolvedValueOnce(false)
    expect((await (await POST(req(good))).json()).data.emailSent).toBe(false)
    mockSend.mockRejectedValueOnce(new Error('smtp down'))
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    expect((await res.json()).data.emailSent).toBe(false)
  })

  it('marks the record and the audit simulated under payment bypass', async () => {
    bypass = true
    expect((await POST(req(good))).status).toBe(200)
    expect(mockSave.mock.calls[0][0].simulated).toBe(true)
    expect(mockAudit.mock.calls[0][0].simulated).toBe(true)
  })

  it('answers 503 and records nothing when the class settings can’t be read', async () => {
    mockMeta.mockRejectedValue(new Error('store down'))
    const res = await POST(req(good))
    expect(res.status).toBe(503)
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
