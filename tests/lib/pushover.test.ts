import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cancelPushoverReceipt, pushoverDeps, sendPushover } from '@lib/pushover'

const TOKEN = 'aTOKENtokenTOKENtokenTOKENtoken'
const USER = 'uUSERuserUSERuserUSERuserUSERus'
let calls: { url: string; body: URLSearchParams }[]
let reply: { ok: boolean; status: number; json: unknown }
const realFetch = pushoverDeps.fetch
const realBlocked = pushoverDeps.blocked

beforeEach(() => {
  calls = []
  reply = { ok: true, status: 200, json: { status: 1, request: 'r', receipt: 'rcpt123' } }
  process.env.PUSHOVER_APP_TOKEN = TOKEN
  process.env.PUSHOVER_USER_KEY = USER
  pushoverDeps.blocked = () => false
  pushoverDeps.fetch = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(String(init.body)) })
    return { ok: reply.ok, status: reply.status, json: async () => reply.json } as Response
  }
})
afterEach(() => {
  pushoverDeps.fetch = realFetch
  pushoverDeps.blocked = realBlocked
  delete process.env.PUSHOVER_APP_TOKEN
  delete process.env.PUSHOVER_USER_KEY
  vi.restoreAllMocks()
})

describe('sendPushover', () => {
  it('an emergency (priority 2) repeats every 5 minutes for an hour and returns the receipt', async () => {
    const r = await sendPushover({ title: 'BOOKING FAILED', message: 'x', priority: 2, url: 'https://ourhometownstudio.com/api/alerts/ack?k=a&s=b', urlTitle: 'Got it' })
    expect(r).toEqual({ sent: true, receipt: 'rcpt123' })
    const b = calls[0].body
    expect(calls[0].url).toBe('https://api.pushover.net/1/messages.json')
    expect([b.get('priority'), b.get('retry'), b.get('expire'), b.get('url_title')]).toEqual(['2', '300', '3600', 'Got it'])
    expect([b.get('token'), b.get('user')]).toEqual([TOKEN, USER])
  })

  it('a normal note has no retry or expire', async () => {
    await sendPushover({ title: 'Fixed', message: 'ok', priority: 0 })
    expect(calls[0].body.get('priority')).toBe('0')
    expect(calls[0].body.has('retry')).toBe(false)
  })

  it('a quiet note (priority -1, night) is sent as -1 with no retry or expire', async () => {
    await sendPushover({ title: 'Fixed', message: 'ok', priority: -1 })
    expect(calls[0].body.get('priority')).toBe('-1')
    expect(calls[0].body.has('retry')).toBe(false)
    expect(calls[0].body.has('expire')).toBe(false)
  })

  it('not set up → not sent, nothing called', async () => {
    delete process.env.PUSHOVER_USER_KEY
    expect(await sendPushover({ title: 't', message: 'm', priority: 2 })).toEqual({ sent: false })
    expect(calls).toHaveLength(0)
  })

  it('refused or unreachable → not sent, never throws, never logs a key', async () => {
    const logs: string[] = []
    for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
    reply = { ok: false, status: 400, json: { status: 0, errors: ['user identifier is invalid'] } }
    expect(await sendPushover({ title: 't', message: 'm', priority: 2 })).toEqual({ sent: false })
    pushoverDeps.fetch = async () => { throw new Error(`network down ${TOKEN}`) }
    expect(await sendPushover({ title: 't', message: 'm', priority: 0 })).toEqual({ sent: false })
    const all = logs.join('\n')
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain(USER)
  })

  it('test runs are blocked by default, whatever keys are set', async () => {
    pushoverDeps.blocked = realBlocked
    expect(await sendPushover({ title: 't', message: 'm', priority: 2 })).toEqual({ sent: false })
    expect(calls).toHaveLength(0)
  })

  it('cancelling a receipt posts to its cancel address; a bad receipt is refused', async () => {
    expect(await cancelPushoverReceipt('rcpt123')).toBe(true)
    expect(calls[0].url).toBe('https://api.pushover.net/1/receipts/rcpt123/cancel.json')
    expect(await cancelPushoverReceipt('../x')).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
