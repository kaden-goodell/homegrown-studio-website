import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))

// R41 tests play a deploy preview with no store of its own; everything else plays local dev.
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ teamMembers: { search: searchMock } }),
}))

import {
  listStaff, teamWithContacts, isActiveStaffId, staffIdStatus, staffIdForOwner, FALLBACK_IDS,
  staffListForOwners, addPerson, editPerson, setWorking, startFresh, ensureCrewPerson, cleanPerson,
  _resetStaffCache, _expireStaffCacheForTests, _resetStaffListForTests, _setImportFailuresForTests, canStartFresh, STAFF_MESSAGES, IMPORT_FAILED, StaleStaffError,
} from '@lib/staff-directory'
import { NO_TEST_STORE } from '@lib/classes/test-site-guard'
import { makeKvStore } from '@lib/blob-store'

const BY = { id: 'owner-catherine', name: 'Catherine' }

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'k@example.com', phoneNumber: '+12565550100' },
  // Realistic: Square marks only its one account owner. Catherine is an owner here all the same.
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: '', phoneNumber: undefined },
  { id: 'TM2', givenName: 'Emma', familyName: 'R', status: 'ACTIVE', isOwner: false, emailAddress: 'emma@example.com' },
  { id: 'TM3', givenName: 'Gone', familyName: 'Person', status: 'INACTIVE', isOwner: false, emailAddress: 'gone@example.com' },
]

beforeEach(async () => {
  site.context = 'dev'
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
})

describe('first use: the Square team is brought in once, with the same ids', () => {
  it('imports the ACTIVE Square team with contacts; inactive members left out', async () => {
    const { people, source } = await teamWithContacts()
    expect(source).toBe('local')
    expect(people).toEqual([
      { id: 'TM1', name: 'Kaden', givenName: 'Kaden', familyName: 'Goodell', role: 'owner', email: 'k@example.com', phone: '+12565550100', active: true },
      { id: 'TM4', name: 'Catherine', givenName: 'Catherine', familyName: 'Goodell', role: 'owner', email: null, phone: null, active: true },
      { id: 'TM2', name: 'Emma', givenName: 'Emma', familyName: 'R', role: 'crew', email: 'emma@example.com', phone: null, active: true },
    ])
  })

  it('Square marks only one owner; anyone named Catherine or Kaden still comes in as an owner and is linked', async () => {
    searchMock.mockResolvedValue({ teamMembers: [
      { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
      { id: 'TM4', givenName: 'catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false },
      { id: 'TM2', givenName: 'Emma', familyName: 'R', status: 'ACTIVE', isOwner: false },
    ] })
    const people = (await staffListForOwners()).people
    expect(people.map((p) => [p.id, p.role])).toEqual([['TM1', 'owner'], ['TM4', 'owner'], ['TM2', 'crew']])
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
    expect(await staffIdForOwner('Kaden')).toBe('TM1')
    // With Catherine an owner, Kaden can be marked as no longer working here.
    await expect(setWorking('TM1', false, BY)).resolves.toMatchObject({ changed: true })
  })

  it('is idempotent: after the first import Square is never read again, and the ids stay', async () => {
    await teamWithContacts()
    _resetStaffCache()
    searchMock.mockReset()
    searchMock.mockRejectedValue(new Error('should not be called'))
    const again = await teamWithContacts()
    expect(again.people.map((p) => p.id)).toEqual(['TM1', 'TM4', 'TM2'])
    expect(searchMock).not.toHaveBeenCalled()
    // A changed Square team changes nothing here any more.
    searchMock.mockResolvedValue({ teamMembers: [{ id: 'TM9', givenName: 'New', familyName: 'Square', status: 'ACTIVE', isOwner: false }] })
    _resetStaffCache()
    expect((await listStaff()).map((m) => m.id)).toEqual(['TM1', 'TM4', 'TM2'])
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('a failed import throws for owner screens and the picker falls back to the owners', async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    await expect(teamWithContacts()).rejects.toThrow(IMPORT_FAILED)
    expect(await listStaff()).toEqual([
      { id: 'kaden', name: 'Kaden', role: 'owner' },
      { id: 'catherine', name: 'Catherine', role: 'owner' },
    ])
    // Square back: the next look imports.
    searchMock.mockResolvedValue({ teamMembers: TEAM })
    _resetStaffCache()
    expect((await listStaff()).map((m) => m.id)).toEqual(['TM1', 'TM4', 'TM2'])
  })

  it('treats an empty Square team as a failed import', async () => {
    searchMock.mockResolvedValue({ teamMembers: [] })
    await expect(teamWithContacts()).rejects.toThrow(IMPORT_FAILED)
  })

  it('R41: a test site sharing the live stores shows the Square team read only and saves nothing', async () => {
    site.context = 'deploy-preview'
    expect((await staffListForOwners()).saved).toBe(false)
    await expect(addPerson({ givenName: 'Jess', familyName: '', role: 'crew', phone: '', email: '' }, BY)).rejects.toThrow(NO_TEST_STORE)
    // Nothing was saved: back on a real site the import still runs.
    site.context = 'dev'
    _resetStaffCache()
    searchMock.mockClear()
    expect((await staffListForOwners()).saved).toBe(true)
    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  it('start fresh is only allowed after the import kept failing (3 tries over 10+ minutes), when there is no list, and makes the two owners', async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    await expect(teamWithContacts()).rejects.toThrow(IMPORT_FAILED)
    expect(await canStartFresh()).toBe(false)
    await expect(startFresh(BY)).rejects.toThrow(STAFF_MESSAGES.tooSoon)
    // Three tries in a row, a minute apart: still too soon.
    _expireStaffCacheForTests()
    await expect(teamWithContacts()).rejects.toThrow(IMPORT_FAILED)
    _expireStaffCacheForTests()
    await expect(teamWithContacts()).rejects.toThrow(IMPORT_FAILED)
    expect(await canStartFresh()).toBe(false)
    expect(await canStartFresh(Date.now() + 11 * 60_000)).toBe(true)
    await _setImportFailuresForTests(3, Date.now() - 11 * 60_000)
    const doc = await startFresh(BY)
    expect(doc.people.map((p) => [p.givenName, p.role])).toEqual([['Catherine', 'owner'], ['Kaden', 'owner']])
    expect(doc.people.every((p) => p.id.startsWith('stf_') && !FALLBACK_IDS.has(p.id))).toBe(true)
    await expect(startFresh(BY)).rejects.toThrow(STAFF_MESSAGES.already)
    expect(await staffIdForOwner('Catherine')).toBe(doc.people[0].id)
  })
})

describe('listStaff (the picker)', () => {
  it('has no email or phone in it', async () => {
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

  it('appends a family initial when two people share a given name', async () => {
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
})

describe('adding and editing people', () => {
  it('adds someone with a new id, tidied phone and email; they show on the picker', async () => {
    const r = await addPerson({ givenName: ' Jessica ', familyName: 'Lane', role: 'crew', phone: '(256) 555-0199', email: 'Jess@Example.com' }, BY)
    expect(r.id).toMatch(/^stf_/)
    expect(r).toMatchObject({ givenName: 'Jessica', familyName: 'Lane', phone: '+12565550199', email: 'jess@example.com', active: true, from: 'added' })
    expect((await listStaff()).map((m) => m.name)).toContain('Jessica')
    expect((await teamWithContacts()).people.find((p) => p.id === r.id)?.phone).toBe('+12565550199')
  })

  it('refuses bad input with a sentence and the field', () => {
    expect(() => cleanPerson({ givenName: '', role: 'crew' })).toThrow(STAFF_MESSAGES.givenName)
    expect(() => cleanPerson({ givenName: 'A', role: 'boss' })).toThrow(STAFF_MESSAGES.role)
    expect(() => cleanPerson({ givenName: 'A', role: 'crew', phone: '555' })).toThrow(STAFF_MESSAGES.phone)
    // A stray leading + (or +1) is ignored: 10 digits always become a US number.
    expect(cleanPerson({ givenName: 'A', role: 'crew', phone: '+2565550123' }).phone).toBe('+12565550123')
    expect(cleanPerson({ givenName: 'A', role: 'crew', phone: '+1 (256) 555-0123' }).phone).toBe('+12565550123')
    expect(() => cleanPerson({ givenName: 'A', role: 'crew', email: 'nope' })).toThrow(STAFF_MESSAGES.email)
    expect(() => cleanPerson({ givenName: 'x'.repeat(41), role: 'crew' })).toThrow(STAFF_MESSAGES.nameLong)
  })

  it('refuses a second person with the same full name working here', async () => {
    await expect(addPerson({ givenName: 'Emma', familyName: 'R', role: 'crew', phone: '', email: '' }, BY)).rejects.toThrow(STAFF_MESSAGES.same)
  })

  it('edits contact details; a stale edit is refused with the latest', async () => {
    const list = await staffListForOwners()
    const emma = list.people.find((p) => p.id === 'TM2')!
    await new Promise((r) => setTimeout(r, 5))
    const saved = await editPerson('TM2', { givenName: 'Emma', familyName: 'R', role: 'crew', phone: '256 555 0123', email: 'emma@example.com' }, BY, emma.updatedAt)
    expect(saved.phone).toBe('+12565550123')
    expect(saved.history[0].change).toBe('Catherine changed phone')
    await expect(editPerson('TM2', { givenName: 'Emma', familyName: 'R', role: 'crew', phone: '', email: '' }, BY, emma.updatedAt)).rejects.toBeInstanceOf(StaleStaffError)
  })

  it('keeps at least one owner working here', async () => {
    await setWorking('TM1', false, BY)
    await expect(setWorking('TM4', false, BY)).rejects.toThrow(STAFF_MESSAGES.lastOwner)
    await expect(editPerson('TM4', { givenName: 'Catherine', familyName: 'Goodell', role: 'crew', phone: '', email: '' }, BY)).rejects.toThrow(STAFF_MESSAGES.lastOwner)
  })
})

describe('No longer working here', () => {
  it('keeps the record, takes them off the picker and every active check, and can be undone', async () => {
    const { person, changed } = await setWorking('TM2', false, BY)
    expect(changed).toBe(true)
    expect(person.leftAt).not.toBeNull()
    expect((await listStaff()).map((m) => m.id)).toEqual(['TM1', 'TM4'])
    expect(await isActiveStaffId('TM2')).toBe(false)
    expect(await staffIdStatus('TM2')).toBe('no')
    expect((await teamWithContacts()).people.map((p) => p.id)).not.toContain('TM2')
    // Never deleted: owners still see them, marked as left.
    const all = await staffListForOwners()
    expect(all.people.find((p) => p.id === 'TM2')).toMatchObject({ active: false, givenName: 'Emma' })
    // A second tap changes nothing.
    expect((await setWorking('TM2', false, BY)).changed).toBe(false)
    await setWorking('TM2', true, BY)
    expect(await isActiveStaffId('TM2')).toBe(true)
  })
})

describe('isActiveStaffId — fallback never keys data', () => {
  it("is false for 'kaden' and 'catherine' even while listStaff answers with the fallback", async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    expect((await listStaff()).map((m) => m.id)).toEqual(['kaden', 'catherine'])
    expect(await isActiveStaffId('kaden')).toBe(false)
    expect(await isActiveStaffId('catherine')).toBe(false)
    expect(await staffIdStatus('TM2')).toBe('unknown')
  })

  it('is true for an active id and false for unknown ones', async () => {
    expect(await isActiveStaffId('TM2')).toBe(true)
    expect(await isActiveStaffId('TM3')).toBe(false)
    expect(await isActiveStaffId('')).toBe(false)
  })
})

describe('staffIdForOwner', () => {
  it('finds the owner whose given name matches, ignoring crew with the same name', async () => {
    await addPerson({ givenName: 'Catherine', familyName: 'Smith', role: 'crew', phone: '', email: '' }, BY)
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
    expect(await staffIdForOwner('Kaden')).toBe('TM1')
  })

  it('the import links each owner by id: a second owner with the same first name, or a rename, changes nothing', async () => {
    await addPerson({ givenName: 'Catherine', familyName: 'Other', role: 'owner', phone: '', email: '' }, BY)
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
    const cat = (await staffListForOwners()).people.find((p) => p.id === 'TM4')!
    await editPerson('TM4', { givenName: 'Cat', familyName: 'Goodell', role: 'owner', phone: '', email: '' }, BY, cat.updatedAt)
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
  })

  it('a list saved before owners were linked: by first name, null when two owners share it; null when unreadable', async () => {
    const kv = makeKvStore('staff-people', 'staff-people')
    const rec = (id: string, givenName: string) => ({ id, givenName, familyName: '', role: 'owner', email: null, phone: null, active: true, leftAt: null, from: 'square', createdAt: 'x', updatedAt: 'x', history: [] })
    await kv.set('people', JSON.stringify({ v: 1, startedFrom: 'square', startedAt: 'x', updatedAt: 'x', people: [rec('TM1', 'Kaden'), rec('TM4', 'Catherine'), rec('TM5', 'Catherine')] }))
    _resetStaffCache()
    expect(await staffIdForOwner('Kaden')).toBe('TM1')
    expect(await staffIdForOwner('Catherine')).toBeNull()
    await _resetStaffListForTests()
    searchMock.mockRejectedValue(new Error('square down'))
    expect(await staffIdForOwner('Kaden')).toBeNull()
  })
})

describe('S4: the owner link follows the Owner role', () => {
  it('a crew member named Catherine who came in as Owner: made Crew, the link is cleared, and the real Catherine added by hand is found', async () => {
    searchMock.mockResolvedValue({ teamMembers: [
      { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
      { id: 'TM9', givenName: 'Catherine', familyName: 'Smith', status: 'ACTIVE', isOwner: false },
    ] })
    expect(await staffIdForOwner('Catherine')).toBe('TM9')
    const smith = (await staffListForOwners()).people.find((p) => p.id === 'TM9')!
    const edited = await editPerson('TM9', { givenName: 'Catherine', familyName: 'Smith', role: 'crew', phone: '', email: '' }, BY, smith.updatedAt)
    expect(edited.owner).toBeNull()
    expect(await staffIdForOwner('Catherine')).toBeNull()
    const real = await addPerson({ givenName: 'Catherine', familyName: 'Goodell', role: 'owner', phone: '', email: '' }, BY)
    expect(await staffIdForOwner('Catherine')).toBe(real.id)
  })

  it('an older list where a Crew person still carries the link: the link is ignored', async () => {
    const kv = makeKvStore('staff-people', 'staff-people')
    const rec = (id: string, givenName: string, role: string, owner: string | null) => ({ id, givenName, familyName: '', role, owner, email: null, phone: null, active: true, leftAt: null, from: 'square', createdAt: 'x', updatedAt: 'x', history: [] })
    await kv.set('people', JSON.stringify({ v: 1, startedFrom: 'square', startedAt: 'x', updatedAt: 'x', people: [rec('TM1', 'Kaden', 'owner', 'Kaden'), rec('TM9', 'Catherine', 'crew', 'Catherine'), rec('TM4', 'Catherine', 'owner', null)] }))
    _resetStaffCache()
    expect(await staffIdForOwner('Catherine')).toBe('TM4')
  })
})

describe('ensureCrewPerson (sandbox seed)', () => {
  it('adds once, then reuses; brings back someone who left', async () => {
    const a = await ensureCrewPerson('E2E', 'Crew', BY)
    expect(a.created).toBe(true)
    const b = await ensureCrewPerson('E2E', 'Crew', BY)
    expect(b).toEqual({ id: a.id, created: false })
    await setWorking(a.id, false, BY)
    expect(await ensureCrewPerson('E2E', 'Crew', BY)).toEqual({ id: a.id, created: false })
    expect(await isActiveStaffId(a.id)).toBe(true)
  })
})
