/** GET /api/quote/corky-status.json: is Jessyca's deposit paid (no contact details). */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ rows: new Map<string, string>(), fail: false }))
vi.mock('@lib/blob-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (name: string, dir: string) => (name !== 'quote-visits' ? real.makeKvStore(name, dir) : {
      get: async (k: string) => { if (m.fail) throw new Error('blobs down'); return m.rows.get(k) ?? null },
      set: async (k: string, v: string) => { m.rows.set(k, v) },
      list: async () => [...m.rows.keys()],
      delete: async () => undefined,
      getWithMeta: async () => ({ value: null, etag: null }),
      setIfMatch: async () => true,
    }),
  }
})

import { GET } from '@pages/api/quote/corky-status.json'

const get = async () => {
  const res = (await GET({ request: new Request('http://localhost/api/quote/corky-status.json') } as any)) as Response
  return { status: res.status, cache: res.headers.get('Cache-Control'), json: await res.json() }
}

beforeEach(() => {
  m.rows.clear()
  m.fail = false
})

describe('GET /api/quote/corky-status.json', () => {
  it('not paid yet', async () => {
    expect(await get()).toEqual({ status: 200, cache: 'no-store', json: { paid: false, night: null, monogram: false, paidAt: null } })
  })

  it('paid: the night, monograms and when, never her name or receipt', async () => {
    m.rows.set('corky-paid', JSON.stringify({ night: 'Tote & Keychain Bar', monogram: true, paidAt: '2026-11-18T15:02:00.000Z', firstName: 'Jessyca', receiptUrl: 'https://squareup.com/r/1' }))
    const res = await get()
    expect(res).toEqual({ status: 200, cache: 'no-store', json: { paid: true, night: 'Tote & Keychain Bar', monogram: true, paidAt: '2026-11-18T15:02:00.000Z' } })
    expect(JSON.stringify(res.json)).not.toMatch(/Jessyca|squareup/)
  })

  it('store down → 503, the page stays as it is', async () => {
    m.fail = true
    expect((await get()).status).toBe(503)
  })
})
