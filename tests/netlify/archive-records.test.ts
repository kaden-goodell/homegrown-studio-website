/**
 * Control-flow tests for the weekly self-archive scheduled function
 * (HOM-217, fix round 1). Mocks `@netlify/blobs`, `nodemailer`, and
 * `node:fs/promises` — the real exporter/zip logic from
 * `src/lib/archive-export.ts` runs unmocked against the empty fake stores.
 *
 * The bug this covers: `sendMail` used to swallow every SMTP error and
 * report `sent: false`, so a real send failure never reached the "Archive
 * FAILED" path and the function returned a plain 200. Fixed: only "not
 * configured" returns `false` without throwing; a real send failure
 * propagates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockList = vi.fn(async () => ({ blobs: [] as { key: string }[] }))
const mockGet = vi.fn(async (_key: string) => null as string | null)
const mockSet = vi.fn(async (_key: string, _json: string) => ({ modified: true }))

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn(() => ({ list: mockList, get: mockGet, set: mockSet })),
}))

let sendMailImpl: (opts: any) => Promise<any> = vi.fn(async () => ({}))
const mockCreateTransport = vi.fn(() => ({ sendMail: (opts: any) => sendMailImpl(opts) }))

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}))

const mockWriteFile = vi.fn(async (_path: string, _data: unknown) => undefined)
vi.mock('node:fs/promises', () => ({ writeFile: mockWriteFile }))

const ORIGINAL_ENV = { ...process.env }

async function loadFn(): Promise<() => Promise<Response>> {
  vi.resetModules()
  const mod = await import('../../netlify/functions/archive-records')
  return mod.default as () => Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, GMAIL_USER: 'bot@example.com', GMAIL_APP_PASSWORD: 'app-pass', ARCHIVE_TO: 'kaden@example.com' }
  delete process.env.ARCHIVE_DRY_RUN
  mockList.mockResolvedValue({ blobs: [] })
  mockGet.mockResolvedValue(null)
  mockSet.mockResolvedValue({ modified: true })
  mockWriteFile.mockResolvedValue(undefined)
  sendMailImpl = vi.fn(async () => ({}))
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('netlify/functions/archive-records', () => {
  it('ARCHIVE_DRY_RUN=1 writes to /tmp and never touches the mailer', async () => {
    process.env.ARCHIVE_DRY_RUN = '1'
    const run = await loadFn()
    const res = await run()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dryRun).toBe(true)
    expect(mockWriteFile).toHaveBeenCalled()
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })

  it('success path emails the archive and reports sent:true', async () => {
    const run = await loadFn()
    const res = await run()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.sent).toBe(true)
    expect(sendMailImpl).toHaveBeenCalledTimes(1)
    expect((sendMailImpl as any).mock.calls[0][0].subject).toMatch(/^Hometown Studio records archive/)
  })

  it('a real send failure propagates and triggers the "Archive FAILED" email — never a silent sent:false 200', async () => {
    sendMailImpl = vi.fn(async (opts: any) => {
      if (String(opts.subject).startsWith('Archive FAILED')) return {} // the failure notification itself succeeds
      throw new Error('SMTP connection refused')
    })
    const run = await loadFn()
    const res = await run()

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('SMTP connection refused')
    // Main attempt, then the FAILED-notification attempt.
    expect(sendMailImpl).toHaveBeenCalledTimes(2)
    expect((sendMailImpl as any).mock.calls[1][0].subject).toBe('Archive FAILED — SMTP connection refused')
  })

  it('when the "Archive FAILED" email itself also fails, logs with the greppable prefix and still returns non-2xx', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMailImpl = vi.fn(async () => { throw new Error('SMTP down entirely') })
    const run = await loadFn()
    const res = await run()

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    // Main attempt, then the (also failing) FAILED-notification attempt.
    expect(sendMailImpl).toHaveBeenCalledTimes(2)
    expect(errorSpy.mock.calls.some(([msg]) => typeof msg === 'string' && msg.startsWith('[archive] SEND FAILED:'))).toBe(true)

    errorSpy.mockRestore()
  })

  it('not-configured (no GMAIL_* env) skips the send without throwing and is reported as sent:false, not a failure', async () => {
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    const run = await loadFn()
    const res = await run()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.sent).toBe(false)
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })
})
