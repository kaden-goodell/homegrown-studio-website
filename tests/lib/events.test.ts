import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const partyFixture = { bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true }

const mockListParties = vi.fn(async () => [partyFixture])
const partyById = vi.hoisted(() => new Map<string, any>())
vi.mock('@lib/party-store', async (orig) => ({
  ...(await orig<any>()),
  getPartyRecord: vi.fn(async (id: string) => (id === 'p1' ? partyFixture : partyById.get(id) ?? null)),
  listParties: (...a: any[]) => (mockListParties as any)(...a),
}))

// Parties booked in Square (no record of ours): what the read-only Square reader answers.
const legacy = vi.hoisted(() => ({ list: [] as any[], fail: false, byId: new Map<string, any>(), asked: [] as string[][] }))
vi.mock('@lib/parties/legacy-square', () => ({
  legacyStaffParties: async (fromIso: string, toIso: string) => {
    legacy.asked.push([fromIso, toIso])
    if (legacy.fail) throw new Error('Square down')
    return legacy.list
  },
  legacyStaffParty: async (id: string) => legacy.byId.get(id) ?? null,
}))

// A fixed clock (Thu Oct 15 2026, noon in the studio): nothing here depends on
// the real date. The lists below are built from it, and each test pins Date to it.
const { NOW, TODAY, STARTED_2H_AGO_ISO, CAMP_STARTED_3D_AGO_ISO } = vi.hoisted(() => {
  const NOW = new Date('2026-10-15T17:00:00.000Z')
  return {
    NOW,
    TODAY: '2026-10-15',
    STARTED_2H_AGO_ISO: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    CAMP_STARTED_3D_AGO_ISO: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  }
})

// Our own classes: the class store and seat ledger answer from fixtures.
const own = vi.hoisted(() => ({ classes: [] as any[], ledgers: new Map<string, any>(), fail: false }))
vi.mock('@lib/classes/class-store', () => ({
  getClass: async (id: string) => own.classes.find((c) => c.id === id) ?? null,
  listClasses: async (range?: { fromIso: string; toIso: string }) => {
    if (own.fail) throw new Error('blobs down')
    return own.classes.filter((c) => !range || c.sessions.some((s: any) => s.startIso < range.toIso && s.endIso > range.fromIso))
  },
}))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/seat-ledger')>()),
  getLedger: async (classId: string) => own.ledgers.get(classId) ?? { classId, lines: [] },
}))

// Two workshops: one bookable, one SOLD OUT. `listWorkshops` filters the full
// one out (that's Square's own behavior) — only `getWorkshop` can see it, so
// this fixture is what C2 is about. `listAllWorkshops` is the wide,
// unfiltered listing `cachedWorkshopList` now prefers (HOM in-progress fix).
const mockListWorkshops = vi.fn()
const mockGetWorkshop = vi.fn()
const mockListAllWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    workshop: {
      listWorkshops: (...a: any[]) => mockListWorkshops(...a),
      getWorkshop: (...a: any[]) => mockGetWorkshop(...a),
      listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a),
    },
  },
}))
vi.mock('@lib/event-meta', () => ({
  getEventMeta: vi.fn(async (_kind: string, id: string) => {
    if (id === 'cs1') return { dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] }
    if (id === 'cs-camp') return { dropOff: false, days: [TODAY], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] }
    return null
  }),
}))

const WORKSHOPS = [
  { id: 'inst-cs1', scheduleId: 'cs1', name: 'Macramé', startAt: '2026-10-21T04:30:00.000Z', availableCapacity: 8 },
  { id: 'inst-pno', scheduleId: 'cs-pno', name: 'Parents Night Out', startAt: '2026-10-23T23:00:00.000Z', availableCapacity: 0 },
  // Already in progress, no event-meta override — resolves via getEvent and
  // is listed via `listAllWorkshops` even though it started in the past.
  { id: 'inst-started', scheduleId: 'cs-started', name: 'Pottery Wheel', startAt: STARTED_2H_AGO_ISO, availableCapacity: 4 },
  // A multi-day camp we're on a later day of — event-meta says `days`
  // includes today, so it's listed on today even though startAt is 3 days
  // in the past.
  { id: 'inst-camp', scheduleId: 'cs-camp', name: 'Summer Camp', startAt: CAMP_STARTED_3D_AGO_ISO, availableCapacity: 2 },
]

let getEvent: typeof import('@lib/events').getEvent
let listEvents: typeof import('@lib/events').listEvents
let eventKey: typeof import('@lib/events').eventKey
let eventOnDay: typeof import('@lib/events').eventOnDay

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  own.classes = []; own.ledgers.clear(); own.fail = false
  legacy.list = []; legacy.fail = false; legacy.byId.clear(); legacy.asked = []
  // The module caches the workshop list for a minute — reset it between tests
  // so one test's list doesn't leak into the next.
  vi.resetModules()
  mockListParties.mockResolvedValue([partyFixture])
  mockListWorkshops.mockImplementation(async () => WORKSHOPS.filter((w) => w.availableCapacity > 0))
  mockListAllWorkshops.mockImplementation(async () => WORKSHOPS)
  mockGetWorkshop.mockImplementation(async (id: string) => WORKSHOPS.find((w) => w.id === id || w.scheduleId === id) ?? null)
  ;({ getEvent, listEvents, eventKey, eventOnDay } = await import('@lib/events'))
})

afterEach(() => vi.useRealTimers())

describe('events', () => {
  it('party falls back to the record dropOff and derives days in studio TZ', async () => {
    const e = await getEvent('party', 'p1'); expect(e).toMatchObject({ kind: 'party', dropOff: true, days: ['2026-10-20'] })
  })
  it('workshop merges meta (dropOff, multi-day) and is listed on each of its days', async () => {
    const e = await getEvent('workshop', 'cs1'); expect(e).toMatchObject({ title: 'Macramé', dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'] })
    expect((await listEvents({ from: '2026-10-22', to: '2026-10-22' })).events.map(x => x.id)).toEqual(['cs1'])
    expect((await listEvents({ from: '2026-10-20', to: '2026-10-20' })).events.map(x => x.id).sort()).toEqual(['cs1', 'p1'])
  })
  it('a 11:30pm UTC start is the previous studio day', async () => {
    // 2026-10-21T04:30Z = Oct 20 11:30pm CDT
    const e = await getEvent('workshop', 'cs1'); expect(e!.startIso).toBe('2026-10-21T04:30:00.000Z')
  })
  it('eventKey keeps party ids bare (legacy) and namespaces the rest', () => {
    expect(eventKey('party', 'p1')).toBe('p1'); expect(eventKey('workshop', 'cs1')).toBe('workshop:cs1')
  })

  it('C2: a SOLD-OUT workshop still resolves by scheduleId', async () => {
    const e = await getEvent('workshop', 'cs-pno')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-pno', title: 'Parents Night Out' })
    expect(mockGetWorkshop).toHaveBeenCalledWith('cs-pno')
  })

  it('C2: a genuinely unknown workshop id is still null', async () => {
    expect(await getEvent('workshop', 'nope')).toBeNull()
  })

  it('C2: falls back to the active list when the provider has no getWorkshop', async () => {
    mockGetWorkshop.mockImplementation(() => { throw new Error('not implemented') })
    const e = await getEvent('workshop', 'cs1')
    expect(e).toMatchObject({ id: 'cs1', title: 'Macramé' })
  })

  it('a class that already started (no meta) still resolves via getEvent, on today', async () => {
    const e = await getEvent('workshop', 'cs-started')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-started', title: 'Pottery Wheel', days: [TODAY] })
  })

  it('a class that already started is listed on today by listEvents (staff Today list)', async () => {
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((e) => e.id)).toContain('cs-started')
  })

  it('a multi-day camp on a later day still resolves and lists on today via its event-meta days', async () => {
    const e = await getEvent('workshop', 'cs-camp')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-camp', days: [TODAY] })
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((x) => x.id)).toContain('cs-camp')
  })

  it('listEvents prefers listAllWorkshops (wide) over listWorkshops (future-only public) when both exist', async () => {
    mockListAllWorkshops.mockImplementation(async () => [
      { id: 'inst-only-in-all', scheduleId: 'cs-only-in-all', name: 'Wide-only', startAt: STARTED_2H_AGO_ISO, availableCapacity: 1 },
    ])
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((e) => e.id)).toEqual(['cs-only-in-all'])
    expect(mockListWorkshops).not.toHaveBeenCalled()
  })
})

describe('listEvents source isolation (F2)', () => {
  it('reports both sources ok on the happy path', async () => {
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id).sort()).toEqual(['cs1', 'p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'ok', classes: 'ok' })
  })

  it('a Square outage still returns the parties, flagged workshops: error', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('fetch failed'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id)).toEqual(['p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'error', classes: 'ok' })
  })

  it('a Blobs outage still returns the workshops, flagged parties: error', async () => {
    mockListParties.mockRejectedValue(new Error('blobs down'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id)).toEqual(['cs1'])
    expect(sources).toEqual({ parties: 'error', workshops: 'ok', classes: 'ok' })
  })

  it('both sources down returns nothing and flags both', async () => {
    mockListParties.mockRejectedValue(new Error('blobs down'))
    mockListAllWorkshops.mockRejectedValue(new Error('fetch failed'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events).toEqual([])
    expect(sources).toEqual({ parties: 'error', workshops: 'error', classes: 'ok' })
  })
  it('carries a class’s seat questions, cutoff and capacity', async () => {
    const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
    const { getEventMeta } = await import('@lib/event-meta')
    vi.mocked(getEventMeta).mockResolvedValueOnce({ dropOff: false, days: null, options: [PAILS], signupCutoffHours: 48, updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } as any)
    mockGetWorkshop.mockResolvedValueOnce({ ...WORKSHOPS[1], totalCapacity: 25 })
    expect(await getEvent('workshop', 'cs-pno')).toMatchObject({ options: [PAILS], signupCutoffHours: 48, capacity: 25 })
  })

  it('takes the capacity from the class’s settings when Square doesn’t say, and Square wins when it does', async () => {
    const { getEventMeta } = await import('@lib/event-meta')
    const meta = { dropOff: false, days: null, options: [], signupCutoffHours: null, capacity: 12, updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } as any
    vi.mocked(getEventMeta).mockResolvedValueOnce(meta)
    mockGetWorkshop.mockResolvedValueOnce({ ...WORKSHOPS[1] })
    expect((await getEvent('workshop', 'cs-pno'))?.capacity).toBe(12)
    vi.mocked(getEventMeta).mockResolvedValueOnce(meta)
    mockGetWorkshop.mockResolvedValueOnce({ ...WORKSHOPS[1], totalCapacity: 25 })
    expect((await getEvent('workshop', 'cs-pno'))?.capacity).toBe(25)
  })

  it('leaves the capacity out when neither knows it', async () => {
    mockGetWorkshop.mockResolvedValueOnce({ ...WORKSHOPS[1] })
    expect(await getEvent('workshop', 'cs-pno')).not.toHaveProperty('capacity')
  })

  it('a party never asks seat questions', async () => {
    expect(await getEvent('party', 'p1')).toMatchObject({ options: [], signupCutoffHours: null })
  })
})

describe('our own classes (Task 14)', () => {
  const rules = { ages: '', dropOff: true, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false }
  // A three-day camp, 10 AM–noon studio time on Mon 19, Tue 20, Wed 21 October.
  const camp = {
    id: 'cls_camp1', libraryId: null, libraryVersion: null, status: 'open',
    content: {
      name: 'Clay Camp', description: '', imageUrl: null, instructor: null, rules,
      ticketTypes: [{ id: 'person', label: 'Person' }],
      passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }],
      prices: { all: { person: 9000 }, day: { person: 3500 } },
      questions: [{ id: 'glaze', label: 'Glaze', choices: ['Blue', 'Green'] }], addOns: [], defaultCapacity: 2, defaultMinutes: 120,
    },
    sessions: [
      { id: 'ses_m', startIso: '2026-10-19T15:00:00.000Z', endIso: '2026-10-19T17:00:00.000Z', capacity: 2 },
      { id: 'ses_t', startIso: '2026-10-20T15:00:00.000Z', endIso: '2026-10-20T17:00:00.000Z', capacity: 2 },
      { id: 'ses_w', startIso: '2026-10-21T15:00:00.000Z', endIso: '2026-10-21T17:00:00.000Z', capacity: 2 },
    ],
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
  }
  const seat = (id: string, sessionIds: string[], over: Record<string, any> = {}) => ({
    id, bookingId: `bkg_${id}`, sessionIds, ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 0, taxCents: 0,
    addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null,
    customer: null, square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: '', ...over,
  })
  beforeEach(() => {
    own.classes = [camp]
    own.ledgers.set('cls_camp1', { classId: 'cls_camp1', lines: [
      seat('led_1', ['ses_m', 'ses_t', 'ses_w']),
      seat('led_2', ['ses_t']),
      seat('led_3', ['ses_t']), // Tuesday is oversold: 3 of 2
    ] })
  })

  it('getEvent resolves a cls_ id from our class store, never Square', async () => {
    const e = await getEvent('workshop', 'cls_camp1')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cls_camp1', title: 'Clay Camp', dropOff: true, own: true, days: ['2026-10-19', '2026-10-20', '2026-10-21'] })
    expect(e!.options).toEqual([{ id: 'glaze', label: 'Glaze', choices: ['Blue', 'Green'] }])
    expect(mockGetWorkshop).not.toHaveBeenCalled()
    expect(await getEvent('workshop', 'cls_nope')).toBeNull()
  })

  it('a draft or cancelled class is not on the console', async () => {
    own.classes = [{ ...camp, status: 'draft' }]
    expect(await getEvent('workshop', 'cls_camp1')).toBeNull()
    own.classes = [{ ...camp, status: 'cancelled' }]
    expect((await listEvents({ from: '2026-10-19', to: '2026-10-21' })).events.some((e) => e.id === 'cls_camp1')).toBe(false)
  })

  it('a multi-day class is listed on each of its days, each day with its own seats', async () => {
    for (const [day, sold] of [['2026-10-19', 1], ['2026-10-20', 3], ['2026-10-21', 1]] as const) {
      const { events } = await listEvents({ from: day, to: day })
      const e = events.find((x) => x.id === 'cls_camp1')!
      expect(e).toBeTruthy()
      const onDay = eventOnDay(e, day)
      expect(onDay.capacity! - onDay.seats!).toBe(sold)
      expect(onDay.capacity).toBe(2)
    }
    expect((await listEvents({ from: '2026-10-22', to: '2026-10-22' })).events.some((e) => e.id === 'cls_camp1')).toBe(false)
  })

  it('every session carries its day and seats', async () => {
    const e = await getEvent('workshop', 'cls_camp1')
    expect(e!.sessions!.map((s) => [s.day, s.sold, s.capacity])).toEqual([['2026-10-19', 1, 2], ['2026-10-20', 3, 2], ['2026-10-21', 1, 2]])
  })

  it('a class store outage still lists the rest, flagged classes: error', async () => {
    own.fail = true
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id).sort()).toEqual(['cs1', 'p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'ok', classes: 'error' })
  })
})

describe('our party records (stage 2 Task 13)', () => {
  const item = (chargeId: string | null) => ({ id: 'itm_p', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId, addedAt: '', by: null })
  const ours = (id: string, over: Record<string, unknown> = {}) => ({
    bookingId: id, title: null, craftName: 'Slime', startIso: '2026-10-17T19:00:00.000Z', durationMinutes: 90, dropOff: false, guestCount: 12,
    source: 'ours', status: 'booked', endIso: '2026-10-17T21:00:00.000Z', items: [item('chg_1')], ...over,
  })

  it('a cancelled party is not on any day’s list (This week, the door list)', async () => {
    mockListParties.mockResolvedValue([ours('pty_a'), ours('pty_b', { status: 'cancelled' })] as any)
    const { events } = await listEvents({ from: '2026-10-17', to: '2026-10-17' })
    expect(events.filter((e) => e.kind === 'party').map((e) => e.id)).toEqual(['pty_a'])
  })

  it('the end includes extra time; a party with something to pay says "waiting on payment"', async () => {
    mockListParties.mockResolvedValue([ours('pty_a', { items: [item(null)] }), ours('pty_b', { startIso: '2026-10-17T15:00:00.000Z', endIso: undefined })] as any)
    const { events } = await listEvents({ from: '2026-10-17', to: '2026-10-17' })
    const a = events.find((e) => e.id === 'pty_a')!
    const b = events.find((e) => e.id === 'pty_b')!
    expect(a).toMatchObject({ endIso: '2026-10-17T21:00:00.000Z', waitingOnPayment: true })
    expect(b.endIso).toBe('2026-10-17T16:30:00.000Z') // no saved end: start + its length
    expect(b.waitingOnPayment).toBeUndefined()
  })

  it('getEvent still finds a cancelled party (staff and refunds) and marks it', async () => {
    partyById.set('pty_c', ours('pty_c', { status: 'cancelled' }))
    expect(await getEvent('party', 'pty_c')).toMatchObject({ cancelled: true })
  })
})

describe('booked parties on the staff lists (2 Nov 2026)', () => {
  const sq = (id: string, startIso: string, hostName?: string) => ({ kind: 'party', id, label: 'a party', startIso, endIso: new Date(Date.parse(startIso) + 90 * 60_000).toISOString(), ...(hostName ? { hostName } : {}) })

  it('a party booked in Square with no record of ours is listed on its day, tagged, by the host’s last name', async () => {
    legacy.list = [sq('sq_bk1', '2026-10-20T19:00:00.000Z', 'Jamie Rivera'), sq('sq_bk2', '2026-10-20T22:00:00.000Z')]
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.filter((e) => e.kind === 'party').map((e) => [e.id, e.title, !!e.squareBooked])).toEqual([
      ['p1', 'Rivera Party', false], ['sq_bk1', 'Rivera Party', true], ['sq_bk2', 'Party', true],
    ])
    expect(events.find((e) => e.id === 'sq_bk1')).toMatchObject({ days: ['2026-10-20'], endIso: '2026-10-20T20:30:00.000Z', dropOff: false })
    expect(sources.squareParties).toBeUndefined()
    // Asked for the whole studio day (CDT).
    expect(legacy.asked[0]).toEqual(['2026-10-20T05:00:00.000Z', expect.stringMatching(/^2026-10-21T0[45]:/)])
  })

  it('a Square party we hold a record for shows once (ours), and one cancelled here never shows', async () => {
    const cancelled = { bookingId: 'sq_gone', title: 'Gone Party', craftName: 'Slime', startIso: '2026-10-20T21:00:00.000Z', dropOff: false, source: 'ours', status: 'cancelled' }
    mockListParties.mockResolvedValue([partyFixture, cancelled] as any)
    legacy.list = [sq('p1', '2026-10-20T15:00:00.000Z'), sq('sq_gone', '2026-10-20T21:00:00.000Z')]
    const { events } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.filter((e) => e.kind === 'party').map((e) => e.id)).toEqual(['p1'])
  })

  it('Square down: our parties and classes still list, and the console is told in one line', async () => {
    legacy.fail = true
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id).sort()).toEqual(['cs1', 'p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'ok', classes: 'ok', squareParties: 'error' })
  })

  it('our party list down: Square parties are left out too (they could double up with ours)', async () => {
    mockListParties.mockRejectedValue(new Error('blobs down'))
    legacy.list = [sq('sq_bk1', '2026-10-20T19:00:00.000Z')]
    const { events } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.some((e) => e.kind === 'party')).toBe(false)
  })

  it('Square is asked once a minute per window, not on every reload', async () => {
    await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(legacy.asked).toHaveLength(1)
    vi.setSystemTime(new Date(NOW.getTime() + 61_000))
    await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(legacy.asked).toHaveLength(2)
  })

  it('a Square-booked party’s roster opens by its Square id; anything else unknown is null', async () => {
    legacy.byId.set('sq_bk1', sq('sq_bk1', '2026-10-20T19:00:00.000Z', 'Jamie Rivera'))
    expect(await getEvent('party', 'sq_bk1')).toMatchObject({ kind: 'party', id: 'sq_bk1', title: 'Rivera Party', squareBooked: true, days: ['2026-10-20'] })
    expect(await getEvent('party', 'sq_nope')).toBeNull()
  })
})
