import { describe, it, expect } from 'vitest'
import { buildClassLinkEmail, classLinkUrl } from '../../src/lib/class-link-email'

const earrings = {
  id: 'clsschi_abc',
  name: 'Christmas Earring Bar',
  description: 'Build your own Christmas earrings.\n\nEach guest goes home with the earrings they make. Ages 18 and up.',
  startAt: '2026-11-13T00:00:00.000Z', // Thu Nov 12, 6 PM Central
  durationMinutes: 120,
  priceCents: 3500,
  imageUrl: 'https://items-images.example.com/earrings.jpg',
}
const SITE = 'https://ourhometownstudio.com'

describe('class link email', () => {
  it('subject is the class and its studio-local day and time', () => {
    const { subject } = buildClassLinkEmail(earrings, SITE)
    expect(subject).toBe('Christmas Earring Bar · Thu, Nov 12, 6–8 PM')
  })

  it('links back to this class, tagged so the booking is credited to the email', () => {
    const url = classLinkUrl(SITE, 'clsschi_abc')
    expect(url).toBe('https://ourhometownstudio.com/workshops?w=clsschi_abc&utm_source=email&utm_medium=email&utm_campaign=class_link')
    const { html, text } = buildClassLinkEmail(earrings, SITE + '/')
    expect(html).toContain(url.replace(/&/g, '&amp;'))
    expect(text).toContain(`Book your seat: ${url}`)
    expect(html).toContain('>Book your seat</a>')
  })

  it('carries the photo, every paragraph, the price and the address', () => {
    const { html, text } = buildClassLinkEmail(earrings, SITE)
    expect(html).toContain('src="https://items-images.example.com/earrings.jpg"')
    expect(text).toContain('Build your own Christmas earrings.')
    expect(text).toContain('Ages 18 and up.')
    expect(text).toContain('$35 a seat · 525 Hughes Rd, Madison')
  })

  it('leaves the price out when the class has none yet, and the photo out when there is none', () => {
    const { html, text } = buildClassLinkEmail({ ...earrings, priceCents: 0, imageUrl: undefined }, SITE)
    expect(text).not.toMatch(/a seat/)
    expect(html).not.toContain('<img')
  })

  it('escapes class words in the HTML', () => {
    const { html } = buildClassLinkEmail({ ...earrings, name: 'Paint & <Sip>' }, SITE)
    expect(html).toContain('Paint &amp; &lt;Sip&gt;')
    expect(html).not.toContain('<Sip>')
  })

  it('says it is the only one', () => {
    expect(buildClassLinkEmail(earrings, SITE).text).toContain('This is the only email you will get about it.')
  })

  it('our own classes: links to the class’s own page, says the card’s price and how many sessions', () => {
    const own = { ...earrings, id: 'cls_tee1', priceCents: 0, path: '/classes/cls_tee1', priceLabel: '$20 kid · $30 adult', sessionsLabel: '4 sessions · starts Thu Nov 12' }
    const { html, text } = buildClassLinkEmail(own, SITE)
    expect(classLinkUrl(SITE, 'cls_tee1', '/classes/cls_tee1')).toBe('https://ourhometownstudio.com/classes/cls_tee1?utm_source=email&utm_medium=email&utm_campaign=class_link')
    expect(text).toContain('Book your seat: https://ourhometownstudio.com/classes/cls_tee1?utm_source=email')
    expect(text).toContain('$20 kid · $30 adult · 525 Hughes Rd, Madison')
    expect(text).toContain('Thu, Nov 12 · 6–8 PM · 4 sessions · starts Thu Nov 12')
    expect(html).not.toContain('a seat')
  })
})

