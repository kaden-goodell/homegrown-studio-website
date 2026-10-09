import { describe, it, expect } from 'vitest'
import { mapLimit, parseBlobKeys } from '../../scripts/lib/netlify-blobs'
import { auditKeysNewestFirst } from '@lib/audit'

describe('parseBlobKeys', () => {
  it('reads the { blobs: [{ key }] } shape', () => {
    expect(parseBlobKeys('{"blobs":[{"key":"audit:1","etag":"x"},{"key":"audit:2"}],"directories":[]}')).toEqual(['audit:1', 'audit:2'])
  })
  it('reads a bare array of keys or objects, after any banner text', () => {
    expect(parseBlobKeys('Listing…\n["a","b"]')).toEqual(['a', 'b'])
    expect(parseBlobKeys('[{"key":"a"}]')).toEqual(['a'])
  })
  it('is empty when there is nothing to list', () => {
    expect(parseBlobKeys('')).toEqual([])
    expect(parseBlobKeys('{"blobs":[]}')).toEqual([])
  })
})

describe('auditKeysNewestFirst', () => {
  const keys = ['audit:2026-10-01T10:00:00.000Z-au_a', 'audit:2026-10-08T09:00:00.000Z-au_c', 'other', 'audit:2026-10-05T12:00:00.000Z-au_b']
  it('keeps audit keys only, newest first', () => {
    expect(auditKeysNewestFirst(keys)).toEqual([keys[1], keys[3], keys[0]])
  })
  it('starts from a date when given one', () => {
    expect(auditKeysNewestFirst(keys, '2026-10-05')).toEqual([keys[1], keys[3]])
  })
})

describe('mapLimit', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBeLessThanOrEqual(2)
  })
})
