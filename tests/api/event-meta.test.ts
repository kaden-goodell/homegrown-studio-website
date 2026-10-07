import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
const mockSetEventMeta = vi.fn()
vi.mock('@lib/events', () => ({ getEvent: (...a: any[]) => mockGetEvent(...a), EVENT_KIND_RE: /^(party|workshop)$/ }))
vi.mock('@lib/event-meta', () => ({ setEventMeta: (...a: any[]) => mockSetEventMeta(...a) }))

function postCtx(body: any) {
  const request = new Request('http://localhost/api/staff/event-meta.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

function getCtx(qs: string) {
  const url = new URL(`http://localhost/api/staff/event-meta.json?${qs}`)
  const request = new Request(url)
  return { request, url } as any
}

let POST: any
let GET: any

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 'k', name: 'Kaden', role: 'crew' }
  mockSetEventMeta.mockResolvedValue({ dropOff: true, days: null, updatedAt: '2026-09-28T00:00:00.000Z', by: { id: 'k', name: 'Kaden' }, history: [] })
  mockGetEvent.mockResolvedValue({ kind: 'workshop', id: 'cs1', title: 'Macramé', startIso: '2026-10-20T15:00:00.000Z', days: ['2026-10-20'], dropOff: true })
  const mod = await import('@pages/api/staff/event-meta.json')
  POST = mod.POST
  GET = mod.GET
})

describe('POST /api/staff/event-meta.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true }))
    expect(res.status).toBe(401)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('rejects a malformed days array', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days: ['not-a-date'] }))
    expect(res.status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('rejects more than 14 days', async () => {
    const days = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days }))
    expect(res.status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('accepts null days (revert to default) and a dropOff flip, stamping the signed-in staffer', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true, days: null }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { dropOff: true, days: null }, { id: 'k', name: 'Kaden' })
    const json = await res.json()
    expect(json.data).toMatchObject({ id: 'cs1', dropOff: true })
  })

  it('sorts and dedupes a valid days array before saving', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days: ['2026-10-21', '2026-10-20', '2026-10-20'] }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { days: ['2026-10-20', '2026-10-21'] }, { id: 'k', name: 'Kaden' })
  })

  it('404s when the event no longer resolves — without writing an orphan overlay (M7)', async () => {
    mockGetEvent.mockResolvedValue(null)
    const res = await POST(postCtx({ kind: 'workshop', id: 'missing', dropOff: true }))
    expect(res.status).toBe(404)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('503s on a storage throw (fails closed)', async () => {
    mockSetEventMeta.mockRejectedValue(new Error('boom'))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true }))
    expect(res.status).toBe(503)
  })

  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }

  it('rejects questions from a caller without the staff cookie', async () => {
    authed = null
    expect((await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [PAILS] }))).status).toBe(401)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('saves checked, trimmed questions', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [{ label: ' Pumpkin color ', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }] }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { options: [PAILS] }, { id: 'k', name: 'Kaden' })
  })

  it('refuses more than three questions, saying why', async () => {
    const options = [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, choices: ['A', 'B'] }))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('A class can ask up to 3 questions.')
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('refuses questions or a cutoff on a party', async () => {
    const res = await POST(postCtx({ kind: 'party', id: 'p1', options: [PAILS] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Seat questions and sign-up cutoffs apply to classes only.')
    expect((await POST(postCtx({ kind: 'party', id: 'p1', signupCutoffHours: 24 }))).status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
    expect(mockGetEvent).not.toHaveBeenCalled()
  })

  it('saves a cutoff in whole hours, or null for the default', async () => {
    await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours: 48 }))
    await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours: null }))
    expect(mockSetEventMeta.mock.calls.map((c) => c[2])).toEqual([{ signupCutoffHours: 48 }, { signupCutoffHours: null }])
  })

  it('refuses a cutoff that is not whole hours 0–336', async () => {
    for (const signupCutoffHours of [2.5, -1, 337, '24']) {
      expect((await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours }))).status).toBe(400)
    }
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('passes on the lock refusal once someone has picked', async () => {
    const { SeatSettingsError } = await import('@lib/seat-options')
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    mockSetEventMeta.mockRejectedValue(new SeatSettingsError(msg, 409))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [PAILS] }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(msg)
  })
})

describe('GET /api/staff/event-meta.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(getCtx('kind=workshop&id=cs1'))
    expect(res.status).toBe(401)
  })

  it('returns the current merged event without writing', async () => {
    const res = await GET(getCtx('kind=workshop&id=cs1'))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.data).toMatchObject({ id: 'cs1', dropOff: true })
  })
})
