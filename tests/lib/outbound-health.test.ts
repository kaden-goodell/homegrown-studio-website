// @vitest-environment node
// G2: emails, texts and Square calls report how they went; Home warns while one is failing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendMail, alerts, ownerMails } = vi.hoisted(() => ({ sendMail: vi.fn(), alerts: [] as string[], ownerMails: [] as any[] }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) }, createTransport: () => ({ sendMail }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))
// The other way to reach the owners: the text (owner-alert) and the owners' email row.
vi.mock('@lib/owner-alert', () => ({ alertOwners: vi.fn(async (t: string) => { alerts.push(t); return { attempted: 1, sent: 1 } }) }))
vi.mock('@lib/notify-settings', () => ({ emailsFor: vi.fn(async () => 'owners@example.com') }))

import { _resetHealthForTests, _resetHealthMemory, emailFailureKind, healthStatus, isFailing, noteFailure, noteOk } from '@lib/outbound-health'
import { sendEmail } from '@lib/email'
import { sendQuoText } from '@lib/quo'
import { squareFetch } from '@lib/classes/square-api'
import { createSquareClient } from '@providers/square/client'

const ALL_SET = { email: true, text: true, square: true }
const status = async () => healthStatus(ALL_SET)

beforeEach(async () => {
  site.context = 'dev'
  await _resetHealthForTests()
  sendMail.mockReset()
  sendMail.mockResolvedValue({})
  alerts.length = 0
  ownerMails.length = 0
  vi.stubEnv('GMAIL_USER', 'bot@example.com')
  vi.stubEnv('GMAIL_APP_PASSWORD', 'app-pass')
  vi.stubEnv('QUO_API_KEY', 'k')
  vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
  vi.stubEnv('STORE_NAMESPACE', '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('the record', () => {
  it('a refused key or password warns at once; anything else after two in a row; a success clears it', async () => {
    await noteFailure('text', 'other')
    expect((await status()).text.state).toBe('ok')
    await noteFailure('text', 'other')
    expect((await status()).text).toMatchObject({ state: 'failing', kind: 'other', count: 2, since: expect.any(String) })
    await noteFailure('square', 'auth')
    expect((await status()).square).toMatchObject({ state: 'failing', kind: 'auth', count: 1 })
    await noteOk('text')
    expect((await status()).text).toMatchObject({ state: 'ok', count: 0, since: null, lastOkAt: expect.any(String) })
    expect(isFailing(null)).toBe(false)
  })

  it('not set up on this site says so', async () => {
    expect((await healthStatus({ email: false, text: true, square: true })).email.state).toBe('not-set')
  })

  it('a success clears a failure another server recorded (memory refreshed)', async () => {
    await noteOk('email')
    await noteFailure('email', 'auth')
    _resetHealthMemory()
    await noteOk('email')
    expect((await status()).email.state).toBe('ok')
  })

  it('the moment one starts failing, the owners hear the other way, once per run', async () => {
    const mails: any[] = []
    sendMail.mockImplementation(async (m: any) => { mails.push(m); return {} })
    await noteFailure('email', 'auth')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatch(/^Hometown Studio: Emails from the website aren’t going out since .*More › Email, texts and Square/)
    await noteFailure('email', 'auth')
    expect(alerts).toHaveLength(1) // not again for the same run
    await noteFailure('text', 'auth')
    expect(mails.map((m) => [m.to, m.subject])).toEqual([['owners@example.com', '⚠ Texts from the website aren’t going out']])
    await noteOk('email')
    await noteFailure('email', 'auth') // a new run tells them again
    expect(alerts).toHaveLength(2)
  })

  it('R41: a test site sharing the live stores records nothing', async () => {
    site.context = 'deploy-preview'
    await noteFailure('square', 'auth')
    site.context = 'dev'
    expect((await status()).square.state).toBe('ok')
  })

  it('Gmail: a refused login is auth, anything else other', () => {
    expect(emailFailureKind(Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }))).toBe('auth')
    expect(emailFailureKind(new Error('connect ETIMEDOUT'))).toBe('other')
  })
})

describe('every send and call reports in', () => {
  it('email: a refused password warns; the next email that goes clears it', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }))
    expect(await sendEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ sent: false })
    expect((await status()).email).toMatchObject({ state: 'failing', kind: 'auth' })
    expect(await sendEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ sent: true })
    expect((await status()).email.state).toBe('ok')
  })

  it('texts: Quo refusing the key warns; one person’s bad number does not; a text that goes clears it', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendQuoText({ to: '2565550100', content: 'x' })).rejects.toThrow()
    await expect(sendQuoText({ to: '2565550100', content: 'x' })).rejects.toThrow()
    expect((await status()).text.state).toBe('ok')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(sendQuoText({ to: '2565550100', content: 'x' })).rejects.toThrow()
    expect((await status()).text).toMatchObject({ state: 'failing', kind: 'auth' })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 202 }))
    await sendQuoText({ to: '2565550100', content: 'x' })
    expect((await status()).text.state).toBe('ok')
  })

  it('Square (our own calls and the SDK): only a refused key (401/403) warns; any other answer clears it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'UNAUTHORIZED' }] }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(squareFetch('/locations')).rejects.toThrow()
    expect((await status()).square).toMatchObject({ state: 'failing', kind: 'auth' })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ code: 'NOT_FOUND' }] }), { status: 404 }))
    await expect(squareFetch('/locations/x')).rejects.toThrow()
    expect((await status()).square.state).toBe('ok')

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [{ category: 'AUTHENTICATION_ERROR', code: 'UNAUTHORIZED', detail: 'no' }] }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    const client = createSquareClient({ accessToken: 'bad', environment: 'sandbox', locationId: 'L1', applicationId: 'A' } as any)
    await expect(client.locations.list()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalled()
    expect((await status()).square).toMatchObject({ state: 'failing', kind: 'auth' })
  })
})
