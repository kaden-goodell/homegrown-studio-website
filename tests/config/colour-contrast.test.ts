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

  // The header has no ground of its own: its text sits on the page's cream,
  // except a filled button, which brings its own background. The footer is a
  // band with its own ground (.site-footer's background), and its text sits on that.
  // Every text colour they declare is read from the component itself, so a new
  // or changed colour is checked without anyone remembering to list it here.
  for (const name of ['Footer', 'Header']) {
    describe(`${name.toLowerCase()} text`, () => {
      const source = readFileSync(resolve(__dirname, `../../src/components/shared/${name}.astro`), 'utf8')
      const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'))
      const declared = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => {
        const colour = body.match(/(?<![-\w])color\s*:\s*([^;]+);/)?.[1].trim()
        if (!colour) return []
        const ground = body.match(/(?<![-\w])background(?:-color)?\s*:\s*([^;]+);/)?.[1].trim()
        return [{ selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(), colour, ground }]
      })
      const token = (value: string) => value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1]
      // A band's own ground, if the component is one.
      const band = style.match(/\.site-(?:footer|header)\s*\{([^}]*)\}/)?.[1].match(/(?<![-\w])background(?:-color)?\s*:\s*var\((--[a-z0-9-]+)\)/)?.[1]

      it('declares its text colours', () => {
        expect(declared.length).toBeGreaterThan(3)
      })

      it('sets no colour in the markup, where this test cannot see it', () => {
        const markup = source.slice(0, source.indexOf('<style>'))
        expect(markup).not.toMatch(/style="[^"]*color/)
      })

      for (const { selector, colour, ground } of declared) {
        it(`${selector} is readable (4.5:1)`, () => {
          const fg = token(colour)
          const bg = ground ? token(ground) : (band ?? '--color-background')
          expect(fg, `${selector} colour "${colour}" must be a token`).toBeTruthy()
          expect(bg, `${selector} background "${ground}" must be a token`).toBeTruthy()
          expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5)
          // On the page's own ground, the text also has to read on the sand
          // band that can sit behind it.
          if (!ground && !band) expect(contrast(fg!, '--color-sand')).toBeGreaterThanOrEqual(4.5)
        })
      }
    })
  }

  it('the footer’s small print reads on the dark band', () => {
    const footer = readFileSync(resolve(__dirname, '../../src/components/shared/Footer.astro'), 'utf8')
    const copyright = footer.match(/\.footer-copyright\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(copyright).toMatch(/color:\s*var\(--color-on-dark-muted\)/)
    expect(contrast('--color-on-dark-muted', '--color-dark')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--color-on-dark', '--color-dark')).toBeGreaterThanOrEqual(4.5)
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
