import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
  warningLine: (w: any) => `LINE ${w.detail}`,
  WARNING_WINDOW_DAYS: 60,
}))

import { GET } from '@pages/api/staff/warnings.json'

const ctx = () => ({ request: new Request('http://localhost/api/staff/warnings.json') }) as any
const W = { code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.', action: 'Sort it out in Square.' }

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 'k', name: 'Kaden', role: 'owner' }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00.000Z')) // 10 AM CDT
  mockListWarnings.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/staff/warnings.json', () => {
  it('rejects a caller without the staff cookie', async () => {
    authed = null
    expect((await GET(ctx())).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('scans today and the next 59 studio days', async () => {
    const res = await GET(ctx())
    expect(res.status).toBe(200)
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-12-04' })
    expect((await res.json()).data).toEqual({ from: '2026-10-06', to: '2026-12-04', warnings: [] })
  })

  it('sends each warning with its ready-made line', async () => {
    mockListWarnings.mockResolvedValue([W])
    const { data } = await (await GET(ctx())).json()
    expect(data.warnings).toEqual([{ ...W, line: 'LINE Pumpkin Pails: 27 seats sold, 25 capacity.' }])
  })

  it('answers 503 when the scan cannot run, never an empty list', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    const res = await GET(ctx())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Couldn’t check the schedule for conflicts. Refresh to try again.')
  })
})
