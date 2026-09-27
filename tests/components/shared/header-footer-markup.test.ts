import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Header.astro and Footer.astro are not rendered by the test runner, so these
 * read the source: the menu is a real button, every link is tall enough to
 * tap, nothing switches the focus ring off, and the booking buttons carry the
 * attribute the /book page listens for.
 */

const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8')
const header = read('src/components/shared/Header.astro')
const footer = read('src/components/shared/Footer.astro')
const globalCss = read('src/styles/global.css')

/** `selector { declarations }` for every rule in a file's <style> block. */
function rules(source: string): { selector: string; body: string }[] {
  const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'))
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    body: m[2],
  }))
}

function rule(source: string, selector: string): string {
  const found = rules(source).filter((r) => r.selector === selector)
  if (found.length === 0) throw new Error(`no rule for ${selector}`)
  return found.map((r) => r.body).join('\n')
}

/** The opening tag that contains `marker`. */
function tag(source: string, marker: string): string {
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`${marker} not found`)
  return source.slice(source.lastIndexOf('<', at), source.indexOf('>', at) + 1)
}

/** 2.75rem is 44px at the browser's default text size. */
const TAP = /min-height:\s*2\.75rem/

describe('header menu button', () => {
  const button = tag(header, 'id="menu-button"')

  it('is a real button, not a checkbox', () => {
    expect(button.startsWith('<button')).toBe(true)
    expect(button).toContain('type="button"')
    expect(header).not.toContain('type="checkbox"')
    expect(header).not.toContain(':checked')
  })

  it('is named "Menu" and says whether the menu is open', () => {
    expect(button).toContain('aria-label="Menu"')
    expect(button).toContain('aria-expanded="false"')
  })

  it('points at the menu it opens', () => {
    expect(button).toContain('aria-controls="mobile-menu"')
    expect(header).toMatch(/<div[^>]*id="mobile-menu"/)
  })

  it('is at least 44px by 44px', () => {
    const css = rule(header, '.header-burger')
    expect(css).toMatch(/width:\s*2\.75rem/)
    expect(css).toMatch(/height:\s*2\.75rem/)
  })

  it('shows and hides the menu from aria-expanded, so the two never disagree', () => {
    expect(header).toContain(".header-burger[aria-expanded='true'] ~ .mobile-drawer")
  })

  it('runs the shared header script', () => {
    expect(header).toMatch(/import \{[^}]*initSiteHeader[^}]*\} from '@lib\/site-header'/)
  })
})

describe('tap targets', () => {
  it.each(['.header-brand', '.header-cta', '.header-cta-mobile', '.header-link', '.mobile-link'])(
    'header %s is at least 44px tall',
    (selector) => {
      expect(rule(header, selector)).toMatch(TAP)
    },
  )

  it.each(['.footer-logo-link', '.footer-link'])('footer %s is at least 44px tall', (selector) => {
    expect(rule(footer, selector)).toMatch(TAP)
  })

  it('every footer link is a footer link or the logo', () => {
    const markup = footer.slice(footer.indexOf('<footer'), footer.indexOf('</footer>'))
    const links = [...markup.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toMatch(/class="(footer-link|footer-logo-link)"/)
  })

  it('carries no button: the header already has the booking button on every page', () => {
    expect(footer.slice(footer.indexOf('<footer'), footer.indexOf('</footer>'))).not.toMatch(/class="[^"]*\bbtn\b/)
  })

  it('is laid out from the left in columns, never centred or pushed to the right', () => {
    for (const r of rules(footer)) {
      expect(r.body, r.selector).not.toMatch(/text-align:\s*(center|right)/)
      expect(r.body, r.selector).not.toMatch(/align-items:\s*flex-end/)
    }
  })

  it('never lets the studio\'s name wrap onto two lines', () => {
    expect(rule(footer, '.footer-name')).toMatch(/white-space:\s*nowrap/)
  })
})

describe('footer band', () => {
  it('is a dark band with light text, in tokens', () => {
    const band = footer.match(/\.site-footer\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(band).toMatch(/background:\s*var\(--color-dark\)/)
    expect(band).toMatch(/(?<![-\w])color:\s*var\(--color-on-dark-muted\)/)
  })

  it('shows its focus ring in a colour that can be seen on the dark band', () => {
    expect(footer).toMatch(/\.footer-link:focus-visible[^{]*\{[^}]*outline-color:\s*var\(--color-on-dark\)/)
  })

  it('has the three columns: visit, hours, contact', () => {
    const headings = [...footer.matchAll(/<h2 class="footer-heading">([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(headings).toEqual(['Visit', 'Hours', 'Contact'])
  })
})

describe('keyboard focus', () => {
  it('global.css draws a 2px ring, 2px off, in the brand brown on every link and button', () => {
    const ring = globalCss.match(/:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/)
    expect(ring).not.toBeNull()
    expect(ring![1]).toMatch(/\ba\b/)
    expect(ring![1]).toMatch(/\bbutton\b/)
    expect(ring![2]).toMatch(/outline:\s*2px solid var\(--color-primary\)/)
    expect(ring![2]).toMatch(/outline-offset:\s*2px/)
  })

  it.each([
    ['header', header],
    ['footer', footer],
  ])('the %s never switches the ring off', (_name, source) => {
    expect(source).not.toMatch(/outline(-width|-style)?:\s*(none|0)\b/)
  })
})

describe('booking buttons', () => {
  it.each(['class="header-cta"', 'class="header-cta-mobile"', 'class="mobile-link mobile-link-cta"'])(
    '%s opens the booking panel on /book',
    (marker) => {
      const link = tag(header, marker)
      expect(link).toContain('data-open-booking={opensBooking}')
      expect(link).toContain('href={siteConfig.navCta.href}')
    },
  )

  it('only when the button points at /book', () => {
    expect(header).toContain("const opensBooking = normalizePath(siteConfig.navCta.href) === '/book'")
  })
})

describe('footer text', () => {
  it('never fades: no opacity on anything in the footer', () => {
    for (const r of rules(footer)) expect(r.body, r.selector).not.toMatch(/opacity\s*:/)
  })
})
