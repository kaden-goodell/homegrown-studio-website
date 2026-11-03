import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** kits.astro can't be rendered here, so this reads its source (as book.test.ts does). */
const source = readFileSync(resolve(__dirname, '../../src/pages/kits.astro'), 'utf8')

describe('/kits page and the online booking switch', () => {
  it('asks the switch for kits and answers the test link with the redirect', () => {
    expect(source).toMatch(/const gate = await bookingPageGate\(.*'kits'\)/)
    expect(source).toContain('if (gate.redirect) return Astro.redirect(gate.redirect, 302)')
  })

  it('while paused, shows the pause note instead of the order flow', () => {
    const template = source.slice(source.indexOf('---', 3) + 3)
    expect(template).toMatch(/\{gate\.open \? \(\s*<KitLanding client:load \/>\s*\) : \(/)
    expect(template).toContain('{gate.note}')
  })
})
