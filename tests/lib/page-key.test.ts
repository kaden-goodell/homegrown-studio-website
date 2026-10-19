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

describe('PostHog key scrubber (window.__hsScrubKeys)', () => {
  it('drops key= and k= from every URL and clicked href in an event, keeping everything else', () => {
    run()
    const scrub = (window as any).__hsScrubKeys
    const ev = scrub({
      event: '$autocapture',
      properties: {
        $current_url: 'https://ourhometownstudio.com/book?package=pkg_test&key=abc#x',
        $referrer: 'https://ourhometownstudio.com/party/pty_1?key=host123',
        $elements: [{ tag_name: 'a', attr__href: '/party/pty_1?key=host123', attr__class: 'btn' }],
        $elements_chain: 'a.btn:attr__href="/party/pay/pty_1?k=pay456"nth-child="1"',
        other: '/workshops?w=abc&k=zzz&y=2',
        n: 4,
      },
    })
    expect(ev.properties.$current_url).toBe('https://ourhometownstudio.com/book?package=pkg_test#x')
    expect(ev.properties.$referrer).toBe('https://ourhometownstudio.com/party/pty_1')
    expect(ev.properties.$elements[0].attr__href).toBe('/party/pty_1')
    expect(ev.properties.$elements_chain).toBe('a.btn:attr__href="/party/pay/pty_1"nth-child="1"')
    expect(ev.properties.other).toBe('/workshops?w=abc&y=2')
    expect(ev.properties.n).toBe(4)
    expect(JSON.stringify(ev)).not.toMatch(/host123|pay456|zzz/)
  })

  it('PostHog runs it on every event', () => {
    const ph = readFileSync(resolve(__dirname, '../../src/components/posthog.astro'), 'utf8')
    expect(ph).toMatch(/before_send: function \(event\) \{ return window\.__hsScrubKeys \? window\.__hsScrubKeys\(event\) : event \}/)
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
