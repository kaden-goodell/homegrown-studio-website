/**
 * The old Square booking fallback has a guaranteed end (Kaden, 16 Nov 2026).
 * This test FAILS once the studio's today is past LEGACY_FALLBACK_UNTIL while
 * any fallback code is still in the repo. Fix it by deleting what it lists
 * (docs/handbook/notes/legacy-square-fallback.md), not by moving the date.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { LEGACY_FALLBACK_UNTIL } from '@config/legacy-fallback'
import { chicagoYmd } from '@lib/classes/chicago-day'

const ROOT = join(__dirname, '..')
const MARK = 'LEGACY FALLBACK'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|astro)$/.test(name)) out.push(p)
  }
  return out
}

/** Every file still carrying the fallback, the legacy folder first. */
export function legacyLeftovers(): string[] {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'netlify'))]
  const self = join(ROOT, 'tests', 'legacy-fallback-sunset.test.ts')
  return files
    .filter((f) => f !== self && readFileSync(f, 'utf8').includes(MARK))
    .map((f) => relative(ROOT, f))
    .sort((a, b) => Number(b.includes('legacy-square')) - Number(a.includes('legacy-square')) || a.localeCompare(b))
}

describe('the old Square booking fallback ends', () => {
  it('the end date is a real day', () => {
    expect(LEGACY_FALLBACK_UNTIL).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('finds the fallback code while it exists (so the check below can’t go blind)', () => {
    if (!existsSync(join(ROOT, 'src', 'lib', 'legacy-square'))) return
    expect(legacyLeftovers().length).toBeGreaterThan(0)
  })

  it(`no fallback code is left after ${LEGACY_FALLBACK_UNTIL}`, () => {
    const today = chicagoYmd(new Date())
    if (today <= LEGACY_FALLBACK_UNTIL) return
    const left = legacyLeftovers()
    const folder = existsSync(join(ROOT, 'src', 'lib', 'legacy-square'))
    expect(
      { folder, left },
      `The old Square booking fallback ended ${LEGACY_FALLBACK_UNTIL}. Delete it now: ` +
        'the folder src/lib/legacy-square/, tests/legacy-square/, src/config/legacy-fallback.ts, every block marked "LEGACY FALLBACK" in the files below, ' +
        'the BOOKING_SYSTEMS setting in Netlify, and this test. Then cancel Appointments Plus ($49/mo). ' +
        `Full list: docs/handbook/notes/legacy-square-fallback.md. Files still marked: ${left.join(', ')}`,
    ).toEqual({ folder: false, left: [] })
  })
})
