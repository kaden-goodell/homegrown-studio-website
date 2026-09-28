import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  absoluteUrl,
  canonicalUrl,
  jsonLdString,
  localBusinessJsonLd,
  pageTitle,
  summarize,
  withStudioOffset,
  workshopEventsJsonLd,
} from '@lib/seo'
import { STUDIO_HOURS, formatHours, formatRange } from '@config/hours'
import { SITE_URL } from '@config/site-url'

const SITE = 'https://ourhometownstudio.com'
const TZ = 'America/Chicago'

const business = {
  name: 'Hometown Studio',
  description: 'Hands-on craft studio in Madison, Alabama.',
  url: SITE,
  phone: '(256) 464-1710',
  email: 'contact@ourhometownstudio.com',
  address: { street: '525 Hughes Rd, Suite F', city: 'Madison', state: 'AL', zip: '35758' },
  image: '/images/share-default.png',
}

const workshop = {
  id: 'clsschi_n566s8pz7qhbtn',
  name: 'Kinusaiga',
  description: 'Kinusaiga is Japanese fabric art with no sewing.\n\nEveryone picks their design.',
  startTime: '2026-10-17T00:00:00.000Z', // 7 PM Central, Fri 16 Oct
  endTime: '2026-10-17T02:00:00.000Z',
  price: 4000,
  currency: 'USD',
  remainingSeats: 35,
  imageUrl: 'https://items-images-production.s3.us-west-2.amazonaws.com/files/abc/original.jpeg',
}

describe('site address', () => {
  it('matches the site set in astro.config.mjs', () => {
    const config = readFileSync(resolve(__dirname, '../../astro.config.mjs'), 'utf8')
    expect(config).toContain(`site: '${SITE_URL}'`)
  })
})

describe('pageTitle', () => {
  it('joins the page and the business name', () => {
    expect(pageTitle('Workshops', 'Hometown Studio')).toBe('Workshops | Hometown Studio')
  })
  it('is the bare name without a page title', () => {
    expect(pageTitle(undefined, 'Hometown Studio')).toBe('Hometown Studio')
  })
})

describe('absoluteUrl', () => {
  it('completes a path', () => {
    expect(absoluteUrl('/images/share-default.png', SITE)).toBe(`${SITE}/images/share-default.png`)
  })
  it('leaves a complete address alone', () => {
    expect(absoluteUrl(workshop.imageUrl, SITE)).toBe(workshop.imageUrl)
  })
})

describe('canonicalUrl', () => {
  it('drops the trailing slash', () => {
    expect(canonicalUrl('/workshops/', SITE)).toBe(`${SITE}/workshops`)
  })
  it('keeps the homepage as the bare address', () => {
    expect(canonicalUrl('/', SITE)).toBe(`${SITE}/`)
  })
  it('always points at the public site, whatever host served the page', () => {
    expect(canonicalUrl('/book', SITE)).toBe(`${SITE}/book`)
  })
})

describe('summarize', () => {
  it('takes the first paragraph', () => {
    expect(summarize(workshop.description)).toBe('Kinusaiga is Japanese fabric art with no sewing.')
  })
  it('strips tags', () => {
    expect(summarize('<p>Make a <b>journal</b>.</p>')).toBe('Make a journal.')
  })
  it('cuts long text at a word and marks it', () => {
    const out = summarize('word '.repeat(80), 60)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/wor…$/)
  })
})

describe('hours', () => {
  it('shows the period once when both ends share it', () => {
    expect(formatRange('16:00', '21:00')).toBe('4 – 9 PM')
  })
  it('shows both periods when they differ', () => {
    expect(formatRange('09:00', '21:00')).toBe('9 AM – 9 PM')
  })
  it('keeps minutes when they matter', () => {
    expect(formatRange('09:30', '12:00')).toBe('9:30 AM – 12 PM')
  })
  it('reads the way the site has always shown them', () => {
    expect(formatHours(STUDIO_HOURS)).toEqual([
      { days: 'Thursday & Friday', time: '4 – 9 PM' },
      { days: 'Saturday', time: '9 AM – 9 PM' },
      { days: 'Sunday', time: '2 – 9 PM' },
    ])
  })
  it('stays open on Sunday until the evening workshops end at 9', () => {
    const sunday = STUDIO_HOURS.find((h) => h.days.includes('Sunday'))
    expect(sunday?.closes).toBe('21:00')
  })
})

describe('localBusinessJsonLd', () => {
  it('describes the business with complete addresses', () => {
    const data = localBusinessJsonLd(business) as any
    expect(data['@type']).toBe('EntertainmentBusiness')
    expect(data.name).toBe('Hometown Studio')
    expect(data.url).toBe(`${SITE}/`)
    expect(data.image).toBe(`${SITE}/images/share-default.png`)
    expect(data.address).toMatchObject({
      streetAddress: '525 Hughes Rd, Suite F',
      addressLocality: 'Madison',
      addressRegion: 'AL',
      postalCode: '35758',
    })
  })

  it('publishes no hours until it is given some', () => {
    expect(localBusinessJsonLd(business)).not.toHaveProperty('openingHoursSpecification')
  })

  it('publishes the same hours the site shows', () => {
    const data = localBusinessJsonLd({ ...business, hours: STUDIO_HOURS }) as any
    expect(data.openingHoursSpecification).toHaveLength(3)
    expect(data.openingHoursSpecification[2]).toMatchObject({ dayOfWeek: ['Sunday'], opens: '14:00', closes: '21:00' })
  })
})

describe('withStudioOffset', () => {
  it('writes daylight time as -05:00', () => {
    expect(withStudioOffset('2026-10-17T00:00:00.000Z', TZ)).toBe('2026-10-16T19:00:00-05:00')
  })
  it('writes standard time as -06:00 after the 1 November clock change', () => {
    expect(withStudioOffset('2026-11-08T01:00:00.000Z', TZ)).toBe('2026-11-07T19:00:00-06:00')
  })
})

describe('workshopEventsJsonLd', () => {
  it('describes a workshop as a bookable event', () => {
    const [event] = workshopEventsJsonLd([workshop], business, TZ) as any[]
    expect(event['@type']).toBe('Event')
    expect(event.name).toBe('Kinusaiga')
    expect(event.startDate).toBe('2026-10-16T19:00:00-05:00')
    expect(event.endDate).toBe('2026-10-16T21:00:00-05:00')
    expect(event.location.address.addressLocality).toBe('Madison')
    expect(event.offers).toMatchObject({
      price: '40.00',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/workshops?w=clsschi_n566s8pz7qhbtn`,
    })
    expect(event.image).toEqual([workshop.imageUrl])
  })

  it('marks a full workshop as sold out', () => {
    const [event] = workshopEventsJsonLd([{ ...workshop, remainingSeats: 0 }], business, TZ) as any[]
    expect(event.offers.availability).toBe('https://schema.org/SoldOut')
  })

  it('leaves the image out when there is none', () => {
    const [event] = workshopEventsJsonLd([{ ...workshop, imageUrl: undefined }], business, TZ) as any[]
    expect(event).not.toHaveProperty('image')
  })
})

describe('jsonLdString', () => {
  it('cannot close the script tag it sits in', () => {
    const out = jsonLdString({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>')
  })
})
