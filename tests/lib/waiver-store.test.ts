/**
 * Tests for waiver-store: household upsert (dedup), legacy index compat,
 * and duplicate-child flagging.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
  minors: Array<{ name: string; dob: string; allergies: string }>
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
    minors: overrides.minors ?? [],
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: '',
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

  // (d) Mixed index (some legacy strings, some new objects) lists all records.
  it('mixed legacy strings and new objects lists all records', async () => {
    const partyId = `party-${Date.now()}`
    const r1 = makeRecord({ id: 'wvr_old', partyId })
    const r2 = makeRecord({ id: 'wvr_new', partyId, email: 'new@example.com' })

    await mod.saveWaiverRecord(r1)
    await mod.saveWaiverRecord(r2)

    // Write a mixed index.
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('waivers', 'waivers')
    await kv.set(
      `party-index-${partyId}`,
      JSON.stringify(['wvr_old', { recordId: 'wvr_new', contactKey: 'e:new@example.com' }]),
    )

    const waivers = await mod.listWaiversByParty(partyId)
    expect(waivers).toHaveLength(2)
    const ids = waivers.map((w) => w.id).sort()
    expect(ids).toEqual(['wvr_new', 'wvr_old'])
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
