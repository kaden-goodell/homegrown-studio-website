import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
  warningLine: (w: any) => `Sun Oct 18 · ${w.detail} ${w.action}`,
  WARNING_WINDOW_DAYS: 60,
}))
const mockSendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }))

const mockLoadSession = vi.fn()
const mockCheckSession = vi.fn()
vi.mock('@lib/square-dashboard', () => ({
  loadSessionRecord: (...a: any[]) => mockLoadSession(...a),
  checkSession: (...a: any[]) => mockCheckSession(...a),
}))
vi.mock('@config/providers', () => ({ providers: { workshop: { listAllWorkshops: async () => [{ scheduleId: 'clssch_pails' }] } } }))

import { POST, dailyWarningsJobKey, squareSignInLine } from '@pages/api/jobs/daily-warnings.json'

const SECRET = 'a-secret-only-the-site-holds'
const ctx = (key: string | null) =>
  ({ request: new Request('http://localhost/api/jobs/daily-warnings.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {} }) }) as any
const W = { code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.', action: 'Sort it out in Square.' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.LOOKUP_SIGNING_SECRET = SECRET
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
  mockListWarnings.mockResolvedValue([])
  mockSendEmail.mockResolvedValue({ sent: true })
  mockLoadSession.mockResolvedValue({ cookie: 'x', savedAt: '2026-09-26T00:00:00.000Z' })
  mockCheckSession.mockResolvedValue({ state: 'connected' })
})
afterEach(() => {
  delete process.env.LOOKUP_SIGNING_SECRET
  vi.useRealTimers()
})

describe('POST /api/jobs/daily-warnings.json', () => {
  it('refuses a caller without the job key', async () => {
    expect((await POST(ctx(null))).status).toBe(401)
    expect((await POST(ctx('wrong'))).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('emails no one when nothing needs attention', async () => {
    const res = await POST(ctx(dailyWarningsJobKey(SECRET)))
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-12-04' })
    expect((await res.json()).data).toEqual({ count: 0, sent: false })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('emails both owners one line per warning', async () => {
    mockListWarnings.mockResolvedValue([W, { ...W, eventId: 'b' }])
    const res = await POST(ctx(dailyWarningsJobKey(SECRET)))
    expect((await res.json()).data).toEqual({ count: 2, sent: true })
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.to).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(mail.subject).toBe('⚠ Studio schedule needs attention (2)')
    expect(mail.text).toContain('Sun Oct 18 · Pumpkin Pails: 27 seats sold, 25 capacity. Sort it out in Square.')
    expect(mail.text).toContain('https://ourhometownstudio.com/staff')
    expect(mail.html).toContain('Pumpkin Pails: 27 seats sold, 25 capacity.')
  })

  it('answers 503 and tells the owners when the scan cannot run, so silence never reads as all clear', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    expect((await POST(ctx(dailyWarningsJobKey(SECRET)))).status).toBe(503)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.to).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(mail.subject).toBe('⚠ Couldn’t check the studio schedule today')
    expect(mail.text).toMatch(/open .*\/staff and tap Try again/i)
  })

  it('still answers 503 when the failure email cannot be sent', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    mockSendEmail.mockRejectedValue(new Error('gmail down'))
    expect((await POST(ctx(dailyWarningsJobKey(SECRET)))).status).toBe(503)
  })

  it('emails the owners when the Square sign-in has expired, even with no other warnings', async () => {
    mockCheckSession.mockResolvedValue({ state: 'expired', status: 401 })
    const res = await POST(ctx(dailyWarningsJobKey(SECRET)))
    expect((await res.json()).data).toEqual({ count: 1, sent: true })
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.subject).toMatch(/Square sign-in/)
    expect(mail.text).toMatch(/expired \(saved 2026-09-26, lasted about 10 days\)/)
    expect(mail.text).toMatch(/save-square-session/)
  })
})

describe('squareSignInLine', () => {
  it('is quiet when connected or when Square merely hiccups', async () => {
    expect(await squareSignInLine()).toBeNull()
    mockCheckSession.mockResolvedValue({ state: 'error', detail: 'timeout' })
    expect(await squareSignInLine()).toBeNull()
  })
  it('says so when no sign-in is saved', async () => {
    mockLoadSession.mockResolvedValue(null)
    expect(await squareSignInLine()).toMatch(/no Square sign-in saved/)
  })
})
