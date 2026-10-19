import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configPartySettings } from '@lib/parties/party-times'
import type { PartySettings } from '@lib/parties/types'

let settings: PartySettings
vi.mock('@lib/parties/settings-store', () => ({ getPartySettings: vi.fn(async () => settings) }))

import { GET } from '@pages/api/party/price-facts.json'

const call = async () => {
  const res = await GET({ request: new Request('http://x/api/party/price-facts.json') } as any)
  return { res, body: (await (res as Response).json()).data }
}

describe('GET /api/party/price-facts.json', () => {
  beforeEach(() => { settings = configPartySettings() })

  it('answers today’s numbers until an owner saves', async () => {
    const { res, body } = await call()
    expect(body).toEqual({
      copy: { feeCents: 30000, minutes: 90, minGuests: 10, maxGuests: 30, bookingWindowDays: 90 },
      from: { name: 'Whole studio', priceCents: 30000 },
    })
    expect((res as Response).headers.get('Netlify-CDN-Cache-Control')).toContain('max-age=60')
  })

  it('follows saved settings: the default package for copy, the cheapest everyone package for "from"', async () => {
    settings.packages[0].priceCents = 35000
    settings.packages[0].minGuests = 12
    settings.packages.push({ ...settings.packages[0], id: 'pkg_table', name: 'Table party', priceCents: 15000 })
    settings.packages.push({ ...settings.packages[0], id: 'pkg_test', name: 'Test', priceCents: 100, who: 'link' })
    const { body } = await call()
    expect(body.copy).toMatchObject({ feeCents: 35000, minGuests: 12 })
    expect(body.from).toEqual({ name: 'Table party', priceCents: 15000 })
  })
})
