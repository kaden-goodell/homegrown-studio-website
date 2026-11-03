import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
}))

import { GET } from '@pages/api/staff/warnings.json'

const ctx = () => ({ request: new Request('http://localhost/api/staff/warnings.json') }) as any
// today is Tue Oct 6 (studio time)
const W = { code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-06T23:00:00.000Z', title: 'Pumpkin Pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.', action: 'Sort it out in Square.' }

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 'k', name: 'Kaden', role: 'owner' }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00.000Z')) // 10 AM CDT
  mockListWarnings.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/staff/warnings.json (crew panel, crew review I5)', () => {
  it('rejects a caller without the staff cookie', async () => {
    authed = null
    expect((await GET(ctx())).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('scans today and tomorrow only, never the staffing records', async () => {
    const res = await GET(ctx())
    expect(res.status).toBe(200)
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-10-07' }, { staffing: false })
    expect((await res.json()).data).toEqual({ from: '2026-10-06', to: '2026-10-07', warnings: [] })
  })

  it('a crew line says what the crew do — never "in Square" or "/admin"', async () => {
    mockListWarnings.mockResolvedValue([W])
    const { data } = await (await GET(ctx())).json()
    expect(data.warnings).toEqual([{ code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: W.when, title: 'Pumpkin Pails', line: 'Tue Oct 6 · Pumpkin Pails: 27 seats sold, 25 capacity. Catherine or Kaden will sort this out.' }])
  })

  it('door lines: a reader sale waiting and an unpaid door seat, with what to do', async () => {
    mockListWarnings.mockResolvedValue([
      { ...W, code: 'reader-waiting', detail: 'A reader sale of Pumpkin Pails never came back from the Square app.', action: 'An owner decides on /admin.' },
      { ...W, code: 'door-unpaid', detail: 'Kim Ng · Pumpkin Pails · Tue Oct 6 · not paid at the counter yet', action: 'An owner decides on /admin.' },
    ])
    const lines = (await (await GET(ctx())).json()).data.warnings.map((w: any) => w.line)
    expect(lines[0]).toBe('Tue Oct 6 · A reader sale of Pumpkin Pails never came back from the Square app. Open the class and tap Check again. Catherine or Kaden will sort out the rest.')
    expect(lines[1]).toBe('Kim Ng · Pumpkin Pails · Tue Oct 6 · not paid at the counter yet. If they’re here, take it at the register. Catherine or Kaden will sort out the rest.')
    for (const l of lines) expect(l).not.toMatch(/\/admin|in Square\./)
  })

  it('owner work never reaches the crew: staffing, promo, register setup, refund flags, weeks-away lines', async () => {
    const owner = ['unstaffed', 'assigned-cant', 'promo-free-unlimited', 'register-setup-missing', 'refund-flag', 'pos-unmatched', 'below-minimum', 'capacity-unknown']
      .map((code) => ({ ...W, code, detail: `x ${code}` }))
    const later = { ...W, when: '2026-10-18T18:00:00.000Z' }
    mockListWarnings.mockResolvedValue([W, ...owner, later])
    for (const role of ['crew', 'owner'] as const) {
      authed = { id: 'k', name: 'Kaden', role }
      const { data } = await (await GET(ctx())).json()
      expect(data.warnings.map((w: any) => w.code)).toEqual(['oversold'])
    }
  })

  it('answers 503 when the scan cannot run, never an empty list', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    const res = await GET(ctx())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Couldn’t check the schedule for conflicts. Refresh to try again.')
  })
})
