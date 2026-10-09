import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'sam', name: 'Sam', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

const mockList = vi.fn()
const mockFindOrCreate = vi.fn()
const mockGuest = vi.fn()
vi.mock('@config/providers', () => ({ providers: {
  workshop: { listAllWorkshops: (...a: any[]) => mockList(...a) },
  customer: { findOrCreate: (...a: any[]) => mockFindOrCreate(...a), createGuest: (...a: any[]) => mockGuest(...a) },
} }))

const mockAdd = vi.fn()
vi.mock('@lib/square-dashboard', () => ({ addClassAttendee: (...a: any[]) => mockAdd(...a) }))

const mockMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockMeta(...a) }))

const mockSave = vi.fn()
vi.mock('@lib/seat-choices', () => ({ saveSeatChoices: (...a: any[]) => mockSave(...a) }))

const mockSend = vi.fn()
vi.mock('@lib/workshop-confirmation', () => ({ sendWorkshopConfirmation: (...a: any[]) => mockSend(...a) }))

let bypass = false
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => bypass }))

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Lavender', 'Black'] }
const WORKSHOP = { id: 'inst_1', scheduleId: 'clssch_pails', name: 'Pumpkin Pails', startAt: '2026-10-18T18:00:00.000Z', durationMinutes: 90, priceCents: 2500 }

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
  mockFindOrCreate.mockResolvedValue({ id: 'CUST_GIA' })
  mockGuest.mockResolvedValue({ id: 'CUST_GUEST' })
  let n = 0
  mockAdd.mockImplementation(async () => ({ ok: true, bookingId: `clsbk_${++n}` }))
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

  it('adds one no-charge Square seat per person seat, records it and sends the confirmation once', async () => {
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(mockFindOrCreate).toHaveBeenCalledWith({ email: 'gia@x.com', givenName: 'Gia', familyName: 'Winner' })
    expect(mockAdd).toHaveBeenCalledTimes(2)
    // Square lists one attendee per customer per class: seat 2 goes to a name-only guest.
    expect(mockAdd.mock.calls[0][0]).toEqual({ scheduleId: 'clssch_pails', startAt: WORKSHOP.startAt, customerId: 'CUST_GIA' })
    expect(mockAdd.mock.calls[1][0]).toEqual({ scheduleId: 'clssch_pails', startAt: WORKSHOP.startAt, customerId: 'CUST_GUEST' })
    expect(mockGuest).toHaveBeenCalledWith({ givenName: 'Gia', familyName: 'Winner (guest 2 of 2)', note: expect.stringContaining('gia@x.com') })
    expect(data.bookingId).toBe('clsbk_1')
    expect(data.seats).toBe(2)
    expect(mockSave.mock.calls[0][0].squareBookingIds).toEqual(['clsbk_1', 'clsbk_2'])
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
      details: expect.objectContaining({ seats: 2, email: 'gia@x.com', addedInSquare: 'by the site', squareBookingIds: 'clsbk_1,clsbk_2' }),
    }))
  })

  it('409s square_signed_out and records nothing when the Square sign-in has expired', async () => {
    mockAdd.mockResolvedValue({ ok: false, kind: 'signed_out', status: 401, detail: '' })
    const res = await POST(req(good))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('square_signed_out')
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('422s and records nothing when Square refuses the first seat', async () => {
    mockAdd.mockResolvedValue({ ok: false, kind: 'refused', status: 400, detail: 'class is at capacity' })
    const res = await POST(req(good))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/class looks full/)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('keeps and records the seats Square added when it stops partway, and says so', async () => {
    mockAdd.mockReset()
    mockAdd.mockResolvedValueOnce({ ok: true, bookingId: 'clsbk_a' }).mockResolvedValueOnce({ ok: false, kind: 'refused', status: 400, detail: 'full' })
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.seats).toBe(1)
    expect(data.warning).toMatch(/added 1 of 2 seats/)
    const saved = mockSave.mock.calls[0][0]
    expect(saved.seats).toBe(1)
    expect(saved.picks).toEqual([good.picks[0]])
    expect(mockSend.mock.calls[0][0]).toMatchObject({ seats: 1, picks: [good.picks[0]] })
    expect(mockAudit.mock.calls[0][0].details.squareRefusal).toMatch(/refused 400: full/)
  })

  it('keeps seat 1 when making the guest for seat 2 fails', async () => {
    mockGuest.mockRejectedValue(new Error('customers down'))
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ seats: 1, warning: expect.stringMatching(/added 1 of 2/) })
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.calls[0][0].seats).toBe(1)
  })

  it('with alreadyInSquare, only records and emails (the expired-sign-in fallback)', async () => {
    const res = await POST(req({ ...good, alreadyInSquare: true }))
    expect(res.status).toBe(200)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockFindOrCreate).not.toHaveBeenCalled()
    expect(mockSave.mock.calls[0][0].bookingId).toMatch(/^comp_/)
    expect(mockAudit.mock.calls[0][0].details.addedInSquare).toBe('by hand')
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
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('answers 503 and records nothing when the class settings can’t be read', async () => {
    mockMeta.mockRejectedValue(new Error('store down'))
    const res = await POST(req(good))
    expect(res.status).toBe(503)
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('Sell a seat: adds in Square, records pay-at-register (not comped), emails what is due', async () => {
    const res = await POST(req({ ...good, payAtRegister: true }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.dueCents).toBe(5000)
    expect(mockAdd).toHaveBeenCalledTimes(2)
    const saved = mockSave.mock.calls[0][0]
    expect(saved.payAtRegister).toBe(true)
    expect(saved.comped).toBeUndefined()
    expect(mockSend.mock.calls[0][0]).toMatchObject({ dueAtStudioCents: 5000 })
    expect(mockSend.mock.calls[0][0].comped).toBeUndefined()
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: 'seat.sold-at-door', details: expect.objectContaining({ dueCents: 5000 }) })
    expect(mockGuest.mock.calls[0][0].note).toMatch(/^Door seat 2 of 2/)
  })
})
