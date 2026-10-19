// @vitest-environment node
/** The real kv store (local files in tests): a save survives a fresh read. */
import { describe, it, expect } from 'vitest'
import { getPartySettings, resetPartySettingsCache, savePartySettings } from '@lib/parties/settings-store'
import { configPartySettings } from '@lib/parties/party-times'

describe('party settings on the file store', () => {
  it('missing → config; save then get', async () => {
    resetPartySettingsCache()
    expect((await getPartySettings({ strict: true, fresh: true })).updatedAt).toBeNull()
    const c = structuredClone(configPartySettings())
    c.addOns = [{ id: 'add_bags', label: 'Goodie bags', priceCents: 400, per: 'guest', extraMinutes: 0, maxQty: 30, online: true, archived: false }]
    const { saved } = await savePartySettings(
      { times: c.times, packages: c.packages, addOns: c.addOns, readSquareBookings: false },
      { expectedUpdatedAt: null, by: { id: 'owner-kaden', name: 'Kaden' } },
    )
    resetPartySettingsCache()
    const got = await getPartySettings({ strict: true })
    expect(got).toEqual(saved)
    expect(got.readSquareBookings).toBe(false)
    expect(got.addOns[0].label).toBe('Goodie bags')
  })
})
