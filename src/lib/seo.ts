/**
 * What search engines and link previews read: titles, canonical addresses,
 * and structured details about the business and its workshops.
 *
 * Pure functions, no config imports, so both server pages and client
 * components can use them. Callers pass in what they know.
 */
import type { HoursEntry } from '@config/hours'

export interface BusinessDetails {
  name: string
  description: string
  url: string
  phone: string
  email: string
  address: { street: string; city: string; state: string; zip: string }
  image: string
  /** Omit until the doors are open to walk-ins: published hours mean "come in". */
  hours?: HoursEntry[]
}

export interface WorkshopForSeo {
  id: string
  name: string
  description: string
  /** ISO 8601 instants */
  startTime: string
  endTime: string
  /** cents */
  price: number
  currency: string
  remainingSeats: number | null
  imageUrl?: string
}

/** "Workshops | Hometown Studio"; the bare name when there is no page title. */
export function pageTitle(title: string | undefined, siteName: string): string {
  return title ? `${title} | ${siteName}` : siteName
}

/** A complete https:// address for a path or an already-complete address. */
export function absoluteUrl(pathOrUrl: string, site: string): string {
  return new URL(pathOrUrl, site.endsWith('/') ? site : `${site}/`).toString()
}

/**
 * The one address a page should be known by: on the public site, no query
 * string, no trailing slash (except the homepage). `/workshops?w=abc` and
 * `/workshops/` are both `/workshops`.
 */
export function canonicalUrl(pathname: string, site: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  return absoluteUrl(clean, site)
}

/** First paragraph, tags stripped, cut at a word to fit a description. */
export function summarize(text: string, max = 155): string {
  const first = text
    .replace(/<[^>]+>/g, ' ')
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
  if (first.length <= max) return first
  const cut = first.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,;:.–—-]+$/, '')}…`
}

export function localBusinessJsonLd(b: BusinessDetails): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'EntertainmentBusiness',
    '@id': `${absoluteUrl('/', b.url)}#business`,
    name: b.name,
    description: b.description,
    url: absoluteUrl('/', b.url),
    telephone: b.phone,
    email: b.email,
    image: absoluteUrl(b.image, b.url),
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      streetAddress: b.address.street,
      addressLocality: b.address.city,
      addressRegion: b.address.state,
      postalCode: b.address.zip,
      addressCountry: 'US',
    },
    ...(b.hours && b.hours.length > 0
      ? {
          openingHoursSpecification: b.hours.map((h) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: h.days,
            opens: h.opens,
            closes: h.closes,
          })),
        }
      : {}),
  }
}

/** The instant written with the studio's own offset, e.g. 2026-10-16T19:00:00-05:00. */
export function withStudioOffset(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(d)
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? ''
  const offset = get('timeZoneName').replace('GMT', '') || '+00:00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`
}

/**
 * One Event per public workshop. Google's rules: events must be bookable by
 * the public and describe what is visible on the page, so private parties and
 * opening hours are never passed here.
 */
export function workshopEventsJsonLd(
  workshops: WorkshopForSeo[],
  business: Pick<BusinessDetails, 'name' | 'url' | 'address'>,
  timeZone: string,
): Record<string, unknown>[] {
  return workshops.map((w) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: w.name,
    description: summarize(w.description, 300),
    startDate: withStudioOffset(w.startTime, timeZone),
    endDate: withStudioOffset(w.endTime, timeZone),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(w.imageUrl ? { image: [absoluteUrl(w.imageUrl, business.url)] } : {}),
    location: {
      '@type': 'Place',
      name: business.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: business.address.street,
        addressLocality: business.address.city,
        addressRegion: business.address.state,
        postalCode: business.address.zip,
        addressCountry: 'US',
      },
    },
    organizer: { '@type': 'Organization', name: business.name, url: absoluteUrl('/', business.url) },
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/workshops?w=${encodeURIComponent(w.id)}`, business.url),
      price: (w.price / 100).toFixed(2),
      priceCurrency: w.currency,
      availability:
        w.remainingSeats === 0 ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    },
  }))
}

/** Safe to place inside <script type="application/ld+json">. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
