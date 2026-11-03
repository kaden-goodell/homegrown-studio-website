import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { previewEmail, previewText, messagesMuted, recordMuted, listMuted, MUTED_KEEP } from '@lib/preview-outbound'

const mockSendMail = vi.fn(async (_: any) => ({}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (m: any) => mockSendMail(m) }) } }))

const KEYS = ['STORE_NAMESPACE', 'SQUARE_ENVIRONMENT', 'CONTEXT', 'PREVIEW_MESSAGES', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'QUO_API_KEY', 'QUO_FROM_NUMBER'] as const
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'pw'
  process.env.QUO_API_KEY = 'quo-key'
  process.env.QUO_FROM_NUMBER = '+12564641710'
  mockSendMail.mockClear()
})
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('preview outbound: redirect (PREVIEW_MESSAGES=on)', () => {
  it('leaves live messages alone', () => {
    const m = { to: 'jane@x.com', subject: 'You’re booked', html: '', text: '' }
    expect(previewEmail(m, {})).toBe(m)
    expect(previewText({ to: '+12565550123', content: 'Hi' }, {})).toEqual({ to: '+12565550123', content: 'Hi' })
  })
  it('sends a preview’s email and texts to Kaden, saying who they were for', () => {
    expect(previewEmail({ to: 'jane@x.com', subject: 'You’re booked' }, { STORE_NAMESPACE: 'preview' }))
      .toEqual({ to: 'kaden.goodell@gmail.com', subject: '[preview → jane@x.com] You’re booked' })
    expect(previewText({ to: '+12565550123', content: 'Hi' }, { STORE_NAMESPACE: 'preview' }))
      .toEqual({ to: '+14029802907', content: '[preview → +12565550123] Hi' })
  })
})

describe('messagesMuted', () => {
  it('only on the sandbox preview: a namespace, Square sandbox (or unset), not production, not turned on', () => {
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', SQUARE_ENVIRONMENT: 'sandbox' })).toBe(true)
    expect(messagesMuted({ STORE_NAMESPACE: 'preview' })).toBe(true)
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', SQUARE_ENVIRONMENT: 'sandbox', CONTEXT: 'branch-deploy' })).toBe(true)
  })
  it('never in production or with live Square', () => {
    expect(messagesMuted({})).toBe(false)
    expect(messagesMuted({ SQUARE_ENVIRONMENT: 'production', CONTEXT: 'production' })).toBe(false)
    expect(messagesMuted({ SQUARE_ENVIRONMENT: 'sandbox' })).toBe(false)
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', SQUARE_ENVIRONMENT: 'production' })).toBe(false)
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', SQUARE_ENVIRONMENT: 'sandbox', CONTEXT: 'production' })).toBe(false)
    expect(messagesMuted({ STORE_NAMESPACE: '  ', SQUARE_ENVIRONMENT: 'sandbox' })).toBe(false)
  })
  it('PREVIEW_MESSAGES=on sends again (to Kaden only)', () => {
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', PREVIEW_MESSAGES: 'on' })).toBe(false)
    expect(messagesMuted({ STORE_NAMESPACE: 'preview', PREVIEW_MESSAGES: 'off' })).toBe(true)
  })
})

describe('the muted list', () => {
  it('keeps the newest, capped, with to / subject / first line / when', async () => {
    const before = (await listMuted()).length
    const e = await recordMuted({ kind: 'email', to: 'jane@x.com', subject: 'You’re booked', body: '\n  Hi Jane,\nmore' }, new Date('2026-11-02T20:00:00Z'))
    expect(e).toMatchObject({ kind: 'email', to: 'jane@x.com', subject: 'You’re booked', firstLine: 'Hi Jane,', at: '2026-11-02T20:00:00.000Z' })
    const list = await listMuted()
    expect(list[0].id).toBe(e.id)
    expect(list.length).toBe(Math.min(before + 1, MUTED_KEEP))
    for (let i = 0; i < MUTED_KEEP + 3; i++) await recordMuted({ kind: 'text', to: '+12565550123', body: `n${i}` })
    const capped = await listMuted()
    expect(capped).toHaveLength(MUTED_KEEP)
    expect(capped[0].firstLine).toBe(`n${MUTED_KEEP + 2}`)
  })

  it('N5: never keeps more than the first line, and a web address in it becomes [link]', async () => {
    const body = 'Pay here: https://ourhometownstudio.com/party/pay/pty_1?k=secret-key-123 thanks\nhttps://ourhometownstudio.com/admin/recover?t=TOKENTOKEN'
    const e = await recordMuted({ kind: 'text', to: '+12565550123', body })
    expect(e.firstLine).toBe('Pay here: [link] thanks')
    const stored = JSON.stringify(await listMuted())
    expect(stored).not.toContain('secret-key-123')
    expect(stored).not.toContain('TOKENTOKEN')
  })
})

describe('the senders', () => {
  it('sandbox preview: an email is not sent, is listed, and the caller hears it went', async () => {
    process.env.STORE_NAMESPACE = 'preview'
    process.env.SQUARE_ENVIRONMENT = 'sandbox'
    const { sendEmail } = await import('@lib/email')
    const r = await sendEmail({ to: 'cust@x.com', subject: 'Booked', html: '<p>Hi</p>', text: 'Hi there' })
    expect(r).toEqual({ sent: true })
    expect(mockSendMail).not.toHaveBeenCalled()
    expect((await listMuted())[0]).toMatchObject({ kind: 'email', to: 'cust@x.com', subject: 'Booked', firstLine: 'Hi there' })
  })

  it('sandbox preview: a text is not sent and is listed', async () => {
    process.env.STORE_NAMESPACE = 'preview'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { sendQuoText } = await import('@lib/quo')
    await sendQuoText({ to: '(256) 555-0123', content: 'Your class is today' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await listMuted())[0]).toMatchObject({ kind: 'text', to: '(256) 555-0123', firstLine: 'Your class is today' })
  })

  it('production: the real email goes to the real customer, unchanged, and nothing is listed', async () => {
    process.env.SQUARE_ENVIRONMENT = 'production'
    process.env.CONTEXT = 'production'
    const before = await listMuted()
    const { sendEmail } = await import('@lib/email')
    const r = await sendEmail({ to: 'cust@x.com', subject: 'Booked', html: '<p>Hi</p>', text: 'Hi there' })
    expect(r).toEqual({ sent: true })
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail.mock.calls[0][0]).toMatchObject({ to: 'cust@x.com', subject: 'Booked', html: '<p>Hi</p>', text: 'Hi there' })
    expect(await listMuted()).toEqual(before)
  })

  it('production: the real text goes to the real number, unchanged', async () => {
    process.env.SQUARE_ENVIRONMENT = 'production'
    process.env.CONTEXT = 'production'
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { sendQuoText } = await import('@lib/quo')
    await sendQuoText({ to: '(256) 555-0123', content: 'Your class is today' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.quo.com/v1/messages')
    expect(JSON.parse(String(init.body))).toEqual({ content: 'Your class is today', from: '+12564641710', to: ['+12565550123'] })
  })

  it('a preview with PREVIEW_MESSAGES=on sends, to Kaden only', async () => {
    process.env.STORE_NAMESPACE = 'preview'
    process.env.PREVIEW_MESSAGES = 'on'
    const { sendEmail } = await import('@lib/email')
    await sendEmail({ to: 'cust@x.com', subject: 'Booked', html: '', text: 'Hi' })
    expect(mockSendMail.mock.calls[0][0]).toMatchObject({ to: 'kaden.goodell@gmail.com', subject: '[preview → cust@x.com] Booked' })
  })
})
