import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PUBLIC_PAGES, sitemapXml } from '@pages/sitemap.xml'

const SITE = 'https://ourhometownstudio.com'

describe('sitemap', () => {
  it('lists every public page with a complete address', () => {
    const xml = sitemapXml(PUBLIC_PAGES, SITE)
    for (const page of ['/book', '/workshops', '/calendar']) {
      expect(xml).toContain(`<loc>${SITE}${page}</loc>`)
    }
    expect(xml).toContain(`<loc>${SITE}/</loc>`)
  })

  it('never lists staff, host, invite, waiver or api pages', () => {
    const xml = sitemapXml(PUBLIC_PAGES, SITE)
    for (const hidden of ['/staff', '/party', '/invite', '/waiver', '/api']) {
      expect(xml).not.toContain(`${SITE}${hidden}`)
    }
  })

  it('only lists pages that exist', () => {
    for (const page of PUBLIC_PAGES) {
      const file = page === '/' ? 'index' : page.slice(1)
      expect(() => readFileSync(resolve(__dirname, `../../src/pages/${file}.astro`), 'utf8')).not.toThrow()
    }
  })
})

describe('robots.txt', () => {
  const robots = readFileSync(resolve(__dirname, '../../public/robots.txt'), 'utf8')

  it('points at the sitemap on the public site', () => {
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('keeps staff and api addresses away from crawlers', () => {
    expect(robots).toContain('Disallow: /staff')
    expect(robots).toContain('Disallow: /api/')
  })

  it('does not block invite pages, so their link previews still work', () => {
    expect(robots).not.toMatch(/Disallow: \/invite/)
  })
})

describe('sitemap: our classes (M7)', () => {
  const base = { libraryId: null, libraryVersion: null, square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [] }
  const rules = (linkOnly: boolean) => ({ ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false })
  const mk = (id: string, status: string, linkOnly = false) => ({
    ...base, id, status,
    content: { name: id, description: '', imageUrl: null, instructor: null, rules: rules(linkOnly), ticketTypes: [], passes: [], prices: {}, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 60 },
    sessions: [{ id: 'ses_1', startIso: '2099-01-01T18:00:00Z', endIso: '2099-01-01T20:00:00Z', capacity: 8 }],
  }) as any
  it('lists /classes/<id> for open classes that are not link-only', async () => {
    const { classPages } = await import('@pages/sitemap.xml')
    expect(classPages([mk('cls_open1', 'open'), mk('cls_link1', 'open', true), mk('cls_draft1', 'draft'), mk('cls_gone1', 'cancelled')]))
      .toEqual(['/classes/cls_open1'])
  })
})
