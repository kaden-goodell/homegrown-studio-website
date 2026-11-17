/**
 * POST /api/quote/corky-visit.json: the visit beacon on Jessyca's quote page.
 * The 'quote-visits' store is an in-memory fake; everything else is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ rows: new Map<string, string>(), fail: false }))
vi.mock('@lib/blob-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (name: string, dir: string) => (name !== 'quote-visits' ? real.makeKvStore(name, dir) : {
      get: async (k: string) => { if (m.fail) throw new Error('blobs down'); return m.rows.get(k) ?? null },
      set: async (k: string, v: string) => { m.rows.set(k, v) },
      list: async (p?: string) => [...m.rows.keys()].filter((k) => !p || k.startsWith(p)),
      delete: async (k: string) => { m.rows.delete(k) },
      getWithMeta: async () => ({ value: null, etag: null }),
      setIfMatch: async () => true,
    }),
  }
})

import { POST } from '@pages/api/quote/corky-visit.json'
import { MAX_EVENTS } from '@lib/quote/corky-visits'

let ip = 0
const send = async (b: unknown, address?: string) => {
  const res = (await POST({
    request: new Request('http://localhost/api/quote/corky-visit.json', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: typeof b === 'string' ? b : JSON.stringify(b) }),
    clientAddress: address ?? `10.8.0.${++ip}`,
  } as any)) as Response
  return { status: res.status, text: await res.text() }
}
const VISITOR = 'aaaa1111-bbbb-2222-cccc-333344445555'
const SESSION = 'ssss1111-bbbb-2222-cccc-333344445555'
const beacon = (over: Record<string, unknown> = {}) => ({
  visitorId: VISITOR, sessionId: SESSION, device: 'iPhone', referrer: 'www.Facebook.com', activeSeconds: 42, scroll: 55,
  events: [{ type: 'pick', id: 'tote', at: 10 }], pick: 'tote', ...over,
})
const stored = () => JSON.parse(m.rows.get(`corky-${VISITOR}-${SESSION}`)!)

beforeEach(() => {
  m.rows.clear()
  m.fail = false
})

describe('POST /api/quote/corky-visit.json', () => {
  it('stores a clean record under corky-<visitor>-<session> and answers 204', async () => {
    const res = await send(beacon())
    expect(res).toEqual({ status: 204, text: '' })
    const v = stored()
    expect(v).toMatchObject({
      visitorId: VISITOR, sessionId: SESSION, device: 'iPhone', referrer: 'facebook.com', activeSeconds: 42, scroll: 55,
      events: [{ type: 'pick', id: 'tote', at: 10 }], pick: 'tote',
    })
    expect(typeof v.first).toBe('number')
    expect(JSON.stringify(v)).not.toContain('10.8.0')
  })

  it('clamps numbers, drops unknown devices, events and nights, and cuts the list at 50', async () => {
    const events = [
      { type: 'pick', id: 'nope', at: 1 },
      { type: 'hack', at: 1 },
      { type: 'text', at: -5 },
      ...Array.from({ length: 80 }, (_, i) => ({ type: 'pick', id: 'ornament', at: i })),
    ]
    await send(beacon({ device: 'Commodore 64', referrer: 'https://evil.example/<script>', activeSeconds: 9e12, scroll: 400, pick: 'pony', events }))
    const v = stored()
    expect(v.device).toBe('other')
    expect(v.referrer).toBeNull()
    expect(v.activeSeconds).toBe(86400)
    expect(v.scroll).toBe(100)
    expect(v.pick).toBeNull()
    expect(v.events[0]).toEqual({ type: 'text', at: 0 })
    expect(v.events.length).toBeLessThanOrEqual(MAX_EVENTS)
    expect(v.events.every((e: any) => e.type === 'text' || e.id === 'ornament')).toBe(true)
  })

  it('upserts, keeping the earliest start and the larger totals', async () => {
    await send(beacon({ activeSeconds: 300, scroll: 90, events: [{ type: 'pick', id: 'tote', at: 1 }, { type: 'pick', id: 'mosaic', at: 2 }] }))
    const first = stored().first
    await send(beacon({ activeSeconds: 10, scroll: 20, events: [], pick: null, device: 'other' }))
    const v = stored()
    expect(m.rows.size).toBe(1)
    expect(v.first).toBe(first)
    expect(v.activeSeconds).toBe(300)
    expect(v.scroll).toBe(90)
    expect(v.events).toHaveLength(2)
    expect(v.pick).toBe('tote')
    expect(v.device).toBe('iPhone')
    await send(beacon({ activeSeconds: 600, events: [{ type: 'pick', id: 'tote', at: 1 }, { type: 'pick', id: 'mosaic', at: 2 }, { type: 'sheet', at: 3 }], pick: 'mosaic' }))
    expect(stored()).toMatchObject({ activeSeconds: 600, pick: 'mosaic', events: expect.arrayContaining([{ type: 'sheet', at: 3 }]) })
  })

  it.each([
    ['not JSON', '{nope'],
    ['empty', ''],
    ['no visitor id', beacon({ visitorId: undefined })],
    ['a bad session id', beacon({ sessionId: '../../etc' })],
    ['too big', JSON.stringify(beacon({ junk: 'x'.repeat(20_000) }))],
  ])('bad beacon (%s) → 400, nothing stored', async (_n, b) => {
    expect((await send(b)).status).toBe(400)
    expect(m.rows.size).toBe(0)
  })

  it('rate limit → 429 after 60 beacons in 10 minutes from one address', async () => {
    const address = '10.77.77.77'
    for (let i = 0; i < 60; i++) expect((await send(beacon(), address)).status).toBe(204)
    expect((await send(beacon(), address)).status).toBe(429)
  })

  it('a store outage is quiet: still 204', async () => {
    m.fail = true
    expect((await send(beacon())).status).toBe(204)
  })
})

describe('deviceKind (the page’s side)', () => {
  it('names the device kind without keeping the user agent', async () => {
    const { deviceKind } = await import('@lib/quote/corky-visit-client')
    expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('iPad')
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('Mac')
    expect(deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android')
    expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
    expect(deviceKind('curl/8')).toBe('other')
  })
})
