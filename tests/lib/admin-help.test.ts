// tests/lib/admin-help.test.ts — /admin › More › Help (DV13): complete, true to the app, and needs nobody else.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HELP_AVAILABLE, HELP_ROWS, HELP_SECTIONS, TO_DECIDE_HELP, WARNING_HELP, boldParts, visibleHelp } from '@lib/admin-help'
import { WARNING_CODES } from '@lib/warnings'
import { TO_DECIDE_KINDS } from '@lib/classes/to-decide'

const rowIds = new Set(HELP_ROWS.map((r) => r.id))
const visibleIds = new Set(visibleHelp().rows.map((r) => r.id))

/** Every .ts/.tsx under src/components and src/lib, except the Help itself: what the app can show. */
function appText(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|astro)$/.test(name) && !p.endsWith('admin-help.ts') && !p.endsWith('HelpSheet.tsx')) out.push(readFileSync(p, 'utf8'))
    }
  }
  for (const d of ['src/components', 'src/lib']) walk(d)
  return out.join('\n')
}

/** All the words of the Help, rows and sections. */
function allText(): string[] {
  const out: string[] = []
  for (const s of HELP_SECTIONS) {
    out.push(s.title, s.intro ?? '', ...s.points)
    for (const q of s.square ?? []) out.push(q.why, q.steps)
  }
  for (const r of HELP_ROWS) {
    out.push(r.see, r.where, r.means, r.tap)
    if (r.square) out.push(r.square.why, r.square.steps)
  }
  return out
}

describe('More › Help covers everything', () => {
  it('every warning code has a Help line shown in this build', () => {
    for (const code of WARNING_CODES) {
      const ids = WARNING_HELP[code]
      expect(ids?.length, code).toBeGreaterThan(0)
      for (const id of ids) {
        expect(rowIds.has(id), `${code} → ${id}`).toBe(true)
        expect(visibleIds.has(id), `${code} → ${id} is hidden`).toBe(true)
      }
    }
    expect(Object.keys(WARNING_HELP).sort()).toEqual([...WARNING_CODES].sort())
  })

  it('every To decide kind has a Help line shown in this build', () => {
    for (const kind of TO_DECIDE_KINDS) {
      const ids = TO_DECIDE_HELP[kind]
      expect(ids?.length, kind).toBeGreaterThan(0)
      for (const id of ids) {
        expect(rowIds.has(id), `${kind} → ${id}`).toBe(true)
        expect(visibleIds.has(id), `${kind} → ${id} is hidden`).toBe(true)
      }
    }
    expect(Object.keys(TO_DECIDE_HELP).sort()).toEqual([...TO_DECIDE_KINDS].sort())
  })

  it('the paid-elsewhere item names the in-app buttons, never a refund in Square', () => {
    const row = HELP_ROWS.find((r) => r.id === 'party-paid-elsewhere')!
    expect(row.buttons).toEqual(['Refund it', 'Put it toward the party', 'It’s already sorted'])
    expect(row.square).toBeUndefined()
    expect(row.tap).not.toMatch(/in Square/)
  })

  it('every screen the brief names has a section', () => {
    const titles = HELP_SECTIONS.map((s) => s.id)
    for (const id of ['classes-new', 'classes-change', 'parties-book', 'parties-on', 'parties-setup', 'refunds', 'warnings', 'staff', 'promotions', 'register', 'online-booking', 'hours', 'closed', 'calendar', 'inbox', 'reports', 'library', 'crafts', 'records', 'repeat', 'waitlist', 'self-cancel', 'reader']) {
      expect(titles, id).toContain(id)
    }
  })

  it('row and section ids are unique', () => {
    expect(rowIds.size).toBe(HELP_ROWS.length)
    expect(new Set(HELP_SECTIONS.map((s) => s.id)).size).toBe(HELP_SECTIONS.length)
  })
})

describe('More › Help is true to the app', () => {
  const app = appText()

  it('every button a shown line tells her to tap is a label the app has', () => {
    for (const r of visibleHelp().rows) {
      for (const b of r.buttons) expect(app.includes(b), `${r.id}: "${b}"`).toBe(true)
      // and the bold names in the line itself (templated ones like "Email <name> the details" aside)
      for (const [i, part] of boldParts(r.tap).entries()) {
        if (i % 2 && !part.includes('<')) expect(app.includes(part), `${r.id}: **${part}**`).toBe(true)
      }
    }
  })

  it('every bold name in a shown section is a label the app has', () => {
    for (const s of visibleHelp().sections) {
      for (const p of s.points) {
        for (const [i, part] of boldParts(p).entries()) {
          if (i % 2 && !part.includes('<') && part !== '⋯' && part !== '×') expect(app.includes(part), `${s.id}: **${part}**`).toBe(true)
        }
      }
    }
  })
})

describe('More › Help needs nobody else', () => {
  it('never says to tell or ask Kaden, nor sends her to the hosting dashboard, scripts, code or Claude', () => {
    for (const t of allText()) {
      expect(t, t).not.toMatch(/tell Kaden|ask Kaden|Kaden/i)
      expect(t, t).not.toMatch(/netlify|\bscripts?\b|npx|terminal|developer|github|\bcode edit|claude/i)
    }
  })

  it('"Look in Square" steps say why Square is the only place and give the exact path', () => {
    const all = [...HELP_ROWS.flatMap((r) => (r.square ? [r.square] : [])), ...HELP_SECTIONS.flatMap((s) => s.square ?? [])]
    expect(all.length).toBeGreaterThan(0)
    for (const q of all) {
      expect(q.why.length, q.steps).toBeGreaterThan(10)
      expect(q.steps, q.steps).toMatch(/^Square (Dashboard|app)/)
      expect(q.steps.split('›').length, q.steps).toBeGreaterThanOrEqual(3)
    }
  })

  it('staffing (merged) is shown; later stages stay hidden until they are merged', () => {
    expect(HELP_AVAILABLE.has('staffing')).toBe(true)
    for (const r of HELP_ROWS.filter((x) => x.comingWith)) {
      expect(visibleIds.has(r.id), r.id).toBe(HELP_AVAILABLE.has(r.comingWith!))
    }
    for (const s of HELP_SECTIONS.filter((x) => x.comingWith)) {
      expect(visibleHelp().sections.some((v) => v.id === s.id), s.id).toBe(HELP_AVAILABLE.has(s.comingWith!))
    }
    expect(visibleHelp().sections.map((s) => s.id)).toContain('staff')
  })

  it('both Home staff passcode alerts have a Help line', () => {
    for (const id of ['staff-passcode-guesses', 'staff-passcode-damaged']) expect(visibleIds.has(id), id).toBe(true)
  })
})
