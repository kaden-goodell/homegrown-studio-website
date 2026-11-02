import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))

// R41 tests play a deploy preview with no store of its own; everything else plays local dev.
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

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

// ---------------------------------------------------------------- stage 3: contacts, last-known team, owner mapping
import {
  teamWithContacts, isActiveStaffId, staffIdForOwner, FALLBACK_IDS, _resetLastKnownForTests,
} from '@lib/staff-directory'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'k@example.com', phoneNumber: '+12565550100' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: '', phoneNumber: undefined },
  { id: 'TM2', givenName: 'Emma', familyName: 'R', status: 'ACTIVE', isOwner: false, emailAddress: 'emma@example.com' },
  { id: 'TM3', givenName: 'Gone', familyName: 'Person', status: 'INACTIVE', isOwner: false, emailAddress: 'gone@example.com' },
]

describe('teamWithContacts', () => {
  beforeEach(async () => {
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockReset()
    searchMock.mockResolvedValue({ teamMembers: TEAM })
  })

  it('maps contact fields from the Square shape and leaves inactive members out', async () => {
    const { people, source } = await teamWithContacts()
    expect(source).toBe('square')
    expect(people).toEqual([
      { id: 'TM1', name: 'Kaden', givenName: 'Kaden', role: 'owner', email: 'k@example.com', phone: '+12565550100', active: true },
      { id: 'TM4', name: 'Catherine', givenName: 'Catherine', role: 'owner', email: null, phone: null, active: true },
      { id: 'TM2', name: 'Emma', givenName: 'Emma', role: 'crew', email: 'emma@example.com', phone: null, active: true },
    ])
  })

  it('uses the last-known team when Square fails after once answering', async () => {
    await teamWithContacts()
    _resetStaffCache()
    searchMock.mockRejectedValue(new Error('square down'))
    const { people, source } = await teamWithContacts()
    expect(source).toBe('last-known')
    expect(people.map((p) => p.id)).toEqual(['TM1', 'TM4', 'TM2'])
  })

  it('throws when Square fails and there is no saved copy', async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    await expect(teamWithContacts()).rejects.toThrow()
  })

  it('treats an empty active list as a failure (last-known, or throw)', async () => {
    searchMock.mockResolvedValue({ teamMembers: [] })
    await expect(teamWithContacts()).rejects.toThrow()
  })

  it('keeps listStaff output unchanged: no email or phone in it', async () => {
    const list = await listStaff()
    expect(list).toEqual([
      { id: 'TM1', name: 'Kaden', role: 'owner' },
      { id: 'TM4', name: 'Catherine', role: 'owner' },
      { id: 'TM2', name: 'Emma', role: 'crew' },
    ])
    for (const m of list) {
      expect(m).not.toHaveProperty('email')
      expect(m).not.toHaveProperty('phone')
    }
  })

  it('shares one Square call between listStaff and teamWithContacts', async () => {
    await listStaff()
    await teamWithContacts()
    expect(searchMock).toHaveBeenCalledTimes(1)
  })
})

describe('isActiveStaffId — fallback never keys data', () => {
  beforeEach(async () => {
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockReset()
    searchMock.mockResolvedValue({ teamMembers: TEAM })
  })

  it('is true for an active id and false for inactive or unknown ones', async () => {
    expect(await isActiveStaffId('TM2')).toBe(true)
    expect(await isActiveStaffId('TM3')).toBe(false)
    expect(await isActiveStaffId('nobody')).toBe(false)
    expect(await isActiveStaffId('')).toBe(false)
  })

  it("is false for 'kaden' and 'catherine' even while listStaff answers with the fallback", async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    expect((await listStaff()).map((m) => m.id)).toEqual(['kaden', 'catherine'])
    expect(FALLBACK_IDS.has('kaden')).toBe(true)
    expect(FALLBACK_IDS.has('catherine')).toBe(true)
    expect(await isActiveStaffId('kaden')).toBe(false)
    expect(await isActiveStaffId('catherine')).toBe(false)
  })

  it('answers from the last-known team while Square is down', async () => {
    await teamWithContacts()
    _resetStaffCache()
    searchMock.mockRejectedValue(new Error('square down'))
    expect(await isActiveStaffId('TM2')).toBe(true)
    expect(await isActiveStaffId('kaden')).toBe(false)
  })

  it('is false (never throws) when Square is down and nothing is saved', async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    expect(await isActiveStaffId('TM2')).toBe(false)
  })
})

describe('staffIdForOwner', () => {
  beforeEach(async () => {
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockReset()
    searchMock.mockResolvedValue({ teamMembers: TEAM })
  })

  it('finds the owner whose given name matches', async () => {
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
    expect(await staffIdForOwner('Kaden')).toBe('TM1')
  })

  it('ignores crew who share the given name', async () => {
    searchMock.mockResolvedValue({ teamMembers: [...TEAM, { id: 'TM9', givenName: 'Catherine', familyName: 'Smith', status: 'ACTIVE', isOwner: false }] })
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
  })

  it('is null when two owners share the given name', async () => {
    searchMock.mockResolvedValue({ teamMembers: [...TEAM, { id: 'TM8', givenName: 'Catherine', familyName: 'Other', status: 'ACTIVE', isOwner: true }] })
    expect(await staffIdForOwner('Catherine')).toBeNull()
  })

  it('is null when no owner has the name, or the team cannot be read', async () => {
    searchMock.mockResolvedValue({ teamMembers: TEAM.filter((m) => m.id !== 'TM4') })
    expect(await staffIdForOwner('Catherine')).toBeNull()
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockRejectedValue(new Error('square down'))
    expect(await staffIdForOwner('Kaden')).toBeNull()
  })
})

describe('a Square failure is remembered for a minute (M3)', () => {
  beforeEach(async () => {
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockReset()
    searchMock.mockResolvedValue({ teamMembers: TEAM })
  })

  it('goes straight to the saved team for a minute, then asks Square again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-01T15:00:00.000Z'))
      await teamWithContacts()
      _resetStaffCache() // forget the good answer; the saved copy stays
      vi.setSystemTime(new Date('2026-11-01T15:20:00.000Z'))
      searchMock.mockReset()
      searchMock.mockRejectedValue(new Error('square down'))
      expect((await teamWithContacts()).source).toBe('last-known')
      expect((await teamWithContacts()).source).toBe('last-known')
      expect(await isActiveStaffId('TM2')).toBe(true)
      expect(searchMock).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-11-01T15:21:01.000Z'))
      searchMock.mockResolvedValue({ teamMembers: TEAM })
      expect((await teamWithContacts()).source).toBe('square')
      expect(searchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('R41: the last-known team on a test site sharing the live stores', () => {
  beforeEach(async () => {
    _resetStaffCache()
    await _resetLastKnownForTests()
    searchMock.mockReset()
    searchMock.mockResolvedValue({ teamMembers: TEAM })
  })

  it('is never written there (a sandbox team must not replace the live one)', async () => {
    const prevNs = process.env.STORE_NAMESPACE
    delete process.env.STORE_NAMESPACE
    site.context = 'deploy-preview'
    try {
      expect((await teamWithContacts()).source).toBe('square')
    } finally {
      site.context = 'dev'
      if (prevNs !== undefined) process.env.STORE_NAMESPACE = prevNs
    }
    // Nothing was saved: with Square down there is no copy to fall back on.
    _resetStaffCache()
    searchMock.mockRejectedValue(new Error('square down'))
    await expect(teamWithContacts()).rejects.toThrow()
  })
})
