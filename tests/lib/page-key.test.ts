/**
 * S2-R9a: the host page (/party/<id>?key=) and the payment link
 * (/party/pay/<id>?k=) keep their keys away from GA4, Meta and PostHog.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPrivatePartyPage, rememberedPageKey, PAGE_KEY_SCRIPT } from '@lib/page-key'

const run = () => new Function(PAGE_KEY_SCRIPT)()

beforeEach(() => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

describe('private party pages', () => {
  it('are /party and everything under it, nothing else', () => {
    expect(isPrivatePartyPage('/party/pty_1')).toBe(true)
    expect(isPrivatePartyPage('/party/pay/pty_1')).toBe(true)
    expect(isPrivatePartyPage('/party')).toBe(true)
    expect(isPrivatePartyPage('/parties')).toBe(false)
    expect(isPrivatePartyPage('/book')).toBe(false)
  })
})

describe('PAGE_KEY_SCRIPT', () => {
  it('moves the payment key out of the address bar into this tab', () => {
    history.replaceState(null, '', '/party/pay/pty_1?k=secret-pay#top')
    run()
    expect(location.pathname).toBe('/party/pay/pty_1')
    expect(location.search).toBe('')
    expect(location.hash).toBe('#top')
    expect(rememberedPageKey('/party/pay/pty_1')).toBe('secret-pay')
  })

  it('does the same for the host page key, and a refresh (no key) keeps the remembered one', () => {
    history.replaceState(null, '', '/party/pty_2?key=secret-host')
    run()
    expect(location.search).toBe('')
    run() // a refresh: the address bar has no key now
    expect(rememberedPageKey('/party/pty_2')).toBe('secret-host')
  })

  it('leaves every other page alone', () => {
    history.replaceState(null, '', '/book?package=pkg_test')
    run()
    expect(location.search).toBe('?package=pkg_test')
    expect(rememberedPageKey('/book')).toBe('')
  })

  it('makes a link into a private page a full page load (no in-site page change the analytics would see)', () => {
    run()
    const a = document.createElement('a')
    a.href = '/party/pty_3?key=abc'
    a.textContent = 'Your party page'
    a.addEventListener('click', (e) => e.preventDefault())
    document.body.appendChild(a)
    const other = document.createElement('a')
    other.href = '/workshops'
    other.addEventListener('click', (e) => e.preventDefault())
    document.body.appendChild(other)
    a.click()
    other.click()
    expect(a.hasAttribute('data-astro-reload')).toBe(true)
    expect(other.hasAttribute('data-astro-reload')).toBe(false)
    a.remove(); other.remove()
  })
})

describe('Layout', () => {
  const layout = readFileSync(resolve(__dirname, '../../src/layouts/Layout.astro'), 'utf8')

  it('runs the key script first in <head>, before PostHog and any analytics', () => {
    const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'))
    const script = head.indexOf('set:html={PAGE_KEY_SCRIPT}')
    expect(script).toBeGreaterThan(-1)
    expect(script).toBeLessThan(head.indexOf('<PostHog'))
    expect(script).toBeLessThan(head.indexOf('<SeoHead'))
  })

  it('leaves out GA4 and the Meta Pixel, never records, and keeps the address to this site on /party/*', () => {
    expect(layout).toContain('const privateParty = isPrivatePartyPage(Astro.url.pathname)')
    expect(layout).toMatch(/\{!bare && !privateParty && <Analytics \/>\}/)
    expect(layout).toMatch(/<PostHog noRecording=\{[^}]*privateParty[^}]*\} \/>/)
    expect(layout).toContain('{privateParty && <meta name="referrer" content="same-origin" />}')
    // GA4 and the pixel load only from <Analytics />.
    expect(layout.match(/googletagmanager|meta-pixel/g)).toBeNull()
  })
})
