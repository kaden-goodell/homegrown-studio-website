/**
 * Short links we hand to partners and advertisers: ourhometownstudio.com/go/<slug>.
 * Each one redirects to the site with campaign tags on it, so bookings that
 * came through it are credited in PostHog and Google Analytics (see
 * src/lib/attribution.ts). Add a line here for a new partner.
 */
export interface ShortLink {
  /** Who is sharing it (becomes utm_source). */
  source: string
  /** How it reaches people (becomes utm_medium). */
  medium: string
  campaign?: string
  /** Page it lands on. Defaults to the home page. */
  to?: string
}

export const SHORT_LINKS: Record<string, ShortLink> = {
  'all-things-madison': { source: 'all-things-madison', medium: 'partner' },
}

/** Where /go/<slug> sends someone, or null for an unknown slug. */
export function shortLinkTarget(slug: string): string | null {
  const link = Object.hasOwn(SHORT_LINKS, slug.toLowerCase()) ? SHORT_LINKS[slug.toLowerCase()] : null
  if (!link) return null
  const q = new URLSearchParams({ utm_source: link.source, utm_medium: link.medium })
  if (link.campaign) q.set('utm_campaign', link.campaign)
  return `${link.to ?? '/'}?${q}`
}
