import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * book.astro can't be rendered in this test setup, so these read its source.
 * They hold the two things the rest of the site relies on: the
 * `data-open-booking` contract with PartyLanding, and no typed-in prices.
 */
const source = readFileSync(resolve(__dirname, '../../src/pages/book.astro'), 'utf8')
const template = source.slice(source.indexOf('---', 3) + 3)
const landing = readFileSync(resolve(__dirname, '../../src/components/party/PartyLanding.tsx'), 'utf8')

/** Every opening tag of the given element, as written. */
function tags(name: string): string[] {
  return template.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? []
}

describe('/book page', () => {
  it('opens the booking panel from the hero and from the end of the page', () => {
    const bookingLinks = tags('a').filter((tag) => /\bdata-open-booking\b/.test(tag))
    expect(bookingLinks).toHaveLength(2)
    for (const tag of bookingLinks) {
      // a real link, so it still goes somewhere before the script loads
      expect(tag).toContain('href="/book"')
      expect(tag).toContain('btn-primary')
    }
    expect(template.match(/Book your date/g)).toHaveLength(2)
  })

  it('ends with a booking button, after the FAQ', () => {
    const faq = template.indexOf('<PartyFaq')
    const closing = template.indexOf('Ready to pick a date?')
    expect(faq).toBeGreaterThan(-1)
    expect(closing).toBeGreaterThan(faq)
    expect(template.indexOf('data-open-booking', closing)).toBeGreaterThan(closing)
  })

  it('keeps the filled button for booking: "See open dates" is a text link to the dates', () => {
    const link = tags('a').find((tag) => tag.includes('href="#open-dates"'))
    expect(link).toBeDefined()
    expect(link).toContain('btn-quiet')
    expect(link).not.toContain('btn-primary')
  })

  it('shows the price line beside both booking buttons', () => {
    expect(tags('PartyPriceLine')).toHaveLength(2)
  })

  it('types no prices into the page', () => {
    expect(template).not.toMatch(/\$\d/)
  })

  it('puts the kits teaser below the booking content and the FAQ last before the closing button', () => {
    const landing = template.indexOf('<PartyLanding')
    const kits = template.indexOf('Take-home party kits')
    expect(landing).toBeGreaterThan(-1)
    expect(kits).toBeGreaterThan(landing)
    expect(template.indexOf('<PartyFaq')).toBeGreaterThan(kits)
  })

  it('keeps the closed notice and its sign-up', () => {
    expect(template).toContain('id="notify"')
    expect(template).toContain('interest={interest}')
    expect(template).toContain('holds a date once booking opens.')
  })

  it('does not import the server-only site config into anything the browser gets', () => {
    expect(landing).not.toContain('site.config')
  })

  // The same copy rules the rest of the site is held to (tests/config/site-copy.test.ts).
  describe.each([
    ['src/pages/book.astro', source],
    ['src/components/party/PartyLanding.tsx', landing],
  ])('%s', (_path, text) => {
    it.each([
      ['"What’s on"', /what(’|'|&rsquo;)s on/i],
      ['"kid" or "kids"', /\bkids?\b/i],
      ['hearts and emoji', /[☀-➿\u{1F300}-\u{1FAFF}]/u],
      ['a price ending in ".00"', /\$\d[\d,]*\.00\b/],
      ['"Home Town" as two words', /Home Town/],
    ])('has no %s', (_what, pattern) => {
      expect(text).not.toMatch(pattern)
    })

    it('formats money through formatMoney, not by hand', () => {
      expect(text).not.toMatch(/toFixed\(/)
      expect(text).not.toMatch(/`\$\$\{/)
      expect(text).not.toMatch(/Intl\.NumberFormat/)
    })
  })
})
