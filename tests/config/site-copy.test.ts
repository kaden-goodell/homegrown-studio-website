import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { partyContent } from '@config/party-content'
import { partyConfig } from '@config/party.config'
import { formatMoney } from '@lib/money'

/**
 * Copy rules for the header, footer, homepage, party copy, host dashboard and
 * checkout summary (HOM-198): the studio is for everyone ages 8 and up, prices
 * come from config or Square and are never typed into a sentence, and labels
 * are plain words.
 */

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8')

const FILES = [
  'src/components/shared/Header.astro',
  'src/components/shared/Footer.astro',
  'src/components/shared/Shimmer.tsx',
  'src/config/party-content.ts',
  'src/pages/index.astro',
  'src/components/party/PartyDashboard.tsx',
  'src/components/checkout/OrderSummary.tsx',
  'src/components/checkout/PaymentForm.tsx',
]

describe('site copy', () => {
  describe.each(FILES)('%s', (path) => {
    const source = read(path)

    it.each([
      ['"What’s on"', /what(’|'|&rsquo;)s on/i],
      ['children’s characters', /Bluey|princess|superhero/i],
      ['"kid" or "kids"', /\bkids?\b/i],
      ['the hand-typed craft price range', /\$15\s*(–|-|to)\s*\$40/],
      ['"Most popular"', /most popular/i],
      ['hearts and emoji', /[☀-➿\u{1F300}-\u{1FAFF}]/u],
      ['a price ending in ".00"', /\$\d[\d,]*\.00\b/],
    ])('has no %s', (_what, pattern) => {
      expect(source).not.toMatch(pattern)
    })

    it('formats money through formatMoney, not by hand', () => {
      expect(source).not.toMatch(/\/ 100\)?\.toFixed\(2\)\}?`/)
      expect(source).not.toMatch(/`\$\$\{/)
    })
  })

  describe('homepage', () => {
    const home = read('src/pages/index.astro')

    it('types no dollar amount into its copy', () => {
      expect(home).not.toMatch(/\$\d/)
    })

    it('takes the party price from the party config', () => {
      expect(home).toContain('formatMoney(partyConfig.basePriceCents)')
    })

    it('prices workshops "per seat" without naming a number', () => {
      expect(home).toContain("price: 'Priced per seat'")
    })

    it('sends the opening banner to the calendar, not the booking page', () => {
      const banner = home.slice(home.indexOf('id="opening-banner"'), home.indexOf('</div>', home.indexOf('id="opening-banner"')))
      expect(banner).toContain('href="/calendar"')
      expect(banner).not.toContain('href="/book"')
    })

    it('says "See the calendar"', () => {
      expect(home).toContain('See the calendar</a>')
    })
  })

  describe('party FAQ', () => {
    const theme = partyContent.faq.find((f) => /theme/i.test(f.q))

    it('asks the theme question for all ages', () => {
      expect(theme?.q).toBe('Can you do a theme?')
    })

    it('keeps the substance: no trademarked characters, colours matched, own decorations welcome', () => {
      expect(theme?.a).toMatch(/trademarked/i)
      expect(theme?.a).toMatch(/colors/i)
      expect(theme?.a).toMatch(/bring your own/i)
    })

    it('quotes the studio fee from config, in whole dollars', () => {
      const cost = partyContent.faq.find((f) => /how much/i.test(f.q))!
      expect(cost.a).toContain(`${formatMoney(partyConfig.basePriceCents)} studio fee`)
      expect(partyContent.deposit.holdLine.startsWith(`${formatMoney(partyConfig.basePriceCents)} holds your date`)).toBe(true)
    })

    it('names no craft price: each craft shows its own when picked', () => {
      const cost = partyContent.faq.find((f) => /how much/i.test(f.q))!
      expect(cost.a).toContain('Each craft has its own per-person price, shown when you pick one.')
      const dollars = cost.a.match(/\$\d+/g) ?? []
      expect(dollars).toEqual([formatMoney(partyConfig.basePriceCents)])
    })
  })
})
