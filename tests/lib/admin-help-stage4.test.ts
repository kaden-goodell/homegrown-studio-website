// tests/lib/admin-help-stage4.test.ts — the stage 4 Help lines (folded into admin-help.ts at the merge):
// complete for every stage 4 warning and To decide item, true to the app, and needing nobody else.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STAGE4_HELP_ROWS, STAGE4_HELP_SECTIONS, STAGE4_TO_DECIDE_HELP, STAGE4_WARNING_HELP } from '@lib/admin-help-stage4'

const rowIds = new Set(STAGE4_HELP_ROWS.map((r) => r.id))
const boldParts = (t: string) => t.split('**')

/** Every .ts/.tsx/.astro under src/components, src/lib and src/pages, except the Help itself: what the app can show. */
function appText(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|astro)$/.test(name) && !/admin-help/.test(p)) out.push(readFileSync(p, 'utf8'))
    }
  }
  for (const d of ['src/components', 'src/lib', 'src/pages']) walk(d)
  return out.join('\n')
}

describe('stage 4 Help covers everything', () => {
  it('every stage 4 warning code and To decide kind points at rows that exist', () => {
    for (const [code, ids] of [...Object.entries(STAGE4_WARNING_HELP), ...Object.entries(STAGE4_TO_DECIDE_HELP)]) {
      expect(ids.length, code).toBeGreaterThan(0)
      for (const id of ids) expect(rowIds.has(id), `${code} → ${id}`).toBe(true)
    }
  })

  it('every warning code the stage 4 code raises is in the list (warnings.ts, waitlist-items.ts)', () => {
    const src = readFileSync('src/lib/warnings.ts', 'utf8') + readFileSync('src/lib/classes/waitlist-items.ts', 'utf8')
    for (const code of ['waitlist-stopped', 'waitlist-card-on', 'reader-waiting', 'register-setup-missing', 'promo-free-unlimited', 'pos-price-stale', 'not-on-register', 'register-old-setup']) {
      expect(src, code).toContain(`'${code}'`)
      expect(Object.keys(STAGE4_WARNING_HELP), code).toContain(code)
    }
  })

  it('the screens: promotions, repeat, register, waitlist, reader, customers cancelling', () => {
    expect(STAGE4_HELP_SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['promotions', 'repeat', 'register', 'waitlist', 'reader', 'self-cancel']))
    expect(Object.keys(STAGE4_TO_DECIDE_HELP)).toEqual(expect.arrayContaining(['cancel-request', 'cancel-unclear']))
    expect(Object.keys(STAGE4_WARNING_HELP)).toEqual(expect.arrayContaining(['cancel-request', 'cancel-unclear']))
  })

  it('ids are unique and everything is marked as arriving with extras', () => {
    expect(rowIds.size).toBe(STAGE4_HELP_ROWS.length)
    expect(new Set(STAGE4_HELP_SECTIONS.map((s) => s.id)).size).toBe(STAGE4_HELP_SECTIONS.length)
    for (const x of [...STAGE4_HELP_ROWS, ...STAGE4_HELP_SECTIONS]) expect(x.comingWith, x.id).toBe('extras')
  })
})

describe('stage 4 Help is true to the app', () => {
  const app = appText()
  it('every button a row names is a label the app has (and the bold names in its line)', () => {
    for (const r of STAGE4_HELP_ROWS) {
      for (const b of r.buttons) expect(app.includes(b), `${r.id}: "${b}"`).toBe(true)
      for (const [i, part] of boldParts(r.tap).entries()) if (i % 2 && !part.includes('<')) expect(app.includes(part), `${r.id}: **${part}**`).toBe(true)
    }
  })
  it('every bold name in a section is a label the app has', () => {
    for (const s of STAGE4_HELP_SECTIONS) {
      for (const p of s.points) for (const [i, part] of boldParts(p).entries()) if (i % 2 && !part.includes('<')) expect(app.includes(part), `${s.id}: **${part}**`).toBe(true)
    }
  })
})

describe('stage 4 Help needs nobody else', () => {
  it('never says to tell or ask Kaden, nor sends her to the hosting dashboard, scripts, code, Claude or the Square dashboard', () => {
    const all = [...STAGE4_HELP_SECTIONS.flatMap((s) => [s.title, s.intro ?? '', ...s.points]), ...STAGE4_HELP_ROWS.flatMap((r) => [r.see, r.where, r.means, r.tap])]
    for (const t of all) {
      expect(t, t).not.toMatch(/Kaden/i)
      expect(t, t).not.toMatch(/netlify|\bscripts?\b|npx|terminal|developer|github|\bcode edit|claude|Square Dashboard|squareup\.com/i)
    }
  })
})
