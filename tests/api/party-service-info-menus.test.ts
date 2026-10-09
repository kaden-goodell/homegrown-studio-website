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
    object: { get: async () => ({ object: { itemData: { variations: [{ id: 'V', version: 1n, itemVariationData: { serviceDuration: 5400000n, priceMoney: { amount: 30000n }, teamMemberIds: ['T'] } }] } } }) },
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
