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
