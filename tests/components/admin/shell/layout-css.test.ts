import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * jsdom doesn't lay pages out, so these read admin.css for the three
 * layout bugs a real iPad and iPhone showed in review (fix round 1).
 */
const css = readFileSync('src/styles/admin.css', 'utf8')
const blocks = (selector: string) => [...css.matchAll(new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[2])

describe('admin.css', () => {
  it('the layout sizes the toast uses are on :root, so a toast outside the shell still lands on screen (Important 1)', () => {
    const root = blocks(':root').join('\n')
    for (const v of ['--adm-tab-h', '--adm-side-w', '--adm-panel-w']) expect(root).toContain(`${v}:`)
    expect(blocks('.adm').join('\n')).not.toMatch(/--adm-(tab-h|side-w|panel-w):/)
    expect(blocks('.adm-toasts').join('\n')).toMatch(/bottom: calc\(var\(--adm-tab-h\)/)
  })

  it('every grid track that shares space is minmax(0, …), so a long name can never push a column wider (Important 2)', () => {
    const cols = [...css.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1])
    expect(cols.length).toBeGreaterThan(5)
    for (const c of cols) {
      // minmax(0, 1fr), or a fixed floor like minmax(6rem, 1fr), both stop content widening the track.
      const bare = c.replace(/minmax\((0|[\d.]+(rem|px)),\s*[\d.]+fr\)/g, '')
      expect(bare, c).not.toMatch(/[\d.]+fr/)
    }
  })

  it('the week grid is seven shrinking columns and never scrolls sideways, panel or not (Important 3)', () => {
    expect(blocks('.adm-wgrid').join('\n')).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(css).not.toMatch(/\.adm-wgrid[^{]*\{[^}]*overflow-x/)
    expect(css).not.toMatch(/is-paneled \.adm-wgrid/)
  })

  it('tablets: the sidebar from 768px (a 72px rail), the full 220px from 1024px, a side panel of min(440px, 45vw)', () => {
    expect(css).not.toContain('900px')
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*:root \{\s*--adm-side-w: 72px;/)
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{\s*--adm-side-w: 220px;/)
    expect(css).toContain('--adm-panel-w: min(440px, 45vw)')
  })

  it('the base button reset has no specificity, so the site buttons keep their colours', () => {
    expect(css).toContain(':where(.adm button)')
  })

  it('fix round 2: with a side panel open the toast stops at the panel’s edge (N1)', () => {
    expect(css).toMatch(/body:has\(\.adm-sheet-layer\.is-panel\) \.adm-toasts \{\s*right: calc\(var\(--adm-panel-w\) \+ 1rem\);/)
  })

  it('fix round 2: the paragraph reset has no specificity, so notes and labels keep their spacing', () => {
    expect(css).toContain(':where(.adm) :where(p)')
    expect(css).not.toMatch(/^\.adm p \{/m)
  })

  it('fix round 2: Needs you is 2×2 on iPad portrait and beside a panel; chips never break mid-word', () => {
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\.adm-need \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
    expect(css).toMatch(/\.adm-shell\.is-paneled \.adm-need \{\s*grid-template-columns: repeat\(2/)
    const chipRules = blocks('.adm-chip b').join('\n')
    expect(chipRules).toContain('overflow-wrap: normal')
    expect(chipRules).toContain('-webkit-line-clamp: 2')
  })

  it('fix round 2: a 4-way status control only goes to one row on the page, never in a sheet or panel', () => {
    expect(css).toMatch(/\.adm-main \.adm-seg\.is-wrap button \{\s*flex: 1 1 0;/)
    expect(css).not.toMatch(/^\s*\.adm-seg\.is-wrap button \{\s*flex: 1 1 0;/m)
  })
})
