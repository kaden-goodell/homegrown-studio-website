// tests/scripts/seed-demo.test.ts — the demo seed's guards and builders, with a mocked fetch (no network).
import { describe, it, expect, vi } from 'vitest'
import { PreviewClient, RefusedHostError } from '../../scripts/lib/sandbox-e2e/core'
import {
  assertReadOnlySource, contentFromLive, craftFromLive, DEMO_CAPACITY, isDemoLibrary, DEMO_NOTE, LiveReader, parseSeedArgs, RefusedSourceError, sessionAt, slotFor, sniffImage,
} from '../../scripts/lib/demo-seed/core'
import { validateContent } from '@lib/classes/validate'

describe('host guards', () => {
  it('writes only ever go to the preview', async () => {
    const fetch = vi.fn()
    const c = new PreviewClient({ fetch })
    await expect(c.request('POST', 'https://ourhometownstudio.com/api/admin/classes/classes.json', { body: {} })).rejects.toThrow(RefusedHostError)
    await expect(c.request('POST', 'https://iridescent-croissant-494fc3.netlify.app/api/admin/login.json', { body: {} })).rejects.toThrow(RefusedHostError)
    await expect(c.upload('https://ourhometownstudio.com/api/admin/classes/photo.json', new FormData())).rejects.toThrow(RefusedHostError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the upload goes to the preview with its cookie and Origin', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { url: 'u' } }), { status: 200 }))
    const c = new PreviewClient({ fetch })
    c.jar.set(['hg_admin=abc; Path=/'])
    const r = await c.upload('/api/admin/classes/photo.json', new FormData(), { 'X-Admin-Who': 'Sandbox' })
    expect(r.body.data.url).toBe('u')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).host).toBe('kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app')
    expect((init.headers as Record<string, string>).Cookie).toBe('hg_admin=abc')
    expect((init.headers as Record<string, string>).Origin).toBe(new URL(url).origin)
  })

  it('the live studio is only read: GET, on its three hosts', () => {
    expect(assertReadOnlySource('https://ourhometownstudio.com/api/workshops.json').host).toBe('ourhometownstudio.com')
    expect(assertReadOnlySource('https://connect.squareup.com/v2/catalog/list').host).toBe('connect.squareup.com')
    expect(assertReadOnlySource('https://items-images-production.s3.us-west-2.amazonaws.com/files/x/original.jpeg').protocol).toBe('https:')
    expect(() => assertReadOnlySource('https://connect.squareup.com/v2/catalog/batch-upsert', 'POST')).toThrow(RefusedSourceError)
    expect(() => assertReadOnlySource('https://ourhometownstudio.com/api/admin/login.json', 'DELETE')).toThrow(RefusedSourceError)
    expect(() => assertReadOnlySource('http://ourhometownstudio.com/api/workshops.json')).toThrow(RefusedSourceError)
    expect(() => assertReadOnlySource('https://evil.example/api/workshops.json')).toThrow(RefusedSourceError)
    expect(() => assertReadOnlySource('https://u:p@ourhometownstudio.com/')).toThrow(RefusedSourceError)
  })

  it('LiveReader never fetches a host it may not read, and sends GET only', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workshops: [{ name: 'A', startTime: '2026-11-13T00:00:00Z', price: 3500 }] }), { status: 200 }))
    const live = new LiveReader(fetch, null)
    expect((await live.workshops())[0].name).toBe('A')
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET')
    await expect(live.photo('https://evil.example/x.jpg')).rejects.toThrow(RefusedSourceError)
    await expect(live.catalog('ITEM')).rejects.toThrow(/SQUARE_ACCESS_TOKEN/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('builders', () => {
  const live = {
    name: 'Bring Your Own Bedazzle (BYOB)',
    description: 'Bring something from home and cover it in sparkle.\nWe have the gems. No experience needed.\nEach guest goes home with the thing they bedazzle. Ages 16 and up.',
    startTime: '2026-11-14T01:00:00Z', endTime: '2026-11-14T03:00:00.000Z', duration: 120, price: 2500, taxPercent: 9, imageUrl: null,
  }

  it('a live class becomes valid content: price, ages, 35 seats, two hours', () => {
    const c = contentFromLive(live)
    const v = validateContent(c)
    expect(v.ok).toBe(true)
    expect(c.prices).toEqual({ all: { person: 2500 } })
    expect(c.rules.ages).toBe('Ages 16+')
    expect(c.defaultCapacity).toBe(DEMO_CAPACITY)
    expect(c.defaultMinutes).toBe(120)
    expect(c.name).not.toMatch(/^E2E /)
  })

  it('keeps a future date and moves a past one a week at a time, same weekday and time', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    expect(slotFor('2026-11-14T01:00:00Z', 120, now)).toEqual({ startIso: '2026-11-14T01:00:00.000Z', endIso: '2026-11-14T03:00:00.000Z' })
    const moved = slotFor('2026-10-24T00:00:00Z', 120, now) // Fri Oct 23, 7 PM CDT
    expect(moved.startIso).toBe('2026-11-07T01:00:00.000Z') // Fri Nov 6, 7 PM CST
  })

  it('sessionAt is studio time', () => {
    expect(sessionAt('2026-12-14', '09:00', '12:00', 20)).toEqual({ startIso: '2026-12-14T15:00:00.000Z', endIso: '2026-12-14T18:00:00.000Z', capacity: 20 })
  })

  it('a live craft: words, price, badge and photo', () => {
    const objects = [
      { type: 'CATEGORY', id: 'c1', category_data: { name: 'Crafts' } },
      { type: 'CATEGORY', id: 'c2', category_data: { name: 'Most Popular' } },
      { type: 'IMAGE', id: 'i1', image_data: { url: 'https://items-images-production.s3.us-west-2.amazonaws.com/f.jpeg' } },
    ]
    const item = { type: 'ITEM', id: 'x', item_data: { name: 'Keychains', description_plaintext: 'Words.', categories: [{ id: 'c1' }, { id: 'c2' }], image_ids: ['i1'], variations: [{ item_variation_data: { price_money: { amount: 1500 } } }] } }
    expect(craftFromLive(item, objects)).toEqual({ name: 'Keychains', description: 'Words.', cents: 1500, popular: true, photoUrl: 'https://items-images-production.s3.us-west-2.amazonaws.com/f.jpeg' })
    expect(craftFromLive({ ...item, is_deleted: true }, objects)).toBeNull()
  })

  it('finds its own library entries by the note, and only those', () => {
    expect(isDemoLibrary({ versions: [{ note: DEMO_NOTE }] })).toBe(true)
    expect(isDemoLibrary({ versions: [{ note: 'Added with the class on Nov 13' }] })).toBe(false)
  })

  it('sniffs photo types like the preview does', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImage(new Uint8Array([0x3c, 0x68]))).toBeNull()
  })

  it('options', () => {
    expect(parseSeedArgs([])).toEqual({ remove: false, dryRun: false, help: false, classesOnly: false })
    expect(parseSeedArgs(['--remove']).remove).toBe(true)
    expect(() => parseSeedArgs(['--nope'])).toThrow()
    expect(() => parseSeedArgs(['--remove', '--dry-run'])).toThrow()
  })
})
