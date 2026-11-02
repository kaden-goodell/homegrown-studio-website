/**
 * Host roster endpoint: headcount arithmetic with duplicate children.
 * The `summary.people` numerator is attending-filtered, so the duplicate
 * subtraction must also count duplicates over ATTENDING children only —
 * a duplicate child who is NOT attending must not discount the headcount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetPartyRecord = vi.fn()
const mockListWaiversByParty = vi.fn()
const mockGetCheckin = vi.fn()

vi.mock('@lib/party-store', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getPartyRecord: (...args: any[]) => mockGetPartyRecord(...args),
  hostTokenValid: (party: any, key: string) => !!party && key === 'good-key',
}))

vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    // Keep the REAL markDuplicateChildren — its interaction with the
    // attending filter is exactly what's under test.
    listWaiversByParty: (...args: any[]) => mockListWaiversByParty(...args),
  }
})

vi.mock('@lib/checkin-store', () => ({
  getCheckin: (...args: any[]) => mockGetCheckin(...args),
}))

function makeWaiver(id: string, firstName: string, minors: { name: string }[]) {
  return {
    id,
    signedAt: `2026-08-01T00:00:0${id.length % 10}.000Z`,
    adult: { firstName, lastName: 'Test', email: `${firstName}@x.com`, phone: '', dob: '1990-01-01', allergies: '' },
    minors: minors.map((m) => ({ name: m.name, dob: '2018-01-01', allergies: '' })),
  }
}

describe('GET /api/party/roster.json — host headcount with duplicate children', () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetPartyRecord.mockResolvedValue({
      bookingId: 'party-1',
      craftName: 'Suncatchers',
      startIso: '2026-09-05T14:00:00.000Z',
      durationMinutes: 120,
      hostName: 'Alice Test',
      guestCount: 10,
      title: null,
    })
    const mod = await import('@pages/api/party/roster.json')
    GET = mod.GET
  })

  it('does not double-discount when the duplicate child is NOT attending', async () => {
    // Household A: Alice + Emma, both attending (2 people).
    // Household B: Bea + Emma (duplicate name), but B's Emma is UNCHECKED (1 person).
    // Correct headcount: 2 + 1 = 3 — B's non-attending duplicate must not subtract.
    const wA = makeWaiver('wvr_a', 'Alice', [{ name: 'Emma' }])
    const wB = makeWaiver('wvr_b', 'Bea', [{ name: 'Emma' }])
    mockListWaiversByParty.mockResolvedValue([wA, wB])
    mockGetCheckin.mockImplementation(async (_partyId: string, recordId: string) => ({
      expected: recordId === 'wvr_a' ? ['adult', 'child:0'] : ['adult'],
      presence: {}, pickedUpBy: null, confirmedPickup: [], pickupCodeHash: null, events: [],
    }))

    const url = new URL('http://localhost/api/party/roster.json?party=party-1&key=good-key')
    const res = await GET({ url } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.summary.people).toBe(3)
    expect(json.data.summary.households).toBe(2)
  })

  it('still subtracts a duplicate child who IS attending in both households', async () => {
    // Both Emmas attending → 2 + 2 = 4 people minus 1 duplicate = 3.
    const wA = makeWaiver('wvr_a', 'Alice', [{ name: 'Emma' }])
    const wB = makeWaiver('wvr_b', 'Bea', [{ name: 'Emma' }])
    mockListWaiversByParty.mockResolvedValue([wA, wB])
    mockGetCheckin.mockResolvedValue({
      expected: ['adult', 'child:0'],
      presence: {}, pickedUpBy: null, confirmedPickup: [], pickupCodeHash: null, events: [],
    })

    const url = new URL('http://localhost/api/party/roster.json?party=party-1&key=good-key')
    const res = await GET({ url } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.summary.people).toBe(3)
  })
})

describe('GET /api/party/roster.json — our party records (stage 2)', () => {
  let GET: any
  const ours = (over: Record<string, unknown> = {}) => ({
    bookingId: 'pty_0000000000000001', hostToken: 'good-key', craftName: 'Suncatchers', startIso: '2026-12-05T20:00:00.000Z', durationMinutes: 90,
    hostName: 'Alice Test', hostEmail: 'a@x.com', guestCount: 10, title: null, dropOff: false, createdAt: '2026-11-01T00:00:00Z',
    source: 'ours', status: 'booked', endIso: '2026-12-05T22:00:00.000Z', payToken: 'paykey', calendarSeq: 2,
    items: [
      { id: 'itm_p', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: '', by: null },
      { id: 'itm_x', kind: 'addon', refId: 'add_time', label: 'Extra half hour', qty: 1, unitCents: 5000, cents: 5000, extraMinutes: 30, chargeId: null, addedAt: '', by: null },
    ],
    charges: [], refunds: [],
    ...over,
  })
  const load = async () => (await GET({ url: new URL('http://localhost/api/party/roster.json?party=pty_0000000000000001&key=good-key') } as any)).json()

  beforeEach(async () => {
    vi.clearAllMocks()
    mockListWaiversByParty.mockResolvedValue([])
    GET = (await import('@pages/api/party/roster.json')).GET
  })

  it('the end includes extra time; the calendar sequence comes along', async () => {
    mockGetPartyRecord.mockResolvedValue(ours())
    const { data } = await load()
    expect(data.party).toMatchObject({ endIso: '2026-12-05T22:00:00.000Z', cancelled: false, calendarSeq: 2 })
  })

  it('studio fee and an extra due: the host’s pay link names them (never crafts)', async () => {
    mockGetPartyRecord.mockResolvedValue(ours())
    const { data } = await load()
    expect(data.party.pay).toEqual({ cents: 35000, what: 'the studio fee and Extra half hour', url: 'http://localhost/party/pay/pty_0000000000000001?k=paykey' })
  })

  it('paid in full: no pay link', async () => {
    const rec = ours()
    mockGetPartyRecord.mockResolvedValue({ ...rec, items: (rec.items as any[]).map((it) => ({ ...it, chargeId: 'chg_1' })) })
    expect((await load()).data.party.pay).toBeNull()
  })

  it('cancelled: says so and never offers a payment', async () => {
    mockGetPartyRecord.mockResolvedValue(ours({ status: 'cancelled' }))
    const { data } = await load()
    expect(data.party.cancelled).toBe(true)
    expect(data.party.pay).toBeNull()
  })

  it('a party booked in Square: no pay link, its end from its length', async () => {
    mockGetPartyRecord.mockResolvedValue({ bookingId: 'party-1', craftName: 'Suncatchers', startIso: '2026-09-05T14:00:00.000Z', durationMinutes: 120, hostName: 'Alice Test', guestCount: 10, title: null })
    const { data } = await GET({ url: new URL('http://localhost/api/party/roster.json?party=party-1&key=good-key') } as any).then((r: Response) => r.json())
    expect(data.party.pay).toBeNull()
    expect(data.party.endIso).toBe('2026-09-05T16:00:00.000Z')
  })
})
