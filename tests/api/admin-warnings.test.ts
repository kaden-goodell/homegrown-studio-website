// tests/api/admin-warnings.test.ts — Home › Warnings (final review C1): the owners' list, each line with its button.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed = true
vi.mock('@lib/admin-auth', () => ({ adminAuthorized: async () => authed }))

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
  warningLine: (w: any) => `LINE ${w.detail}`,
  WARNING_WINDOW_DAYS: 60,
  OWNER_ONLY_CODES: new Set(['unstaffed', 'assigned-cant', 'assigned-cancelled', 'staffing-unreadable', 'archive-stale', 'webhook-url-mismatch']),
}))
const mockSystem = vi.fn(async () => [] as any[])
vi.mock('@lib/system-checks', () => ({ systemWarnings: () => mockSystem() }))

import { GET, HOME_SKIP_CODES, openFor } from '@pages/api/admin/warnings.json'

const ctx = () => ({ request: new Request('http://localhost/api/admin/warnings.json') }) as any
const base = { eventKind: 'workshop', eventId: 'cls_abc', when: '2026-10-18T18:00:00.000Z', title: 'Pails', detail: 'd', action: 'a' }

beforeEach(() => {
  vi.clearAllMocks()
  authed = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00.000Z'))
  mockListWarnings.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/admin/warnings.json', () => {
  it('owners only', async () => {
    authed = false
    expect((await GET(ctx())).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('scans the same 60 days as /staff and the morning email, without the staffing scan', async () => {
    await GET(ctx())
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-12-04' }, { staffing: false })
  })

  it('leaves out To decide items and staffing lines (Home shows them another way)', async () => {
    mockListWarnings.mockResolvedValue([
      { ...base, code: 'register-setup-missing', eventId: '', detail: 'No tax' },
      { ...base, code: 'refund-flag', detail: 'refund' },
      { ...base, code: 'unstaffed', detail: 'nobody' },
      { ...base, code: 'oversold', detail: 'over' },
    ])
    const { data } = await (await GET(ctx())).json()
    expect(data.warnings.map((w: any) => w.code)).toEqual(['register-setup-missing', 'oversold'])
    expect(data.warnings[0]).toEqual({ code: 'register-setup-missing', line: 'LINE No tax', open: { kind: 'more', page: 'register' }, button: 'Open Register setup' })
    expect(HOME_SKIP_CODES.has('cancel-request')).toBe(true)
  })

  it('shows the owner-only system lines (records backup with its Records button; Square notices with no button)', async () => {
    mockSystem.mockResolvedValueOnce([
      { ...base, code: 'archive-stale', eventId: '', detail: 'backup' },
      { ...base, code: 'webhook-url-mismatch', eventId: '', detail: 'notices' },
    ])
    const { data } = await (await GET(ctx())).json()
    expect(data.warnings.map((w: any) => [w.code, w.button])).toEqual([['archive-stale', 'Open Records'], ['webhook-url-mismatch', null]])
    expect(data.warnings[0].open).toEqual({ kind: 'more', page: 'records' })
    expect(HOME_SKIP_CODES.has('archive-stale')).toBe(false)
    expect(HOME_SKIP_CODES.has('unstaffed')).toBe(true)
  })

  it('a failed scan is a 503, never an empty list', async () => {
    mockListWarnings.mockRejectedValue(new Error('down'))
    const res = await GET(ctx())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/Couldn’t check/)
  })
})

describe('each line’s button', () => {
  it('our class → Open the class; a Square class → its day; a party → Open the party on its studio day', () => {
    expect(openFor({ ...base, code: 'class-over-class' } as any)).toEqual({ open: { kind: 'class', id: 'cls_abc' }, button: 'Open the class' })
    expect(openFor({ ...base, code: 'oversold', eventId: 'sq_sched' } as any)).toEqual({ open: { kind: 'day', day: '2026-10-18' }, button: 'Open the day' })
    expect(openFor({ ...base, code: 'two-parties', eventKind: 'party', eventId: 'pty_1', when: '2026-10-19T02:30:00.000Z' } as any))
      .toEqual({ open: { kind: 'party', day: '2026-10-18', id: 'pty_1' }, button: 'Open the party' })
  })

  it('a free code with no limit opens that code; a scan that failed says Try again', () => {
    expect(openFor({ ...base, code: 'promo-free-unlimited', eventId: '', itemId: 'promo-free-FREEBIE' } as any)).toEqual({ open: { kind: 'promo', id: 'FREEBIE' }, button: 'Open the code' })
    expect(openFor({ ...base, code: 'classes-unreadable', eventId: '' } as any)).toEqual({ open: { kind: 'retry' }, button: 'Try again' })
  })
})
