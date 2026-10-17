import { describe, it, expect } from 'vitest'
import { siteConfig } from '@config/site.config'
import { buildNav, flatNav, navHoldsPath } from '@lib/nav'

const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe('the site menu (Kaden picked option A, 17 Oct 2026)', () => {
  const nav = buildNav(siteConfig, { kitsVisible: false })

  it('five items across the top: two groups and three pages', () => {
    expect(labels(nav)).toEqual(['Parties & Events', 'Workshops', 'Craft Café', 'Calendar', 'About'])
  })

  it('Parties & Events holds Parties and Private Events, each with its line', () => {
    const group = nav[0]
    expect(group.href).toBeUndefined()
    expect(group.children).toEqual([
      { label: 'Parties', href: '/book', note: 'Our weekend times. Book online in minutes.' },
      { label: 'Private Events', href: '/private-events', note: 'Your day and time, at the studio or your place.' },
    ])
  })

  it('Take Home Kits joins Parties & Events only while kits are showing', () => {
    expect(flatNav(nav).some((i) => i.href === '/kits')).toBe(false)
    const withKits = buildNav(siteConfig, { kitsVisible: true })
    expect(labels(withKits[0].children!)).toEqual(['Parties', 'Private Events', 'Take Home Kits'])
  })

  it('About holds Our Story and Teach a Class', () => {
    expect(nav[4].children).toEqual([{ label: 'Our Story', href: '/about' }, { label: 'Teach a Class', href: '/teach' }])
  })

  it('the footer gets every page, in order, groups opened up', () => {
    expect(flatNav(nav).map((i) => i.href)).toEqual(['/book', '/private-events', '/workshops', '/craft-cafe', '/calendar', '/about', '/teach'])
  })

  it('a group holds the page you are on when any of its pages is it', () => {
    expect(navHoldsPath(nav[0], '/private-events/')).toBe(true)
    expect(navHoldsPath(nav[0], '/workshops')).toBe(false)
    expect(navHoldsPath(nav[4], '/teach')).toBe(true)
    expect(navHoldsPath(nav[1], '/workshops')).toBe(true)
  })

  it('a group left empty is dropped', () => {
    const cfg = { ...siteConfig, nav: [{ label: 'Kits only', children: [{ label: 'Kits', href: '/kits' }] }, { label: 'Calendar', href: '/calendar' }] }
    expect(labels(buildNav(cfg, { kitsVisible: false }))).toEqual(['Calendar'])
  })

  it('without a configured menu, falls back to the feature list', () => {
    const cfg = { ...siteConfig, nav: [] }
    expect(labels(buildNav(cfg, { kitsVisible: false }))).toContain('Home')
  })
})
