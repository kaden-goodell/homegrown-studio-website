/**
 * Tests for the pure archive exporter (HOM-217): `exportAll` over arbitrary
 * KV-shaped stores, `custodyCsv` from a checkins export, and the zip/
 * attachment builders. Runs against the fs-fallback KV (via `makeKvStore`
 * with `fsDirOverride`) so it never touches Netlify Blobs or the real
 * `.data/` dirs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { makeKvStore } from '@lib/blob-store'
import {
  exportAll,
  custodyCsv,
  buildArchiveZip,
  buildArchiveAttachments,
  type ArchiveStoreSpec,
} from '@lib/archive-export'

describe('exportAll', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'archive-export-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('counts and exports every key across multiple stores', async () => {
    const storeA = makeKvStore('a', 'a', { fsDirOverride: join(tmpDir, 'a') })
    const storeB = makeKvStore('b', 'b', { fsDirOverride: join(tmpDir, 'b') })
    await storeA.set('k1', JSON.stringify({ x: 1 }))
    await storeA.set('k2', JSON.stringify({ x: 2 }))
    await storeB.set('k1', JSON.stringify({ y: 1 }))

    const stores: ArchiveStoreSpec[] = [
      { name: 'a', store: storeA },
      { name: 'b', store: storeB },
    ]
    const result = await exportAll(stores)

    expect(result.counts).toEqual({ a: 2, b: 1 })
    expect(result.files.a.k1).toEqual({ x: 1 })
    expect(result.files.a.k2).toEqual({ x: 2 })
    expect(result.files.b.k1).toEqual({ y: 1 })
    expect(typeof result.generatedAt).toBe('string')
    expect(new Date(result.generatedAt).toString()).not.toBe('Invalid Date')
  })

  it('exports an empty store as zero keys, not an error', async () => {
    const store = makeKvStore('empty', 'empty', { fsDirOverride: join(tmpDir, 'empty') })
    const result = await exportAll([{ name: 'empty', store }])
    expect(result.counts.empty).toBe(0)
    expect(result.files.empty).toEqual({})
  })

  it('skips the blob-store probe key if present', async () => {
    const store = makeKvStore('withprobe', 'withprobe', { fsDirOverride: join(tmpDir, 'withprobe') })
    await store.set('__probe__', JSON.stringify({ nope: true }))
    await store.set('real', JSON.stringify({ ok: true }))
    const result = await exportAll([{ name: 'withprobe', store }])
    expect(result.counts.withprobe).toBe(1)
    expect(result.files.withprobe.real).toEqual({ ok: true })
    expect(result.files.withprobe.__probe__).toBeUndefined()
  })
})

describe('custodyCsv', () => {
  it('has the exact header and one row per CheckinEvent', () => {
    const checkins = {
      'party1__wvr_1': {
        events: [
          { at: '2026-01-01T00:00:00.000Z', action: 'checkin', personIds: ['adult', 'child:0'], by: { name: 'Kaden' }, day: '2026-01-01' },
        ],
      },
    }
    const csv = custodyCsv(checkins)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('event,household,day,at,action,personIds,by,collectedBy,reason,note')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('party1,wvr_1,2026-01-01,2026-01-01T00:00:00.000Z,checkin,adult|child:0,Kaden,,,')
  })

  it('emits one row per event across multiple households, and escapes commas/quotes', () => {
    const checkins = {
      'party1__wvr_1': {
        events: [
          { at: '2026-01-01T00:00:00.000Z', action: 'checkin', personIds: ['adult'], by: { name: 'Kaden' }, day: '2026-01-01' },
          {
            at: '2026-01-01T01:00:00.000Z',
            action: 'pickup',
            personIds: ['adult'],
            by: { name: 'Kaden' },
            collectedBy: 'Jane "Doe", Smith',
            note: 'left a "note", with a comma',
            day: '2026-01-01',
          },
        ],
      },
      'workshop:ws-1__wvr_2': {
        events: [
          { at: '2026-01-02T00:00:00.000Z', action: 'pickup-override', personIds: ['child:0'], by: { name: 'Catherine' }, reason: 'other: some, reason', day: '2026-01-02' },
        ],
      },
    }
    const csv = custodyCsv(checkins)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(4) // header + 3 events
    expect(lines[2]).toBe('party1,wvr_1,2026-01-01,2026-01-01T01:00:00.000Z,pickup,adult,Kaden,"Jane ""Doe"", Smith",,"left a ""note"", with a comma"')
    expect(lines[3]).toBe('workshop:ws-1,wvr_2,2026-01-02,2026-01-02T00:00:00.000Z,pickup-override,child:0,Catherine,,"other: some, reason",')
  })

  it('handles a checkins export with no events at all', () => {
    const csv = custodyCsv({})
    expect(csv.trim()).toBe('event,household,day,at,action,personIds,by,collectedBy,reason,note')
  })

  it('tolerates a record missing an events array', () => {
    const csv = custodyCsv({ 'party1__wvr_1': {} })
    expect(csv.trim()).toBe('event,household,day,at,action,personIds,by,collectedBy,reason,note')
  })
})

describe('buildArchiveZip', () => {
  it('zips one JSON per store plus custody.csv and manifest.json', async () => {
    const result = await exportAll([])
    result.files.waivers = { wvr_1: { id: 'wvr_1' } }
    result.files.checkins = {
      'party1__wvr_1': { events: [{ at: '2026-01-01T00:00:00.000Z', action: 'checkin', personIds: ['adult'] }] },
    }
    result.counts.waivers = 1
    result.counts.checkins = 1

    const zip = buildArchiveZip(result, ['waivers', 'checkins'])
    const unzipped = unzipSync(zip)

    expect(Object.keys(unzipped).sort()).toEqual(['checkins.json', 'custody.csv', 'manifest.json', 'waivers.json'])
    expect(JSON.parse(strFromU8(unzipped['waivers.json']))).toEqual({ wvr_1: { id: 'wvr_1' } })
    expect(strFromU8(unzipped['custody.csv'])).toContain('party1,wvr_1')
    expect(JSON.parse(strFromU8(unzipped['manifest.json']))).toEqual({ generatedAt: result.generatedAt, counts: result.counts })
  })
})

describe('buildArchiveAttachments', () => {
  it('returns a single zip when under the size guard', async () => {
    const result = await exportAll([])
    result.files.waivers = { wvr_1: { id: 'wvr_1' } }
    result.counts.waivers = 1

    const attachments = buildArchiveAttachments(result, ['waivers'])
    expect(attachments).toHaveLength(1)
    const unzipped = unzipSync(attachments[0].content)
    expect(Object.keys(unzipped)).toContain('waivers.json')
  })

  it('splits per store into multiple zips when the combined zip exceeds the size guard', async () => {
    const result = await exportAll([])
    result.files.waivers = { wvr_1: { id: 'wvr_1', blob: 'x'.repeat(1000) } }
    result.files.rsvps = { rsv_1: { id: 'rsv_1', blob: 'y'.repeat(1000) } }
    result.counts.waivers = 1
    result.counts.rsvps = 1

    // Force the split path with a tiny size guard.
    const attachments = buildArchiveAttachments(result, ['waivers', 'rsvps'], 10)
    expect(attachments.length).toBeGreaterThan(1)
    const names = attachments.map((a) => a.filename)
    expect(names.some((n) => n.includes('waivers'))).toBe(true)
    expect(names.some((n) => n.includes('rsvps'))).toBe(true)

    const waiversAttachment = attachments.find((a) => a.filename.includes('waivers'))!
    const unzipped = unzipSync(waiversAttachment.content)
    expect(Object.keys(unzipped)).toContain('waivers.json')
  })
})
