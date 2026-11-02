// @vitest-environment node
/** /api/staff/parties.json (stage 2 Task 13): cancelled parties leave the list; waiting on payment and the end with extra time come along. */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => ({ id: 't', name: 'Test', role: 'crew' }) }))
vi.mock('@lib/waiver-store', () => ({ listWaiversByParty: async () => [] }))
const parties = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<any>()), listParties: async () => parties.list }))

import { GET } from '@pages/api/staff/parties.json'

const item = (chargeId: string | null) => ({ id: 'itm_p', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId, addedAt: '', by: null })
const rec = (id: string, over: Record<string, unknown> = {}) => ({
  bookingId: id, craftName: 'Slime', startIso: '2026-11-14T20:00:00.000Z', durationMinutes: 90, title: null, hostName: 'H', guestCount: 10,
  source: 'ours', status: 'booked', endIso: '2026-11-14T22:00:00.000Z', items: [item('chg_1')], ...over,
})

describe('GET /api/staff/parties.json', () => {
  it('leaves cancelled parties out and says which are waiting on payment', async () => {
    parties.list = [rec('pty_a', { items: [item(null)] }), rec('pty_b', { status: 'cancelled' }), rec('pty_c'), { ...rec('bk_legacy'), source: undefined, status: undefined, endIso: undefined, items: undefined }]
    const res = await GET({ request: new Request('http://localhost/api/staff/parties.json') } as any)
    const { data } = await res.json()
    expect(data.parties.map((p: any) => p.bookingId)).toEqual(['pty_a', 'pty_c', 'bk_legacy'])
    expect(data.parties.map((p: any) => p.waitingOnPayment)).toEqual([true, false, false])
    expect(data.parties[0].endIso).toBe('2026-11-14T22:00:00.000Z')
    expect(data.parties[2].endIso).toBe('2026-11-14T21:30:00.000Z')
  })
})
