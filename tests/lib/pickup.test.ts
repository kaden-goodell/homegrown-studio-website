import { describe, it, expect, vi, beforeEach } from 'vitest'

// latest RSVP pickup per waiver id
const latestById: Record<string, any> = {}
const mockLatest = vi.fn(async (id: string) => latestById[id] ?? null)
vi.mock('@lib/rsvp-store', () => ({ getLatestPickupForWaiver: (id: string) => mockLatest(id) }))
const mockLookup = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/waiver-store')>()),
  lookupHouseholdEntry: (...a: any[]) => mockLookup(...a),
}))

import { effectivePickup, sameHousehold, hasPickupContent } from '@lib/pickup'

const subject = (over: Record<string, any> = {}) => ({
  id: 'wvr_old', authorizedPickup: [] as any, notAuthorized: '', signedAt: '2026-01-01T00:00:00.000Z',
  adult: { email: 'sam@x.com', firstName: 'Sam', lastName: 'Lee' }, ...over,
})
const pk = (name: string, na = '', at = '2026-02-01T00:00:00.000Z') => ({ authorizedPickup: name ? [{ name, phone: '' }] : [], notAuthorized: na, at })
const noAt = ({ at: _at, ...p }: any) => p

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(latestById)) delete latestById[k]
  mockLookup.mockResolvedValue(null)
})

describe('sameHousehold', () => {
  const a = { email: 'Sam@X.com ', firstName: 'Sam', lastName: 'Lee' }
  it('same email + same name (case/spacing-insensitive)', () => {
    expect(sameHousehold(a, { email: 'sam@x.com', firstName: ' sam', lastName: 'LEE  ' })).toBe(true)
    expect(sameHousehold({ ...a, firstName: 'Mary  Ann' }, { email: 'sam@x.com', firstName: 'mary ann', lastName: 'lee' })).toBe(true)
  })
  it('same email, different signer → not the same household', () => {
    expect(sameHousehold(a, { email: 'sam@x.com', firstName: 'Pat', lastName: 'Lee' })).toBe(false)
  })
  it('different email → not the same household (phone alone never matters)', () => {
    expect(sameHousehold(a, { email: 'other@x.com', firstName: 'Sam', lastName: 'Lee' })).toBe(false)
  })
  it('blank email never matches', () => {
    expect(sameHousehold({ ...a, email: '' }, { email: '', firstName: 'Sam', lastName: 'Lee' })).toBe(false)
  })
})

describe('hasPickupContent', () => {
  it('rows or a note', () => {
    expect(hasPickupContent(pk('A'))).toBe(true)
    expect(hasPickupContent(pk('', 'Rick'))).toBe(true)
    expect(hasPickupContent(pk('', '  '))).toBe(false)
    expect(hasPickupContent(null)).toBe(false)
  })
})

describe('effectivePickup', () => {
  it('newest RSVP pickup across ALL of this waiver\'s RSVPs (this event\'s included)', async () => {
    latestById.wvr_old = pk('Aunt Sue', 'Rick Smith')
    expect(noAt(await effectivePickup({ waiver: subject() }))).toEqual(noAt(pk('Aunt Sue', 'Rick Smith')))
  })

  it('no RSVP pickup → the waiver\'s own fields (legacy strings normalized)', async () => {
    const r = await effectivePickup({ waiver: subject({ authorizedPickup: 'Grandma, Uncle Joe', notAuthorized: 'Bio dad' }) })
    expect(r.notAuthorized).toBe('Bio dad')
    expect(r.authorizedPickup.map((p) => p.name)).toEqual(['Grandma', 'Uncle Joe'])
  })

  it('nothing at all → empty', async () => {
    expect(await effectivePickup({ waiver: subject() })).toEqual({ authorizedPickup: [], notAuthorized: '' })
  })

  it('a restriction typed on a RE-SIGN reaches an event booked under the OLD waiver id', async () => {
    latestById.wvr_old = pk('Grandma', '', '2026-02-01T00:00:00.000Z')
    mockLookup.mockResolvedValue({ recordId: 'wvr_new', email: 'sam@x.com', firstName: 'Sam', lastName: 'Lee', signedAt: '2026-05-01T00:00:00.000Z', authorizedPickup: [], notAuthorized: 'Rick Smith' })
    const r = await effectivePickup({ waiver: subject() })
    expect(r.notAuthorized).toBe('Rick Smith') // the re-sign's own field is newest
  })

  it('…and so does one typed on a newer RSVP under the new record', async () => {
    latestById.wvr_old = pk('Grandma', '', '2026-02-01T00:00:00.000Z')
    latestById.wvr_new = pk('', 'Pat Jones', '2026-06-01T00:00:00.000Z')
    mockLookup.mockResolvedValue({ recordId: 'wvr_new', email: 'sam@x.com', firstName: 'Sam', lastName: 'Lee', signedAt: '2026-05-01T00:00:00.000Z', authorizedPickup: [], notAuthorized: '' })
    expect((await effectivePickup({ waiver: subject() })).notAuthorized).toBe('Pat Jones')
  })

  it('a newer restriction on the OLD id still beats an older one on the new record', async () => {
    latestById.wvr_old = pk('', 'Newest', '2026-07-01T00:00:00.000Z')
    mockLookup.mockResolvedValue({ recordId: 'wvr_new', email: 'sam@x.com', firstName: 'Sam', lastName: 'Lee', signedAt: '2026-05-01T00:00:00.000Z', authorizedPickup: [], notAuthorized: 'Older' })
    expect((await effectivePickup({ waiver: subject() })).notAuthorized).toBe('Newest')
  })

  it('a DIFFERENT household sharing the email but not the name contributes nothing', async () => {
    latestById.wvr_other = pk('Their Aunt', 'Their Ex', '2026-09-01T00:00:00.000Z')
    mockLookup.mockResolvedValue({ recordId: 'wvr_other', email: 'sam@x.com', firstName: 'Pat', lastName: 'Kim', signedAt: '2026-09-01T00:00:00.000Z', authorizedPickup: [{ name: 'Their Aunt', phone: '' }], notAuthorized: 'Their Ex' })
    expect(await effectivePickup({ waiver: subject() })).toEqual({ authorizedPickup: [], notAuthorized: '' })
    expect(mockLatest).not.toHaveBeenCalledWith('wvr_other')
  })

  it('a failed current-record lookup just means nothing extra', async () => {
    latestById.wvr_old = pk('Grandma')
    mockLookup.mockRejectedValue(new Error('blob down'))
    expect((await effectivePickup({ waiver: subject() })).authorizedPickup.map((p) => p.name)).toEqual(['Grandma'])
  })
})
