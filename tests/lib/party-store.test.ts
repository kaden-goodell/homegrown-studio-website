import { describe, it, expect, vi, beforeEach } from 'vitest'

let previewOrDev = true
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => previewOrDev }))

import { savePartyRecord, getPartyRecord, listParties, type PartyRecord } from '@lib/party-store'

function party(bookingId: string, over: Partial<PartyRecord> = {}): PartyRecord {
  return {
    bookingId, hostToken: 't', craftName: 'Pails', startIso: '2026-10-20T00:00:00.000Z', durationMinutes: 120,
    hostName: 'Ada', hostEmail: 'ada@example.com', guestCount: 8, title: null, dropOff: false,
    createdAt: '2026-10-07T00:00:00.000Z', ...over,
  }
}

describe('party-store visibility of simulated parties', () => {
  beforeEach(() => { previewOrDev = true })
  const tag = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const ids = { real: `real_${tag}`, dev: `dev_${tag}`, flagged: `flagged_${tag}` }

  async function seed() {
    await savePartyRecord(party(ids.real))
    await savePartyRecord(party(ids.dev))
    await savePartyRecord(party(ids.flagged, { simulated: true }))
  }
  const mine = (list: PartyRecord[]) => list.map((r) => r.bookingId).filter((id) => id.endsWith(tag)).sort()

  it('hides dev_ and simulated parties from both reads in production or an unknown runtime', async () => {
    await seed()
    previewOrDev = false
    expect(await getPartyRecord(ids.dev)).toBeNull()
    expect(await getPartyRecord(ids.flagged)).toBeNull()
    expect((await getPartyRecord(ids.real))?.bookingId).toBe(ids.real)
    expect(mine(await listParties())).toEqual([ids.real])
  })

  it('shows them on a preview or in dev', async () => {
    await seed()
    expect((await getPartyRecord(ids.dev))?.bookingId).toBe(ids.dev)
    expect((await getPartyRecord(ids.flagged))?.bookingId).toBe(ids.flagged)
    expect(mine(await listParties())).toEqual([ids.dev, ids.flagged, ids.real].sort())
  })
})
