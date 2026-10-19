/**
 * Every store that holds a record of our classes is in the weekly archive.
 * Greps the code for makeKvStore names, so a new store under src/lib/classes
 * that nobody added to the archive fails here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ARCHIVE_STORES, ARCHIVE_STORE_NAMES } from '@lib/archive-stores'
import { exportAll } from '@lib/archive-export'

const root = process.cwd()
const storeNamesIn = (file: string) => [...readFileSync(file, 'utf8').matchAll(/makeKvStore\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2])

describe('archive store list', () => {
  it('covers every store under src/lib/classes', () => {
    const dir = join(root, 'src/lib/classes')
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    // a store named by a variable would slip past the name check: refuse it
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/makeKvStore\(\s*[^'"`\s)]/)
    const found = files.flatMap((f) => storeNamesIn(join(dir, f)))
    expect(found.length).toBeGreaterThan(5)
    for (const name of found) expect(ARCHIVE_STORE_NAMES, `store "${name}" is missing from the archive`).toContain(name)
  })

  it('covers the class photos and the legacy seat picks', () => {
    for (const name of [...storeNamesIn(join(root, 'src/pages/api/admin/classes/photo.json.ts')), ...storeNamesIn(join(root, 'src/lib/seat-choices.ts'))]) {
      expect(ARCHIVE_STORE_NAMES).toContain(name)
    }
  })

  it('keeps the legal records it always had', () => {
    for (const name of ['waivers', 'rsvps', 'checkins', 'incidents', 'event-meta', 'open-studio']) expect(ARCHIVE_STORE_NAMES).toContain(name)
  })

  it('the scheduled function and the manual script both use this one list', () => {
    for (const f of ['netlify/functions/archive-records.ts', 'scripts/archive-records.ts']) {
      const src = readFileSync(join(root, f), 'utf8')
      expect(src).toMatch(/archive-stores/)
      expect(src).not.toMatch(/const STORE_NAMES = \[/)
    }
  })

  it('photos too large for the email are listed by key, not dropped silently', async () => {
    const photos = ARCHIVE_STORES.find((s) => s.name === 'class-photos')!
    expect(photos.maxValueBytes).toBeGreaterThan(0)
    const big = JSON.stringify({ type: 'image/jpeg', data: 'x'.repeat(photos.maxValueBytes! + 10) })
    const small = JSON.stringify({ type: 'image/png', data: 'abc' })
    const store = { list: async () => ['photo-big', 'photo-small'], get: async (k: string) => (k === 'photo-big' ? big : small) }
    const out = await exportAll([{ name: 'class-photos', store, maxValueBytes: photos.maxValueBytes }])
    expect(out.files['class-photos']['photo-small']).toEqual({ type: 'image/png', data: 'abc' })
    expect(out.files['class-photos']['photo-big']).toEqual({ notIncluded: 'too large for the archive email', bytes: big.length })
    expect(out.counts['class-photos']).toBe(2)
  })
})
