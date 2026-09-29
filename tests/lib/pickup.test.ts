import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetRsvp = vi.fn()
const mockLatest = vi.fn()
vi.mock('@lib/rsvp-store', () => ({
  getRsvp: (...a: any[]) => mockGetRsvp(...a),
  getLatestPickupForWaiver: (...a: any[]) => mockLatest(...a),
}))

import { effectivePickup } from '@lib/pickup'

const waiver = (over: Record<string, any> = {}) => ({ id: 'wvr_1', authorizedPickup: [] as any, notAuthorized: '', ...over })
const pk = (name: string, na = '') => ({ authorizedPickup: name ? [{ name, phone: '' }] : [], notAuthorized: na })

beforeEach(() => { vi.clearAllMocks(); mockGetRsvp.mockResolvedValue(null); mockLatest.mockResolvedValue(null) })

describe('effectivePickup', () => {
  it('this event\'s RSVP pickup wins', async () => {
    mockGetRsvp.mockResolvedValue({ pickup: pk('Aunt Sue', 'Ex') })
    mockLatest.mockResolvedValue(pk('Old'))
    expect(await effectivePickup({ kind: 'workshop', id: 'B', waiver: waiver() })).toEqual(pk('Aunt Sue', 'Ex'))
  })
  it('an empty RSVP pickup is ignored → the household\'s latest RSVP pickup', async () => {
    mockGetRsvp.mockResolvedValue({ pickup: pk('', '') })
    mockLatest.mockResolvedValue(pk('', 'Rick Smith'))
    expect(await effectivePickup({ kind: 'workshop', id: 'B', waiver: waiver() })).toEqual(pk('', 'Rick Smith'))
  })
  it('no RSVP pickup anywhere → the waiver\'s own fields (legacy strings normalized)', async () => {
    const r = await effectivePickup({ kind: 'party', id: 'B', waiver: waiver({ authorizedPickup: 'Grandma, Uncle Joe', notAuthorized: 'Bio dad' }) })
    expect(r.notAuthorized).toBe('Bio dad')
    expect(r.authorizedPickup.map((p) => p.name)).toEqual(['Grandma', 'Uncle Joe'])
  })
  it('nothing at all → empty', async () => {
    expect(await effectivePickup({ kind: 'party', id: 'B', waiver: waiver() })).toEqual({ authorizedPickup: [], notAuthorized: '' })
  })
})
