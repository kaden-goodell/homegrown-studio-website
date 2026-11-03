import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every gate answer is a Promise. Un-awaited, `!bookingsOpenNow(...)` is always
 * false and a paused booking goes through (tsc doesn't catch `!promise`). This
 * fails on any call to a gate function under src/ that isn't preceded by
 * `await` (or by `return await`). See src/lib/bookings-gate.ts.
 */
const GATE = ['bookingsOpenNow', 'kindOpenNow', 'pauseNoteNow', 'bookingsClosedResponse', 'bookingPageGate', 'previewTokenNow', 'hasValidPreviewCookieNow', 'previewQueryMatchesNow', 'waitlistChargesAllowedNow', 'getSwitchState']
const OLD = ['bookingsOpen', 'kindOpen', 'envBookingsOpen', 'hasValidPreviewCookie', 'previewQueryMatches']

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|astro)$/.test(f) ? [p] : []
})

// The definitions themselves (and the comments describing them) are exempt.
const DEFINING = new Set(['src/lib/bookings-gate.ts', 'src/lib/booking-switch.ts'])

function offenders(src: string, names: string[], ok: (before: string) => boolean): string[] {
  const out: string[] = []
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1')
  for (const name of names) {
    const re = new RegExp(`(^|[^\\w.])${name}\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 40), m.index + m[1].length)
      if (/function\s+$/.test(before)) continue // its definition
      if (!ok(before)) out.push(`${name}( … ${code.slice(m.index, m.index + 80).split('\n')[0]}`)
    }
  }
  return out
}

describe('booking gate calls are always awaited', () => {
  const all = files('src').filter((f) => !DEFINING.has(f))

  it('no gate call under src/ is missing its await', () => {
    const bad: string[] = []
    for (const f of all) {
      for (const o of offenders(readFileSync(f, 'utf8'), GATE, (before) => /await\s*\(?\s*!?\s*$|await\s+$/.test(before))) bad.push(`${f}: ${o}`)
    }
    expect(bad).toEqual([])
  })

  it('nothing calls the old synchronous names', () => {
    const bad: string[] = []
    for (const f of all) for (const o of offenders(readFileSync(f, 'utf8'), OLD, () => false)) bad.push(`${f}: ${o}`)
    expect(bad).toEqual([])
  })

  it('catches the stage-4 shapes it exists for', () => {
    const sample = [
      "if (!door && !bookingsOpenNow(request, 'workshops')) return bookingsClosedResponse()",
      "const includePartySlots = bookingsOpenNow(request, 'parties')",
      "if (!await bookingsOpenNow(request, 'workshops')) return await bookingsClosedResponse()",
    ].join('\n')
    const found = offenders(sample, GATE, (before) => /await\s*\(?\s*!?\s*$|await\s+$/.test(before))
    expect(found).toHaveLength(3) // two bookingsOpenNow and one bookingsClosedResponse on the first two lines
    expect(offenders("if (!bookingsOpen(request, 'workshops')) x()", OLD, () => false)).toHaveLength(1)
  })
})
