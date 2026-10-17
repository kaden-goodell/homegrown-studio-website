import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizePath, isActivePath, initSiteHeader, isMenuOpen } from '@lib/site-header'

/** The parts of Header.astro the script touches. */
const HEADER = `
  <header id="site-header">
    <nav>
      <a href="/" class="header-brand">Hometown Studio</a>
      <ul class="header-links">
        <li><a class="header-link" href="/book">Parties</a></li>
        <li><a class="header-link" href="/craft-cafe">Craft Café</a></li>
        <li><a class="header-link" href="/about">About</a></li>
      </ul>
      <a href="/book" class="header-cta-mobile" data-open-booking>Book</a>
      <div class="header-mobile">
        <button type="button" id="menu-button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu"></button>
        <div id="mobile-menu">
          <ul>
            <li><a class="mobile-link" href="/book">Parties</a></li>
            <li><a class="mobile-link" href="/craft-cafe">Craft Café</a></li>
            <li><a class="mobile-link" href="/about">About</a></li>
            <li><a class="mobile-link mobile-link-cta" href="/book" data-open-booking>Book a Party</a></li>
          </ul>
        </div>
      </div>
    </nav>
  </header>
  <main><a id="outside" href="/somewhere">Somewhere</a></main>
`

const button = () => document.getElementById('menu-button')!
const menuLinks = () => [...document.querySelectorAll<HTMLAnchorElement>('#mobile-menu a')]
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('normalizePath', () => {
  it.each([
    ['/about/', '/about'],
    ['/about', '/about'],
    ['/craft-cafe/', '/craft-cafe'],
    ['/policies/', '/policies'],
    ['/party/abc/', '/party/abc'],
    ['/', '/'],
    ['', '/'],
    ['/about//', '/about'],
  ])('%s becomes %s', (given, expected) => {
    expect(normalizePath(given)).toBe(expected)
  })
})

describe('isActivePath', () => {
  it('matches a page served with a trailing slash', () => {
    expect(isActivePath('/about', '/about/')).toBe(true)
    expect(isActivePath('/craft-cafe', '/craft-cafe/')).toBe(true)
    expect(isActivePath('/policies', '/policies/')).toBe(true)
  })

  it('matches a link written with a trailing slash', () => {
    expect(isActivePath('/about/', '/about')).toBe(true)
  })

  it('ignores a query or an anchor on the link', () => {
    expect(isActivePath('/workshops?w=abc', '/workshops')).toBe(true)
    expect(isActivePath('/policies#parties', '/policies/')).toBe(true)
  })

  it('does not match a different page', () => {
    expect(isActivePath('/about', '/about-us')).toBe(false)
    expect(isActivePath('/book', '/')).toBe(false)
    expect(isActivePath('/', '/about')).toBe(false)
    expect(isActivePath(null, '/about')).toBe(false)
  })

  it('matches the homepage only on the homepage', () => {
    expect(isActivePath('/', '/')).toBe(true)
  })
})

describe('site header', () => {
  beforeEach(() => {
    document.body.innerHTML = HEADER
    // jsdom cannot follow links; keep a click on one from trying.
    document.body.addEventListener('click', (e) => e.preventDefault())
    window.history.replaceState({}, '', '/')
    initSiteHeader()
  })

  describe('menu button', () => {
    it('opens the menu and says so', () => {
      button().click()
      expect(button().getAttribute('aria-expanded')).toBe('true')
      expect(isMenuOpen()).toBe(true)
    })

    it('moves focus to the first link when it opens', () => {
      button().click()
      expect(document.activeElement).toBe(menuLinks()[0])
    })

    it('closes on a second press and keeps focus on the button', () => {
      button().click()
      button().click()
      expect(button().getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(button())
    })

    it('closes on Escape and returns focus to the button', () => {
      button().click()
      press('Escape')
      expect(button().getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(button())
    })

    it('leaves focus alone on Escape when the menu is already closed', () => {
      const outside = document.getElementById('outside')!
      outside.focus()
      press('Escape')
      expect(document.activeElement).toBe(outside)
    })

    it('closes when a link in it is chosen', () => {
      button().click()
      menuLinks()[1].click()
      expect(isMenuOpen()).toBe(false)
    })

    it('closes on a press anywhere outside it, without taking focus', () => {
      button().click()
      const outside = document.getElementById('outside')!
      outside.focus()
      outside.click()
      expect(isMenuOpen()).toBe(false)
      expect(document.activeElement).toBe(outside)
    })

    it('closes when focus moves on past the last link', () => {
      button().click()
      const outside = document.getElementById('outside')!
      const last = menuLinks().at(-1)!
      last.focus()
      last.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
      expect(isMenuOpen()).toBe(false)
    })

    it('stays open while focus moves between its own links', () => {
      button().click()
      const [first, second] = menuLinks()
      first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: second }))
      expect(isMenuOpen()).toBe(true)
    })

    it('still works on a header that replaced the first one (in-site navigation)', () => {
      initSiteHeader()
      document.body.innerHTML = HEADER
      button().click()
      expect(isMenuOpen()).toBe(true)
      expect(document.activeElement).toBe(menuLinks()[0])
      press('Escape')
      expect(isMenuOpen()).toBe(false)
    })

    it('toggles once per press however many times the script has run', () => {
      initSiteHeader()
      initSiteHeader()
      button().click()
      expect(isMenuOpen()).toBe(true)
    })
  })

  describe('after in-site navigation', () => {
    const active = () =>
      [...document.querySelectorAll('.is-active')].map((el) => `${el.className.split(' ')[0]}:${el.getAttribute('href')}`)

    it.each(['/about/', '/craft-cafe/'])('underlines the link for %s', (path) => {
      window.history.replaceState({}, '', path)
      document.dispatchEvent(new Event('astro:page-load'))
      const href = path.slice(0, -1)
      expect(active()).toEqual([`header-link:${href}`, `mobile-link:${href}`])
    })

    it('moves the underline from the old page to the new one', () => {
      window.history.replaceState({}, '', '/about/')
      document.dispatchEvent(new Event('astro:page-load'))
      window.history.replaceState({}, '', '/book')
      document.dispatchEvent(new Event('astro:page-load'))
      expect(active()).toEqual(['header-link:/book', 'mobile-link:/book'])
    })

    it('leaves the menu’s booking button out of it', () => {
      window.history.replaceState({}, '', '/book')
      document.dispatchEvent(new Event('astro:page-load'))
      const cta = document.querySelector('.mobile-link-cta')!
      expect(cta.classList.contains('is-active')).toBe(false)
      expect(cta.hasAttribute('aria-current')).toBe(false)
    })

    it('marks the current page for screen readers', () => {
      window.history.replaceState({}, '', '/about/')
      document.dispatchEvent(new Event('astro:page-load'))
      const current = [...document.querySelectorAll('[aria-current="page"]')].map((el) => el.getAttribute('href'))
      expect(current).toEqual(['/about', '/about'])
    })

    it('closes the menu', () => {
      button().click()
      document.dispatchEvent(new Event('astro:page-load'))
      expect(isMenuOpen()).toBe(false)
    })
  })

  describe('scrolled state', () => {
    it('follows the scroll position', () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })
      const header = document.getElementById('site-header')!
      Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
      window.dispatchEvent(new Event('scroll'))
      expect(header.classList.contains('scrolled')).toBe(true)
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
      window.dispatchEvent(new Event('scroll'))
      expect(header.classList.contains('scrolled')).toBe(false)
      vi.unstubAllGlobals()
    })
  })
})

/** The wide-screen groups ("Parties & Events ▾"), as Header.astro renders them. */
const GROUPED = `
  <header id="site-header">
    <nav>
      <ul class="header-links">
        <li class="nav-group">
          <button type="button" class="header-link nav-group-btn" aria-expanded="false" aria-controls="nav-group-0" data-nav-paths="/book /private-events">Parties &amp; Events</button>
          <div class="nav-panel" id="nav-group-0"><ul class="nav-panel-list">
            <li><a class="nav-sub" href="/book">Parties</a></li>
            <li><a class="nav-sub" href="/private-events">Private Events</a></li>
          </ul></div>
        </li>
        <li><a class="header-link" href="/workshops">Workshops</a></li>
        <li class="nav-group">
          <button type="button" class="header-link nav-group-btn" aria-expanded="false" aria-controls="nav-group-4" data-nav-paths="/about /teach">About</button>
          <div class="nav-panel" id="nav-group-4"><ul class="nav-panel-list">
            <li><a class="nav-sub" href="/about">Our Story</a></li>
            <li><a class="nav-sub" href="/teach">Teach a Class</a></li>
          </ul></div>
        </li>
      </ul>
      <div class="header-mobile">
        <button type="button" id="menu-button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu"></button>
        <div id="mobile-menu"><ul><li><a class="mobile-link" href="/workshops">Workshops</a></li></ul></div>
      </div>
    </nav>
  </header>
  <main><a id="outside" href="/somewhere">Somewhere</a></main>
`

describe('menu groups', () => {
  const parties = () => document.querySelector<HTMLButtonElement>('[aria-controls="nav-group-0"]')!
  const about = () => document.querySelector<HTMLButtonElement>('[aria-controls="nav-group-4"]')!
  const open = (b: HTMLElement) => b.getAttribute('aria-expanded') === 'true'

  beforeEach(() => {
    document.body.innerHTML = GROUPED
    document.body.addEventListener('click', (e) => e.preventDefault())
    window.history.replaceState({}, '', '/')
    initSiteHeader()
  })

  it('a press opens a group, and a second press closes it', () => {
    parties().click()
    expect(open(parties())).toBe(true)
    parties().click()
    expect(open(parties())).toBe(false)
  })

  it('only one group is open at a time', () => {
    parties().click()
    about().click()
    expect(open(parties())).toBe(false)
    expect(open(about())).toBe(true)
  })

  it('closes when a page in it is chosen', () => {
    parties().click()
    document.querySelector<HTMLAnchorElement>('a[href="/private-events"]')!.click()
    expect(open(parties())).toBe(false)
  })

  it('closes on a press outside it', () => {
    parties().click()
    document.getElementById('outside')!.click()
    expect(open(parties())).toBe(false)
  })

  it('closes on Escape and puts focus back on its button', () => {
    parties().click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(open(parties())).toBe(false)
    expect(document.activeElement).toBe(parties())
  })

  it('closes when focus tabs out of it, but not while it moves inside', () => {
    parties().click()
    const sub = document.querySelector<HTMLAnchorElement>('a[href="/book"]')!
    parties().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: sub }))
    expect(open(parties())).toBe(true)
    sub.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('a[href="/workshops"]') }))
    expect(open(parties())).toBe(false)
  })

  it('underlines the group while you are on one of its pages, and marks the page', () => {
    window.history.replaceState({}, '', '/private-events/')
    document.dispatchEvent(new Event('astro:page-load'))
    expect(parties().classList.contains('is-active')).toBe(true)
    expect(about().classList.contains('is-active')).toBe(false)
    expect(document.querySelector('a[href="/private-events"]')!.getAttribute('aria-current')).toBe('page')
    window.history.replaceState({}, '', '/teach')
    document.dispatchEvent(new Event('astro:page-load'))
    expect(parties().classList.contains('is-active')).toBe(false)
    expect(about().classList.contains('is-active')).toBe(true)
  })

  it('closes on in-site navigation', () => {
    parties().click()
    document.dispatchEvent(new Event('astro:page-load'))
    expect(open(parties())).toBe(false)
  })
})
