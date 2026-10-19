import { describe, it, expect, vi } from 'vitest'
import { partyConfig } from '@config/party.config'

const sq = partyConfig.square
const item = (id: string, name: string, extraCats: string[] = []) => ({
  id, type: 'ITEM',
  itemData: {
    name, description: 'd', imageIds: [],
    categories: [{ id: sq.partyCraftCategoryId }, ...extraCats.map((c) => ({ id: c }))],
    variations: [{ itemVariationData: { priceMoney: { amount: 1500n } } }],
  },
})
const items = [
  item('A', 'Keychain Bar'),
  item('B', 'Mixed Media Notebooks', [sq.partyOnlyCategoryId]),
  item('C', 'Earring Bar', [sq.cafeOnlyCategoryId]),
]
const client = {
  catalog: {
    // The live-only appointment item is never asked for (the sandbox has none).
    object: { get: async () => { throw new Error('no appointment item lookup') } },
    list: async () => items,
    batchGet: async () => ({ objects: [] }),
  },
}
vi.mock('@providers/square/client', () => ({ createSquareClient: () => client }))

import { GET } from '@pages/api/party/service-info.json'
import { fetchPartyCrafts } from '@lib/craft-catalog'

const crafts = async (qs: string) => {
  const res = await GET({ url: new URL('http://x/api/party/service-info.json' + qs) } as any)
  const body = await (res as Response).json()
  return (body.data ?? body).crafts.map((c: any) => ({ name: c.name, partyOnly: c.partyOnly, cafeOnly: c.cafeOnly }))
}

describe('craft menus: parties vs Craft Café', () => {
  it('parties never see café-only crafts', async () => {
    expect((await crafts('')).map((c: any) => c.name)).toEqual(['Keychain Bar', 'Mixed Media Notebooks'])
  })
  it('the café menu gets café-only crafts too, flagged, so it can drop the parties-only ones', async () => {
    const list = await crafts('?menu=cafe')
    expect(list.map((c: any) => c.name)).toEqual(['Earring Bar', 'Keychain Bar', 'Mixed Media Notebooks'])
    expect(list.find((c: any) => c.name === 'Earring Bar').cafeOnly).toBe(true)
    expect(list.find((c: any) => c.name === 'Mixed Media Notebooks').partyOnly).toBe(true)
  })
  it('take-home kits (priced server-side) never include café-only crafts', async () => {
    expect((await fetchPartyCrafts()).map((c) => c.name)).toEqual(['Keychain Bar', 'Mixed Media Notebooks'])
  })
})

describe('service-info without the Square appointment item', () => {
  const info = async (qs = '') => {
    const res = (await GET({ url: new URL('http://x/api/party/service-info.json' + qs) } as any)) as Response
    expect(res.status).toBe(200)
    const body = await res.json()
    return body.data ?? body
  }

  it('gives the party facts from settings (the config until saved) and the default package for cached pages', async () => {
    const d = await info()
    expect(d.facts.packages.map((p: any) => p.id)).toEqual(['pkg_whole'])
    expect(d.facts.times.minLeadDays).toBe(partyConfig.minLeadDays)
    expect(d.facts.days).toBeTruthy()
    expect(typeof d.facts.first).toBe('string')
    expect(d.durationMinutes).toBe(partyConfig.durationMinutes)
    expect(d.basePriceCents).toBe(partyConfig.basePriceCents)
    // Pages already open send this back on availability requests; it is ignored there.
    expect(d.variationId).toBe('pkg_whole')
    expect(d).not.toHaveProperty('teamMemberId')
    expect(d.crafts.length).toBe(2)
  })

  it('takes the party craft category from SQUARE_PARTY_CRAFT_CATEGORY_ID when set (the sandbox)', async () => {
    items.push({ ...item('S', 'Sandbox Craft'), itemData: { ...item('S', 'Sandbox Craft').itemData, categories: [{ id: 'SANDBOX_CAT' }] } } as any)
    process.env.SQUARE_PARTY_CRAFT_CATEGORY_ID = 'SANDBOX_CAT'
    try {
      expect((await info()).crafts.map((c: any) => c.name)).toEqual(['Sandbox Craft'])
    } finally {
      delete process.env.SQUARE_PARTY_CRAFT_CATEGORY_ID
      items.pop()
    }
  })
})
