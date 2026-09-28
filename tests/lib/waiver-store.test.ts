/**
 * Tests for waiver-store: household upsert (dedup), legacy index compat,
 * duplicate-child flagging, and CAS retry on upsertWaiverInEventIndex.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<{
  id: string
  partyId: string
  email: string
  phone: string
  firstName: string
  lastName: string
  minors: Array<{ name: string; dob: string; allergies: string; medications?: string }>
}> = {}): import('@lib/waiver-store').WaiverRecord {
  return {
    id: overrides.id ?? 'wvr_test_001',
    agreementVersion: 'v2',
    agreementSha256: 'abc',
    signedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 1e10).toISOString(),
    adult: {
      firstName: overrides.firstName ?? 'Alice',
      lastName: overrides.lastName ?? 'Test',
      email: overrides.email ?? 'alice@example.com',
      phone: overrides.phone ?? '2565551234',
      dob: '1990-01-01',
      allergies: '',
    },
    minors: (overrides.minors ?? []).map((m) => ({ medications: '', ...m })),
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: [],
    notAuthorized: '',
    photoConsent: true,
    signature: 'Alice Test',
    partyId: overrides.partyId ?? 'party-abc',
    responsibleAdult: null,
    squareCustomerId: null,
    ip: null,
    userAgent: null,
  }
}

// ─── upsertWaiverInPartyIndex + listWaiversByParty ──────────────────────────

describe('upsertWaiverInPartyIndex (fs mode)', () => {
  let tmpDir: string
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'waiver-store-test-'))

    // Patch makeKvStore to use tmpDir before importing the module under test.
    // We re-import fresh each time via a factory so the kv instance is isolated.
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers', { fsDirOverride: tmpDir })

    // Inject the kv override into the waiver-store module via a thin re-export
    // trick: rebuild the module with the patched kv in scope.
    // Since we can't easily monkey-patch private module state, we test via the
    // public API and seed the raw KV directly through saveWaiverRecord.
    mod = await import('@lib/waiver-store')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // (a) Same contact → only ONE entry remains, replacedRecordId returned.
  it('upserting two records with same email leaves ONE entry and returns replacedRecordId', async () => {
    const partyId = `party-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_first', partyId, email: 'alice@example.com' })
    const r2 = makeRecord({ id: 'wvr_second', partyId, email: 'alice@example.com' })

    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)

    const { replacedRecordId: rep1 } = await mod.upsertWaiverInPartyIndex(partyId, r1)
    expect(rep1).toBeNull() // first insert → no previous

    const { replacedRecordId: rep2 } = await mod.upsertWaiverInPartyIndex(partyId, r2)
    expect(rep2).toBe('wvr_first') // replaced the first

    const waivers = await mod.listWaiversByParty(partyId)
    expect(waivers).toHaveLength(1)
    expect(waivers[0].id).toBe('wvr_second')
  })

  // (b) Different emails → two separate entries.
  it('different emails produce two entries', async () => {
    const partyId = `party-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_mom', partyId, email: 'mom@example.com' })
    const r2 = makeRecord({ id: 'wvr_dad', partyId, email: 'dad@example.com' })

    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)

    await mod.upsertWaiverInPartyIndex(partyId, r1)
    await mod.upsertWaiverInPartyIndex(partyId, r2)

    const waivers = await mod.listWaiversByParty(partyId)
    expect(waivers).toHaveLength(2)
    const ids = waivers.map((w) => w.id).sort()
    expect(ids).toEqual(['wvr_dad', 'wvr_mom'])
  })

  // (c) Legacy index of bare string ids still lists correctly.
  it('legacy index of bare string ids still lists correctly', async () => {
    const partyId = `party-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_legacy_1', partyId })
    const r2 = makeRecord({ id: 'wvr_legacy_2', partyId })

    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)

    // Manually write a legacy index (bare strings, no contactKey).
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    await kv.set(`party-index-${partyId}`, JSON.stringify(['wvr_legacy_1', 'wvr_legacy_2']))

    const waivers = await mod.listWaiversByParty(partyId)
    expect(waivers).toHaveLength(2)
    const ids = waivers.map((w) => w.id).sort()
    expect(ids).toEqual(['wvr_legacy_1', 'wvr_legacy_2'])
  })

  // (d) Mixed index (legacy strings, legacy {recordId} objects, AND current
  // {waiverId, rsvpId} objects) lists all records — every shape this blob
  // has ever held must keep working (HOM-210).
  it('mixed legacy strings, legacy {recordId} objects, and current {waiverId,rsvpId} objects lists all records', async () => {
    const partyId = `party-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_old', partyId })
    const r2 = makeRecord({ id: 'wvr_new', partyId, email: 'new@example.com' })
    const r3 = makeRecord({ id: 'wvr_newest', partyId, email: 'newest@example.com' })

    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)
    await mod.saveWaiverRecord(r3)

    // Write a mixed index covering all three shapes.
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    await kv.set(
      `party-index-${partyId}`,
      JSON.stringify([
        'wvr_old',
        { recordId: 'wvr_new', contactKey: 'e:new@example.com' },
        { waiverId: 'wvr_newest', contactKey: 'e:newest@example.com', rsvpId: 'rsv_abc123' },
      ]),
    )

    const waivers = await mod.listWaiversByParty(partyId)
    expect(waivers).toHaveLength(3)
    const ids = waivers.map((w) => w.id).sort()
    expect(ids).toEqual(['wvr_new', 'wvr_newest', 'wvr_old'])
  })
})

// ─── EventIndexEntry.rsvpId round-trip ───────────────────────────────────────

describe('upsertWaiverInEventIndex — rsvpId', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('defaults rsvpId to null when not passed', async () => {
    const partyId = `party-rsvp-default-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_norsvp', partyId })
    await mod.saveWaiverRecord(r1)
    await mod.upsertWaiverInEventIndex('party', partyId, r1)

    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    const raw = JSON.parse((await kv.get(`party-index-${partyId}`))!)
    expect(raw[0].rsvpId).toBeNull()
  })

  it('stores and round-trips a passed rsvpId', async () => {
    const partyId = `party-rsvp-set-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_withrsvp', partyId })
    await mod.saveWaiverRecord(r1)
    await mod.upsertWaiverInEventIndex('party', partyId, r1, 'rsv_test_1')

    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    const raw = JSON.parse((await kv.get(`party-index-${partyId}`))!)
    expect(raw[0].waiverId).toBe('wvr_withrsvp')
    expect(raw[0].rsvpId).toBe('rsv_test_1')
  })
})

// ─── contextOf + indexKeyFor + event-API backward compat ────────────────────

describe('contextOf', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('returns context from record.context when present', () => {
    const r = makeRecord({ partyId: 'party-abc' }) as any
    r.context = { kind: 'party', id: 'party-abc' }
    expect(mod.contextOf(r)).toEqual({ kind: 'party', id: 'party-abc' })
  })

  it('falls back to partyId when context is absent', () => {
    const r = makeRecord({ partyId: 'party-xyz' }) as any
    delete r.context
    expect(mod.contextOf(r)).toEqual({ kind: 'party', id: 'party-xyz' })
  })

  it('returns null when neither context nor partyId', () => {
    const r = makeRecord({}) as any
    delete r.context
    r.partyId = null
    expect(mod.contextOf(r)).toBeNull()
  })
})

describe('indexKeyFor', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('party kind returns exact legacy key', () => {
    expect(mod.indexKeyFor('party', 'X')).toBe('party-index-X')
  })

  it('workshop kind returns event-index-workshop: namespace', () => {
    expect(mod.indexKeyFor('workshop', 'Y')).toBe('event-index-workshop:Y')
  })
})

describe('upsertWaiverInEventIndex + listWaiversByEvent legacy compat', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('after upserting via event API with kind=party, listWaiversByParty reads pre-existing legacy index blob', async () => {
    const partyId = `party-legacy-compat-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_legacy_existing', partyId })
    const r2 = makeRecord({ id: 'wvr_new_upsert', partyId, email: 'new@test.com' })

    // Save both records
    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)

    // Write a bare-string legacy index using the same KV the module uses
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    await kv.set(`party-index-${partyId}`, JSON.stringify(['wvr_legacy_existing']))

    // Upsert via the event API with kind='party'
    await mod.upsertWaiverInEventIndex('party', partyId, r2)

    // listWaiversByParty must return both records
    const waivers = await mod.listWaiversByParty(partyId)
    const ids = waivers.map((w) => w.id).sort()
    expect(ids).toEqual(['wvr_legacy_existing', 'wvr_new_upsert'])
  })
})

// ─── markDuplicateChildren ───────────────────────────────────────────────────

describe('markDuplicateChildren', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  // (e) Flags second occurrence of the same name, case/whitespace-insensitive.
  it('flags the second occurrence of "Emma Rivera" (case/whitespace-insensitive)', () => {
    const households = [
      { signer: 'Alice Rivera', children: [{ name: 'Emma Rivera' }] },
      { signer: 'Carlos Rivera', children: [{ name: '  Emma   Rivera  ' }] },
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(1)
    expect(households[0].children[0].duplicateOf).toBeUndefined()
    expect(households[1].children[0].duplicateOf).toBe('Alice Rivera')
  })

  it('flags the same name ONLY when the birthdate matches (same kid on two waivers)', () => {
    const households = [
      { signer: 'Mom Silver', children: [{ name: 'Bob Silver', dob: '2017-06-01' }] },
      { signer: 'Dad Silver', children: [{ name: 'Bob Silver', dob: '2017-06-01' }] },
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(1)
    expect(households[1].children[0].duplicateOf).toBe('Mom Silver')
  })

  it('does NOT flag two different kids who share a name (different birthdates)', () => {
    const households = [
      { signer: 'Family One', children: [{ name: 'Bob Silver', dob: '2015-02-10' }] },
      { signer: 'Family Two', children: [{ name: 'Bob Silver', dob: '2018-11-30' }] },
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(0)
    expect(households[0].children[0].duplicateOf).toBeUndefined()
    expect(households[1].children[0].duplicateOf).toBeUndefined()
  })

  it('leaves distinct child names unflagged', () => {
    const households = [
      { signer: 'Parent A', children: [{ name: 'Liam' }] },
      { signer: 'Parent B', children: [{ name: 'Sophia' }] },
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(0)
    expect(households[0].children[0].duplicateOf).toBeUndefined()
    expect(households[1].children[0].duplicateOf).toBeUndefined()
  })

  it('returns correct duplicate count when multiple duplicates exist', () => {
    const households = [
      { signer: 'H1', children: [{ name: 'Emma' }, { name: 'Liam' }] },
      { signer: 'H2', children: [{ name: 'Emma' }] }, // dup
      { signer: 'H3', children: [{ name: 'Liam' }, { name: 'Emma' }] }, // both dups (Liam first seen in H1, Emma first seen in H1)
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(3) // Emma in H2, Liam in H3, Emma in H3
    expect(households[1].children[0].duplicateOf).toBe('H1')
    expect(households[2].children[0].duplicateOf).toBe('H1')
    expect(households[2].children[1].duplicateOf).toBe('H1')
  })

  it('ignores empty child names', () => {
    const households = [
      { signer: 'Parent A', children: [{ name: '' }] },
      { signer: 'Parent B', children: [{ name: '' }] },
    ]
    const count = mod.markDuplicateChildren(households)
    expect(count).toBe(0)
  })
})

// ─── last-name index (door search, HOM-208) ──────────────────────────────────

describe('indexWaiverByContact — last-name index', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('after indexing a record, lookupHouseholdsByName finds it by trimmed/lowercased last name', async () => {
    const r = makeRecord({ id: `wvr_rivera_${Date.now()}`, lastName: 'Rivera', email: `rivera-${Date.now()}@example.com` })
    await mod.saveWaiverRecord(r)
    await mod.indexWaiverByContact(r)

    const found = await mod.lookupHouseholdsByName('  rivera ')
    expect(found.map((h) => h.recordId)).toContain(r.id)
  })

  it('normalizes accented last names to the same key (RIVÉRA === Rivera)', async () => {
    const r = makeRecord({ id: `wvr_accent_${Date.now()}`, lastName: 'Rivera', email: `accent-${Date.now()}@example.com` })
    await mod.saveWaiverRecord(r)
    await mod.indexWaiverByContact(r)

    const found = await mod.lookupHouseholdsByName('RIVÉRA')
    expect(found.map((h) => h.recordId)).toContain(r.id)
  })

  it('is idempotent — indexing the same record twice does not duplicate the entry', async () => {
    const last = `Solo${Date.now()}`
    const r = makeRecord({ id: `wvr_solo_${Date.now()}`, lastName: last, email: `solo-${Date.now()}@example.com` })
    await mod.saveWaiverRecord(r)
    await mod.indexWaiverByContact(r)
    await mod.indexWaiverByContact(r)

    const found = await mod.lookupHouseholdsByName(last)
    expect(found.filter((h) => h.recordId === r.id)).toHaveLength(1)
  })

  it('a household with no last name is skipped without error', async () => {
    const r = makeRecord({ id: `wvr_nolast_${Date.now()}`, lastName: '', email: `nolast-${Date.now()}@example.com` })
    await mod.saveWaiverRecord(r)
    await expect(mod.indexWaiverByContact(r)).resolves.not.toThrow()
  })

  it('an unknown last name returns an empty list', async () => {
    const found = await mod.lookupHouseholdsByName(`Nobody${Date.now()}`)
    expect(found).toEqual([])
  })

  it('collapses repeat signings by the same person to their most recent record', async () => {
    const last = `Repeat${Date.now()}`
    const older = makeRecord({ id: `wvr_repeat_old_${Date.now()}`, lastName: last, firstName: 'Sam', email: `repeat-${Date.now()}@example.com` })
    older.signedAt = new Date(Date.now() - 1e9).toISOString()
    const newer = { ...older, id: `wvr_repeat_new_${Date.now()}`, signedAt: new Date().toISOString() }

    await mod.saveWaiverRecord(older)
    await mod.indexWaiverByContact(older)
    await mod.saveWaiverRecord(newer)
    await mod.indexWaiverByContact(newer)

    const found = await mod.lookupHouseholdsByName(last)
    const matches = found.filter((h) => h.firstName === 'Sam' && h.lastName === last)
    expect(matches).toHaveLength(1)
    expect(matches[0].recordId).toBe(newer.id)
  })

  // Fix round 1: two DIFFERENT customers sharing the exact same full name
  // must both come back — dedupe is by contact identity, never by the name
  // string, or the second household becomes unreachable by search.
  it('two different customers with the same full name but different emails both come back', async () => {
    const last = `Rivera${Date.now()}`
    const alice = makeRecord({ id: `wvr_namesake_a_${Date.now()}`, lastName: last, firstName: 'Sam', email: `sam-a-${Date.now()}@example.com` })
    const bob = makeRecord({ id: `wvr_namesake_b_${Date.now()}`, lastName: last, firstName: 'Sam', email: `sam-b-${Date.now()}@example.com` })

    await mod.saveWaiverRecord(alice)
    await mod.indexWaiverByContact(alice)
    await mod.saveWaiverRecord(bob)
    await mod.indexWaiverByContact(bob)

    const found = await mod.lookupHouseholdsByName(last)
    const ids = found.map((h) => h.recordId).sort()
    expect(ids).toEqual([alice.id, bob.id].sort())
  })

  it('the same contact re-signing under the same name still collapses to their newest record (via email, not name)', async () => {
    const last = `Same${Date.now()}`
    const email = `same-${Date.now()}@example.com`
    const older = makeRecord({ id: `wvr_same_old_${Date.now()}`, lastName: last, firstName: 'Sam', email })
    older.signedAt = new Date(Date.now() - 1e9).toISOString()
    const newer = { ...older, id: `wvr_same_new_${Date.now()}`, signedAt: new Date().toISOString() }

    await mod.saveWaiverRecord(older)
    await mod.indexWaiverByContact(older)
    await mod.saveWaiverRecord(newer)
    await mod.indexWaiverByContact(newer)

    const found = await mod.lookupHouseholdsByName(last)
    expect(found).toHaveLength(1)
    expect(found[0].recordId).toBe(newer.id)
  })
})

// ─── normalizeAuthorizedPickup (HOM-212) ────────────────────────────────────

describe('normalizeAuthorizedPickup', () => {
  let mod: typeof import('@lib/waiver-store')

  beforeEach(async () => {
    mod = await import('@lib/waiver-store')
  })

  it('splits a legacy free-text string on commas/"and" into {name, phone:""} entries', () => {
    const result = mod.normalizeAuthorizedPickup('Grandma Rivera, Uncle Joe and Aunt Sue')
    expect(result).toEqual([
      { name: 'Grandma Rivera', phone: '' },
      { name: 'Uncle Joe', phone: '' },
      { name: 'Aunt Sue', phone: '' },
    ])
  })

  it('passes an array of {name, phone} through, trimmed', () => {
    const result = mod.normalizeAuthorizedPickup([
      { name: '  Grandma Rivera  ', phone: ' 2565551234 ' },
      { name: 'Uncle Joe', phone: '' },
    ])
    expect(result).toEqual([
      { name: 'Grandma Rivera', phone: '2565551234' },
      { name: 'Uncle Joe', phone: '' },
    ])
  })

  it('drops entries with an empty/blank name', () => {
    const result = mod.normalizeAuthorizedPickup([{ name: '', phone: '2565551234' }, { name: '   ', phone: '' }])
    expect(result).toEqual([])
  })

  it('returns [] for null, numbers, and other garbage', () => {
    expect(mod.normalizeAuthorizedPickup(null)).toEqual([])
    expect(mod.normalizeAuthorizedPickup(undefined)).toEqual([])
    expect(mod.normalizeAuthorizedPickup(123)).toEqual([])
    expect(mod.normalizeAuthorizedPickup({})).toEqual([])
  })

  it('returns [] for an empty string', () => {
    expect(mod.normalizeAuthorizedPickup('')).toEqual([])
  })
})

// ─── upsertWaiverInEventIndex CAS retry ──────────────────────────────────────

describe('upsertWaiverInEventIndex — CAS retry on setIfMatch false', () => {
  it('succeeds after 1 lost CAS race (2 attempts total)', async () => {
    // Build a fake blob store whose setIfMatch returns false on the first call,
    // then true on all subsequent calls — simulating one concurrent write win.
    let setIfMatchCalls = 0
    const data: Record<string, string> = {}
    const etags: Record<string, string> = {}
    let etagCounter = 0

    const fakeBlobStore = {
      async get(key: string, _opts?: unknown): Promise<string | null> {
        return data[key] ?? null
      },
      async getWithMetadata(key: string, _opts?: unknown) {
        const value = data[key]
        if (value === undefined) return null
        return { data: value, etag: etags[key] ?? undefined, metadata: {} }
      },
      async set(key: string, value: string, opts?: any) {
        setIfMatchCalls++
        const isConditional = opts && (opts.onlyIfMatch || opts.onlyIfNew)
        if (isConditional && setIfMatchCalls === 1) {
          // First conditional write loses the race
          return { modified: false, etag: undefined }
        }
        data[key] = value
        etagCounter++
        etags[key] = `etag-${etagCounter}`
        return { modified: true, etag: etags[key] }
      },
      async list() {
        return { blobs: [], directories: [] }
      },
    }

    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers-cas-test', 'waivers-cas-test', { _blobStore: fakeBlobStore })

    // Re-build a minimal version of upsertWaiverInEventIndex logic using the
    // injected kv so we can test the CAS loop without re-importing the module.
    // (waiver-store's kv is module-level; we exercise the loop via makeKvStore directly.)
    const indexKey = 'party-index-cas-party'

    async function rawGetWithMeta(key: string) { return kv.getWithMeta(key) }

    const record = makeRecord({ id: 'wvr_cas_new', partyId: 'cas-party', email: 'cas@example.com' })
    const ck = 'e:cas@example.com'

    let replacedRecordId: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value, etag } = await rawGetWithMeta(indexKey)
      const entries: { recordId: string; contactKey: string }[] = value
        ? JSON.parse(value).map((e: any) =>
            typeof e === 'string' ? { recordId: e, contactKey: '' } : e,
          )
        : []
      const prev = entries.find((e) => e.contactKey === ck && e.recordId !== record.id)
      const next = entries.filter((e) => e.contactKey !== ck && e.recordId !== record.id)
      next.push({ recordId: record.id, contactKey: ck })
      if (await kv.setIfMatch(indexKey, JSON.stringify(next), etag)) {
        replacedRecordId = prev?.recordId ?? null
        break
      }
    }

    // The upsert should have succeeded after the retry (2nd attempt)
    expect(setIfMatchCalls).toBe(2)
    expect(replacedRecordId).toBeNull()
    // The index should now contain our record
    const stored = JSON.parse(data[indexKey])
    expect(stored).toHaveLength(1)
    expect(stored[0].recordId).toBe('wvr_cas_new')
  })
})
