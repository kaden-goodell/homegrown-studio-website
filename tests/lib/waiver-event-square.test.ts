/**
 * The public waiver page never asks Square about a party link (Craft Café
 * review I1): a party id we hold no record of is "not recognized — sign the
 * general agreement", even while Square is down.
 */
import { describe, it, expect, vi } from 'vitest'

const square = vi.hoisted(() => ({ asked: 0 }))
vi.mock('@lib/parties/legacy-square', () => ({
  legacyStaffParties: async () => { square.asked += 1; throw new Error('Square down') },
  legacyStaffParty: async () => { square.asked += 1; throw new Error('Square down') },
}))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<any>()), getPartyRecord: vi.fn(async () => null) }))
vi.mock('@lib/event-meta', () => ({ getEventMeta: vi.fn(async () => null) }))

import { waiverEventOutcome } from '@lib/waiver-event'

describe('/waiver?party=<an id with no record of ours>', () => {
  it('is unknown (sign the general agreement), never an error, and Square is never asked', async () => {
    const outcome = await waiverEventOutcome('party', 'SQUAREBOOKING123')
    expect(outcome.kind).toBe('unknown')
    expect((outcome as any).notice).toMatch(/You can still sign the general agreement/)
    expect(square.asked).toBe(0)
  })
})
