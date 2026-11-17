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

  it('a private event (even on a weeknight) comes with origin, its package lines, place and address, and is never "weeknight"', async () => {
    const q = (id: string, chargeId: string | null) => ({ ...item(chargeId), id, kind: 'quote', refId: 'qt_1', label: id === 'itm_dep' ? 'Deposit' : 'Balance', unitCents: 112500, cents: 112500 })
    parties.list = [
      // Tue Nov 17 2026, 6 PM CT: a weeknight date.
      rec('pty_q', {
        startIso: '2026-11-18T00:00:00.000Z', endIso: '2026-11-18T02:00:00.000Z', guestCount: 30, craftName: 'Holiday Glow Night',
        origin: 'quote', place: 'away', address: '12 Oak Lane, Madison, AL',
        quote: { quoteId: 'qt_1', tierName: 'Holiday Glow Night', lines: ['Glass terrarium', 'Earring bar'], guests: 30, pricePerPersonCents: 7500 },
        items: [q('itm_dep', 'chg_1'), q('itm_bal', null)],
      }),
      rec('pty_w'),
    ]
    const res = await GET({ request: new Request('http://localhost/api/staff/parties.json') } as any)
    const { data } = await res.json()
    const [qp, wp] = data.parties
    expect(qp).toMatchObject({ origin: 'quote', quoteLines: ['Glass terrarium', 'Earring bar'], place: 'away', address: '12 Oak Lane, Madison, AL', guestCount: 30, kind: 'weekend' })
    expect(qp.paidOnlineCents).toBe(112500)
    expect(wp.origin).toBeNull()
    expect(wp.quoteLines).toBeNull()
    expect(wp.address).toBeNull()
  })
})
