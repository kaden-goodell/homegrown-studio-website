// @vitest-environment node
/**
 * The customer's quote routes: GET /api/quote/view.json, POST pick.json and
 * POST pay.json. The library outcomes are mocked so every status code is
 * checked exactly as spec §3 says; one view runs against the real stores.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const m = vi.hoisted(() => ({
  view: null as null | ((...a: any[]) => Promise<any>),
  pick: null as null | ((...a: any[]) => Promise<any>),
  pay: vi.fn(),
  limited: new Set<string>(),
  limitCalls: [] as { key: string; max: number; windowMs: number }[],
  writes: null as string | null,
}))

vi.mock('@lib/quotes/public-view', async (orig) => {
  const real = await orig<typeof import('@lib/quotes/public-view')>()
  return {
    ...real,
    publicView: (...a: any[]) => (m.view ? m.view(...a) : (real.publicView as any)(...a)),
    pickTier: (...a: any[]) => (m.pick ? m.pick(...a) : (real.pickTier as any)(...a)),
  }
})
vi.mock('@lib/quotes/pay', async (orig) => ({ ...(await orig<typeof import('@lib/quotes/pay')>()), payQuote: (...a: any[]) => m.pay(...a) }))
vi.mock('@lib/rate-limit', async (orig) => {
  const real = await orig<typeof import('@lib/rate-limit')>()
  return {
    ...real,
    rateLimited: (key: string, max: number, windowMs: number) => {
      m.limitCalls.push({ key, max, windowMs })
      return [...m.limited].some((prefix) => key.startsWith(prefix))
    },
  }
})
vi.mock('@lib/parties/test-site', async (orig) => ({ ...(await orig<typeof import('@lib/parties/test-site')>()), partyWritesRefusal: () => m.writes }))

import * as viewRoute from '@pages/api/quote/view.json'
import * as pickRoute from '@pages/api/quote/pick.json'
import * as payRoute from '@pages/api/quote/pay.json'
import { adminCookie } from '@lib/admin-auth'
import { newToken, newQuoteId, partyIdForQuote, createQuote, getQuote } from '@lib/quotes/quote-store'
import { checkRequest, saveRequest } from '@lib/event-requests'
import type { Quote } from '@lib/quotes/types'
import { goodBody } from '../fixtures/event-request'

let ip = 0
const nextIp = () => `10.7.0.${++ip}`

async function view(t: string, opts: { cookie?: string; address?: string } = {}) {
  const request = new Request(`https://x.test/api/quote/view.json?t=${encodeURIComponent(t)}`, {
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  })
  const res = await viewRoute.GET({ request, clientAddress: opts.address ?? nextIp() } as any)
  return { status: res.status, headers: res.headers, body: await res.json() }
}

async function post(route: typeof pickRoute | typeof payRoute, path: string, body: unknown, address = nextIp()) {
  const request = new Request(`https://x.test/api/quote/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await route.POST({ request, clientAddress: address } as any)
  return { status: res.status, headers: res.headers, body: await res.json() }
}

const payBody = (over: Record<string, unknown> = {}) => ({
  t: 'tok', tierId: 'tr_pick', priceKey: 'pk', attemptId: randomUUID(), pay: { paymentToken: 'cnon:ok', sourceKind: 'card' }, ...over,
})

beforeEach(() => {
  m.view = null
  m.pick = null
  m.pay.mockReset()
  m.limited.clear()
  m.limitCalls.length = 0
  m.writes = null
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('LOOKUP_SIGNING_SECRET', 'server-only-secret-1')
})

describe('view.json', () => {
  it('passes isOwner=false without the admin cookie and true with it (owner previews do not count)', async () => {
    const calls: any[] = []
    m.view = async (token: string, opts: any) => { calls.push({ token, opts }); return { state: 'closed' } }
    const a = await view('abc')
    expect(a.status).toBe(200)
    expect(a.body).toEqual({ data: { state: 'closed' } })
    expect(a.headers.get('Cache-Control')).toBe('no-store')
    await view('abc', { cookie: adminCookie().split(';')[0] })
    expect(calls.map((c) => c.opts.isOwner)).toEqual([false, true])
    expect(calls[0].token).toBe('abc')
    expect(calls[0].opts.origin).toBe('https://x.test')
  })

  it('a missing token is the same closed answer', async () => {
    const r = await view('')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ data: { state: 'closed' } })
  })

  it('rate limits 60/min per IP → 429', async () => {
    m.view = async () => ({ state: 'closed' })
    await view('abc', { address: '1.2.3.4' })
    expect(m.limitCalls.at(-1)).toEqual({ key: 'quote-view:1.2.3.4', max: 60, windowMs: 60_000 })
    m.limited.add('quote-view:')
    const r = await view('abc')
    expect(r.status).toBe(429)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(r.body.why).toBe('rate_limited')
  })

  it('a store failure is 503', async () => {
    m.view = async () => { throw new Error('down') }
    const r = await view('abc')
    expect(r.status).toBe(503)
    expect(r.body.why).toBe('unavailable')
  })
})

describe('view.json against the real stores', () => {
  async function makeQuote(): Promise<Quote> {
    const c = checkRequest(goodBody({ about: { ...goodBody().about, name: 'Dana Planner' } }), new Date('2026-10-17T17:00:00Z'))
    if (!c.ok) throw new Error('bad fixture')
    const requestId = (await saveRequest(c.value, [])).id
    const id = newQuoteId()
    return createQuote({
      id, requestId, partyId: partyIdForQuote(id), token: newToken(), version: 1, priceKey: 'pk-real',
      status: 'sent', place: 'studio', address: '', startIso: '2099-12-05T20:00:00.000Z', endIso: '2099-12-05T22:00:00.000Z',
      guests: 20, crafters: 'adults', targetCents: 4000, note: 'Hi!', depositPct: 50, expiresAt: '2099-12-01T00:00:00.000Z',
      tiers: [{ id: 'tr_pick', key: 'pick', name: 'Our pick', photoUrl: null, hidden: false, priceCents: 4000,
        lines: [{ itemId: 'i1', label: 'Wood sign', photoUrl: null, cents: 4500, per: 'person', costCents: 900 }] }],
      held: true, sentAt: '2026-11-17T12:00:00.000Z', sentBy: 'Kaden', views: 0, history: [],
    })
  }

  it('shows the open quote with its price key, counts a customer view, not an owner preview', async () => {
    const q = await makeQuote()
    const r = await view(q.token)
    expect(r.status).toBe(200)
    expect(r.body.data.state).toBe('open')
    expect(r.body.data.firstName).toBe('Dana')
    expect(r.body.data.tiers.map((t: any) => t.id)).toEqual(['tr_pick'])
    expect(r.body.data.priceKey).toBe('pk-real')
    expect(JSON.stringify(r.body)).not.toContain('costCents')
    expect((await getQuote(q.id))?.views).toBe(1)

    await view(q.token, { cookie: adminCookie().split(';')[0] })
    expect((await getQuote(q.id))?.views).toBe(1)
  })
})

describe('pick.json', () => {
  it('ok → 200', async () => {
    const calls: any[] = []
    m.pick = async (...a: any[]) => { calls.push(a); return { ok: true } }
    const r = await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'tr_pick' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ data: { ok: true } })
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(calls[0].slice(0, 2)).toEqual(['tok', 'tr_pick'])
  })

  it('closed → 410, tier_unavailable → 404', async () => {
    m.pick = async () => ({ ok: false, why: 'closed' })
    const a = await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'x' })
    expect(a.status).toBe(410)
    expect(a.body.why).toBe('closed')
    expect(typeof a.body.error).toBe('string')
    m.pick = async () => ({ ok: false, why: 'tier_unavailable' })
    const b = await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'x' })
    expect(b.status).toBe(404)
    expect(b.body.why).toBe('tier_unavailable')
  })

  it('bad body → 400', async () => {
    const r = await post(pickRoute, 'pick.json', 'not json')
    expect(r.status).toBe(400)
    expect(r.body.why).toBe('invalid')
  })

  it('test site → 503 and nothing picked', async () => {
    m.writes = 'This test site has no store of its own.'
    const spy = vi.fn()
    m.pick = spy
    const r = await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'tr_pick' })
    expect(r.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })

  it('rate limits 20/min per IP → 429', async () => {
    m.pick = async () => ({ ok: true })
    await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'tr_pick' }, '5.5.5.5')
    expect(m.limitCalls.at(-1)).toEqual({ key: 'quote-pick:5.5.5.5', max: 20, windowMs: 60_000 })
    m.limited.add('quote-pick:')
    const r = await post(pickRoute, 'pick.json', { t: 'tok', tierId: 'tr_pick' })
    expect(r.status).toBe(429)
  })
})

describe('pay.json', () => {
  it('ok → 200 {data:{partyId}}, passing the request URL and body through', async () => {
    m.pay.mockResolvedValue({ ok: true, partyId: 'pty_1' })
    const body = payBody()
    const r = await post(payRoute, 'pay.json', body)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ data: { partyId: 'pty_1' } })
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(m.pay).toHaveBeenCalledWith(expect.objectContaining({
      token: 'tok', tierId: 'tr_pick', priceKey: 'pk', attemptId: body.attemptId, pay: body.pay, requestUrl: 'https://x.test/api/quote/pay.json',
    }))
  })

  const cases: [string, number][] = [
    ['checking', 202], ['declined', 402], ['tier_unavailable', 404], ['price_changed', 409], ['time_taken', 409],
    ['busy', 409], ['closed', 410], ['unavailable', 503],
  ]
  for (const [why, status] of cases) {
    it(`${why} → ${status}`, async () => {
      m.pay.mockResolvedValue({ ok: false, why, message: `msg ${why}` })
      const r = await post(payRoute, 'pay.json', payBody())
      expect(r.status).toBe(status)
      expect(r.body).toEqual({ error: `msg ${why}`, why })
      expect(r.headers.get('Cache-Control')).toBe('no-store')
    })
  }

  it('a thrown error is 202 checking (the charge may have gone through)', async () => {
    m.pay.mockRejectedValue(new Error('boom'))
    const r = await post(payRoute, 'pay.json', payBody())
    expect(r.status).toBe(202)
    expect(r.body.why).toBe('checking')
  })

  it('a bad attempt id or body → 400, nothing charged', async () => {
    const a = await post(payRoute, 'pay.json', payBody({ attemptId: 'nope' }))
    expect(a.status).toBe(400)
    expect(a.body.why).toBe('invalid')
    const b = await post(payRoute, 'pay.json', '{')
    expect(b.status).toBe(400)
    expect(m.pay).not.toHaveBeenCalled()
  })

  it('test site → 503, nothing charged', async () => {
    m.writes = 'This test site has no store of its own.'
    const r = await post(payRoute, 'pay.json', payBody())
    expect(r.status).toBe(503)
    expect(m.pay).not.toHaveBeenCalled()
  })

  it('rate limits 5/min per IP → 429', async () => {
    m.pay.mockResolvedValue({ ok: true, partyId: 'pty_1' })
    await post(payRoute, 'pay.json', payBody(), '6.6.6.6')
    expect(m.limitCalls.at(-1)).toEqual({ key: 'quote-pay:6.6.6.6', max: 5, windowMs: 60_000 })
    m.limited.add('quote-pay:')
    const r = await post(payRoute, 'pay.json', payBody())
    expect(r.status).toBe(429)
    expect(m.pay).toHaveBeenCalledTimes(1)
  })
})
