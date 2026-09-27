import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { siteConfig } from '@config/site.config'

/**
 * Guards the palette: every colour used for text must stay readable on the
 * ground it sits on. WCAG AA is 4.5:1 for body text, 3:1 for large text and
 * for the edges of form fields.
 *
 * Tokens are read from src/styles/global.css. The six colours the layouts
 * inject from site.config.ts override their global.css values, so they are
 * applied on top, exactly as the browser sees them.
 */

const css = readFileSync(resolve(__dirname, '../../src/styles/global.css'), 'utf8')

function readTokens(): Record<string, string> {
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
  const tokens: Record<string, string> = {}
  for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) tokens[m[1]] = m[2].trim()
  const c = siteConfig.theme.colors
  tokens['--color-primary'] = c.primary
  tokens['--color-secondary'] = c.secondary
  tokens['--color-accent'] = c.accent
  tokens['--color-background'] = c.background
  tokens['--color-text'] = c.text
  tokens['--color-muted'] = c.muted
  return tokens
}

const tokens = readTokens()

function hex(name: string): string {
  let value = tokens[name]
  for (let i = 0; i < 5 && value?.startsWith('var('); i++) {
    value = tokens[value.slice(4, -1).trim()]
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} does not resolve to a hex colour (got ${value})`)
  return value
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('colour contrast', () => {
  const text: [string, string][] = [
    ['--color-text', '--color-background'],
    ['--color-text', '--color-surface'],
    ['--color-muted', '--color-background'],
    ['--color-muted', '--color-surface'],
    ['--color-muted', '--color-sand'],
    ['--color-dark', '--color-background'],
    ['--color-dark', '--color-sand'],
    ['--color-primary', '--color-background'],
    ['--color-primary', '--color-surface'],
    ['--color-button-text', '--color-button'],
    ['--color-button-text', '--color-button-hover'],
    ['--color-button-text', '--color-dark'],
  ]
  for (const [fg, bg] of text) {
    it(`${fg} on ${bg} is readable (4.5:1)`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const craft of ['pink', 'denim', 'green', 'marigold', 'teal']) {
    it(`${craft} ink is readable on its soft tint, the cream ground and white`, () => {
      expect(contrast(`--craft-${craft}-ink`, `--craft-${craft}-soft`)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(`--craft-${craft}-ink`, '--color-background')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(`--craft-${craft}-ink`, '--color-surface')).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('every offering has a craft colour in all three roles', () => {
    for (const tone of ['party', 'workshop', 'studio', 'event', 'kit']) {
      expect(() => hex(`--tone-${tone}`)).not.toThrow()
      expect(() => hex(`--tone-${tone}-soft`)).not.toThrow()
      expect(() => hex(`--tone-${tone}-ink`)).not.toThrow()
    }
  })

  it('form field edges stand out from the ground (3:1)', () => {
    expect(contrast('--color-field-border', '--color-background')).toBeGreaterThanOrEqual(3)
    expect(contrast('--color-field-border', '--color-surface')).toBeGreaterThanOrEqual(3)
  })

  it('--color-primary-rgb matches the primary colour', () => {
    const h = hex('--color-primary')
    const channels = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')
    expect(tokens['--color-primary-rgb']).toBe(channels)
  })

  it('the old gradient button is gone from the site', () => {
    const { execSync } = require('child_process')
    const out = execSync(
      `grep -rlE "linear-gradient\\\\(135deg, *var\\\\(--color-primary\\\\)" src || true`,
      { cwd: resolve(__dirname, '../..'), encoding: 'utf8' },
    )
    expect(out.trim()).toBe('')
  })
})
