import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))

vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ teamMembers: { search: searchMock } }),
}))

import { listStaff, _resetStaffCache } from '@lib/staff-directory'

describe('listStaff', () => {
  beforeEach(() => {
    _resetStaffCache()
    searchMock.mockReset()
    searchMock.mockResolvedValue({
      teamMembers: [
        { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
        { id: 'TM2', givenName: 'Emma', familyName: 'R', status: 'ACTIVE', isOwner: false },
        { id: 'TM3', givenName: 'Gone', familyName: 'Person', status: 'INACTIVE' },
      ],
    })
  })

  it('maps active Square members; owners flagged', async () => {
    expect(await listStaff()).toEqual([
      { id: 'TM1', name: 'Kaden', role: 'owner' },
      { id: 'TM2', name: 'Emma', role: 'crew' },
    ])
  })

  it('appends a family initial when two members share a given name', async () => {
    searchMock.mockResolvedValue({
      teamMembers: [
        { id: 'TM1', givenName: 'Sam', familyName: 'Adams', status: 'ACTIVE', isOwner: true },
        { id: 'TM2', givenName: 'Sam', familyName: 'Brown', status: 'ACTIVE', isOwner: false },
      ],
    })
    expect(await listStaff()).toEqual([
      { id: 'TM1', name: 'Sam A.', role: 'owner' },
      { id: 'TM2', name: 'Sam B.', role: 'crew' },
    ])
  })

  it('caches the roster for 10 minutes', async () => {
    await listStaff()
    await listStaff()
    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the owner roster when Square errors', async () => {
    searchMock.mockRejectedValue(new Error('boom'))
    expect(await listStaff()).toEqual([
      { id: 'kaden', name: 'Kaden', role: 'owner' },
      { id: 'catherine', name: 'Catherine', role: 'owner' },
    ])
  })

  it('falls back to the owner roster when Square returns no active members', async () => {
    searchMock.mockResolvedValue({ teamMembers: [] })
    expect(await listStaff()).toEqual([
      { id: 'kaden', name: 'Kaden', role: 'owner' },
      { id: 'catherine', name: 'Catherine', role: 'owner' },
    ])
  })
})
