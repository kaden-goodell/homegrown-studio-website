import type { APIRoute } from 'astro'
import { SITE_URL } from '@config/site-url'
import { absoluteUrl } from '@lib/seo'
import { listClasses } from '@lib/classes/class-store'
import type { ScheduledClass } from '@lib/classes/types'

// Built on each request: our own classes come and go (M7).
export const prerender = false

/**
 * The pages we want found. Listed by hand on purpose: the site is small, and
 * staff, host, invite and waiver pages must never appear here. Add a line
 * when a new public page goes live (kits, when that feature is switched on).
 */
export const PUBLIC_PAGES = ['/', '/book', '/private-events', '/workshops', '/calendar', '/craft-cafe', '/about', '/teach', '/contact', '/policies']

export function sitemapXml(pages: string[], site: string): string {
  const urls = pages.map((p) => `  <url><loc>${absoluteUrl(p, site)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Our own classes with a page worth finding: open, and not link-only. */
export function classPages(classes: ScheduledClass[]): string[] {
  return classes
    .filter((c) => c.status === 'open' && !c.content.rules.linkOnly && c.sessions.length > 0)
    .map((c) => `/classes/${c.id}`)
}

export const GET: APIRoute = async () => {
  let classes: string[] = []
  try {
    // A date range: listClasses reads only the classes the class index says fall in it.
    classes = classPages(await listClasses({ fromIso: new Date().toISOString(), toIso: new Date(Date.now() + 400 * 86_400_000).toISOString() }))
  } catch (e) {
    // The fixed pages still go out; the classes come back on the next read.
    console.warn(`[sitemap] classes unreadable: ${e instanceof Error ? e.message : e}`)
  }
  return new Response(sitemapXml([...PUBLIC_PAGES, ...classes], SITE_URL), {
    // M8: Netlify's edge keeps it an hour, so a crawl doesn't read the class store (the read itself uses the class index).
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
