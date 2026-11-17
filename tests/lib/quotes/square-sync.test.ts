// @vitest-environment node
// Quote menu: full Square catalog sync (S-6) and café cost import (S-45), with a fake Square (raw REST) behind it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  objects: [] as any[],
  pageSize: 2,
  failOnPage: 0,
  calls: [] as string[],
}))

/** A paged `/catalog/list`: `pageSize` objects per page, cursor = next offset. */
async function fakeSquare(path: string): Promise<any> {
  h.calls.push(path)
  if (!path.startsWith('/catalog/list')) throw new Error(`unexpected ${path}`)
  const q = new URLSearchParams(path.split('?')[1])
  const types = q.get('types')!.split(',')
  const start = Number(q.get('cursor') ?? 0)
  const page = start / h.pageSize + 1
  if (h.failOnPage && page === h.failOnPage) throw Object.assign(new Error('Square said: boom'), { status: 500 })
  const all = h.objects.filter((o) => types.includes(o.type))
  const objects = all.slice(start, start + h.pageSize)
  const next = start + h.pageSize
  return { objects, ...(next < all.length ? { cursor: String(next) } : {}) }
}

vi.mock('@lib/classes/square-api', () => ({ squareFetch: (p: string) => fakeSquare(p), squareSettings: () => ({ environment: 'sandbox' }) }))

import { syncSquare } from '@lib/quotes/square-sync'
import { applyCafeCosts } from '@lib/quotes/cost-import'
import { getMenu, saveMenuItems, QuoteStoreError } from '@lib/quotes/menu-store'
import type { MenuItem } from '@lib/quotes/types'

const variation = (id: string, name: string, cents: number, over: any = {}) => ({
  type: 'ITEM_VARIATION', id, item_variation_data: { name, pricing_type: 'FIXED_PRICING', price_money: { amount: cents, currency: 'USD' } }, ...over,
})
const item = (id: string, name: string, cat: string, variations: any[], over: any = {}) => ({
  type: 'ITEM', id, ...over.top,
  item_data: { name, categories: [{ id: cat }], image_ids: over.image_ids ?? [], variations },
})

const NOW = new Date('2026-11-17T12:00:00.000Z')
const LATER = new Date('2026-11-18T12:00:00.000Z')

beforeEach(async () => {
  await saveMenuItems(() => [])
  h.pageSize = 2
  h.failOnPage = 0
  h.calls.length = 0
  h.objects = [
    { type: 'CATEGORY', id: 'CAT_A', category_data: { name: 'Party Crafts' } },
    { type: 'CATEGORY', id: 'CAT_B', category_data: { name: 'Café' } },
    item('TER', 'Terrarium', 'CAT_A', [variation('TER_S', 'Small', 2500), variation('TER_L', 'Large', 4000)], { image_ids: ['IMG1'] }),
    item('MOS', 'Mosaic Coaster', 'CAT_B', [variation('MOS_V', 'Regular', 1500)]),
    { type: 'IMAGE', id: 'IMG1', image_data: { url: 'https://cdn.test/ter.jpg' } },
    item('OLD', 'Deleted Thing', 'CAT_B', [variation('OLD_V', 'Regular', 900)], { top: { is_deleted: true } }),
  ]
})

const byVar = (items: MenuItem[], v: string) => items.find((i) => i.squareVariationId === v)!

describe('syncSquare', () => {
  it('lists every variation of every item in every category, across pages', async () => {
    const doc = await syncSquare(NOW)
    expect(h.calls.length).toBeGreaterThan(1)
    expect(doc.syncedAt).toBe(NOW.toISOString())
    const items = (await getMenu()).items
    expect(items.map((i) => i.name).sort()).toEqual(['Mosaic Coaster', 'Terrarium · Large', 'Terrarium · Small'])
    expect(byVar(items, 'TER_S')).toMatchObject({
      source: 'square', squareItemId: 'TER', squareVariationId: 'TER_S', cents: 2500, per: 'person',
      photoUrl: 'https://cdn.test/ter.jpg', hidden: false, tags: [],
    })
    expect(byVar(items, 'MOS_V')).toMatchObject({ cents: 1500, photoUrl: null })
    expect(items.some((i) => i.squareItemId === 'OLD')).toBe(false)
  })

  it('a re-sync keeps the owner cost, tags, hidden and per, and updates name and price', async () => {
    await syncSquare(NOW)
    await saveMenuItems((items) => items.map((i) => i.squareVariationId === 'MOS_V'
      ? { ...i, costCents: 900, tags: ['adults'], hidden: true, per: 'event' } : i))
    h.objects[3] = item('MOS', 'Mosaic Tile Coaster', 'CAT_B', [variation('MOS_V', 'Regular', 1800)])
    await syncSquare(LATER)
    const mos = byVar((await getMenu()).items, 'MOS_V')
    expect(mos).toMatchObject({ name: 'Mosaic Tile Coaster', cents: 1800, costCents: 900, tags: ['adults'], hidden: true, per: 'event' })
  })

  it('a variation missing from a complete sync is marked gone, and cleared when it returns', async () => {
    await syncSquare(NOW)
    const ter = h.objects[2]
    h.objects[2] = item('TER', 'Terrarium', 'CAT_A', [variation('TER_S', 'Small', 2500)])
    await syncSquare(LATER)
    let items = (await getMenu()).items
    expect(byVar(items, 'TER_L').gone).toBe(true)
    expect(byVar(items, 'TER_S').gone).toBeFalsy()
    h.objects[2] = ter
    await syncSquare(LATER)
    items = (await getMenu()).items
    expect(byVar(items, 'TER_L').gone).toBeFalsy()
  })

  it('owner-made items are never marked gone', async () => {
    await saveMenuItems(() => [{ id: 'own1', source: 'own', name: 'Travel', photoUrl: null, cents: 5000, per: 'event', costCents: null, tags: [], hidden: false, updatedAt: '' }])
    await syncSquare(NOW)
    const travel = (await getMenu()).items.find((i) => i.id === 'own1')!
    expect(travel.gone).toBeFalsy()
  })

  it('Square failing on page 2 changes nothing and throws sync_failed', async () => {
    await syncSquare(NOW)
    const before = await getMenu()
    h.objects[3] = item('MOS', 'Renamed', 'CAT_B', [variation('MOS_V', 'Regular', 1)])
    h.failOnPage = 2
    const err = await syncSquare(LATER).catch((e) => e)
    expect(err).toBeInstanceOf(QuoteStoreError)
    expect(err.why).toBe('sync_failed')
    expect(await getMenu()).toEqual(before)
  })

  it('fills café costs from scripts/data/cafe-costs.json on matching names', async () => {
    h.objects.push(item('TERR', 'Terrarium (.5 Gallon)', 'CAT_B', [variation('TERR_V', 'Regular', 4500)]))
    await syncSquare(NOW)
    const items = (await getMenu()).items
    expect(byVar(items, 'TERR_V').costCents).toBe(850)
    expect(byVar(items, 'TER_S').costCents).toBeNull()
  })
})

const mi = (name: string, costCents: number | null = null): MenuItem => ({
  id: name, source: 'square', name, photoUrl: null, cents: 100, per: 'person', costCents, tags: [], hidden: false, updatedAt: '',
})

describe('applyCafeCosts', () => {
  const costs = { items: [{ name: 'Terrarium (.5 Gallon)', costCents: 850 }, { name: 'Loom Pot Holder — Large', costCents: 300 }] }

  it('matches normalized names: " · " and "()" and "—" are the same', () => {
    const out = applyCafeCosts([mi('Terrarium · .5 Gallon'), mi('terrarium (.5  gallon)'), mi('Loom pot holder · Large')], costs)
    expect(out.map((i) => i.costCents)).toEqual([850, 850, 300])
  })

  it('leaves unmatched items null and never overwrites an existing cost', () => {
    const out = applyCafeCosts([mi('Mosaic Coaster'), mi('Terrarium (.5 Gallon)', 1200)], costs)
    expect(out.map((i) => i.costCents)).toEqual([null, 1200])
  })
})
