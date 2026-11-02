// @vitest-environment node
// A craft hidden in /admin › More › Crafts is off /book, the Craft Café menu and new bookings; the rest are untouched.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { partyConfig } from '@config/party.config'

const sq = partyConfig.square
const item = (id: string, name: string, imageIds: string[] = []) => ({
  id, type: 'ITEM',
  itemData: { name, description: 'd', imageIds, categories: [{ id: sq.partyCraftCategoryId }], variations: [{ itemVariationData: { priceMoney: { amount: 1500n } } }] },
})
const items = [item('A', 'Keychain Bar', ['IMG1']), item('B', 'Pot Holders')]
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { list: async () => items, batchGet: async () => ({ objects: [{ id: 'IMG1', imageData: { url: 'https://cdn.test/a.jpg' } }] }) } }),
}))

import { GET } from '@pages/api/party/service-info.json'
import { fetchPartyCrafts, findPartyCraft, resetPartyCraftCache } from '@lib/craft-catalog'
import { setCraftHidden } from '@lib/crafts/craft-settings'

const menu = async (qs = '') => {
  const res = (await GET({ url: new URL('http://x/api/party/service-info.json' + qs) } as any)) as Response
  return ((await res.json()).data.crafts as any[])
}
afterEach(async () => { await setCraftHidden('B', false, 'test'); resetPartyCraftCache() })

describe('hidden crafts', () => {
  it('a craft with no photo still shows, with no image (customers see the card without one)', async () => {
    const list = await menu()
    expect(list.map((c) => [c.name, c.imageUrl])).toEqual([['Keychain Bar', 'https://cdn.test/a.jpg'], ['Pot Holders', null]])
  })
  it('hidden: off both menus, kits, and can’t be booked', async () => {
    await setCraftHidden('B', true, 'Catherine')
    resetPartyCraftCache()
    expect((await menu()).map((c) => c.name)).toEqual(['Keychain Bar'])
    expect((await menu('?menu=cafe')).map((c) => c.name)).toEqual(['Keychain Bar'])
    expect((await fetchPartyCrafts()).map((c) => c.name)).toEqual(['Keychain Bar'])
    expect(await findPartyCraft('B')).toBeNull()
    expect((await findPartyCraft('A'))?.name).toBe('Keychain Bar')
  })
})
