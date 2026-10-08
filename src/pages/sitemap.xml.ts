import type { APIRoute } from 'astro'
import { SITE_URL } from '@config/site-url'
import { absoluteUrl } from '@lib/seo'

export const prerender = true

/**
 * The pages we want found. Listed by hand on purpose: the site is small, and
 * staff, host, invite and waiver pages must never appear here. Add a line
 * when a new public page goes live (kits, when that feature is switched on).
 */
export const PUBLIC_PAGES = ['/', '/book', '/workshops', '/calendar', '/craft-cafe', '/about', '/policies']

export function sitemapXml(pages: string[], site: string): string {
  const urls = pages.map((p) => `  <url><loc>${absoluteUrl(p, site)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export const GET: APIRoute = () =>
  new Response(sitemapXml(PUBLIC_PAGES, SITE_URL), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
