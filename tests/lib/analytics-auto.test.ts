import { describe, it, expect, vi } from 'vitest'
import { whereOf, contactMethod, parseTrackProps, autoEventFor } from '@lib/analytics-auto'

describe('contactMethod', () => {
  it('tells calls, texts, emails and directions apart', () => {
    expect(contactMethod('tel:+12565550100')).toBe('phone')
    expect(contactMethod('sms:+12565550100')).toBe('text')
    expect(contactMethod('MAILTO:hi@ourhometownstudio.com')).toBe('email')
    expect(contactMethod('https://maps.app.goo.gl/abc')).toBe('directions')
    expect(contactMethod('https://www.google.com/maps/place/525+Hughes')).toBe('directions')
    expect(contactMethod('https://maps.apple.com/?q=Hometown')).toBe('directions')
    expect(contactMethod('/book')).toBeNull()
  })
})

describe('whereOf', () => {
  function place(html: string) {
    document.body.innerHTML = html
    return document.getElementById('t')!
  }

  it('names the page and the part of it', () => {
    expect(whereOf(place('<header><a id="t">x</a></header>'), '/')).toBe('home/header')
    expect(whereOf(place('<footer><a id="t">x</a></footer>'), '/book')).toBe('book/footer')
    expect(whereOf(place('<div role="dialog"><a id="t">x</a></div>'), '/book')).toBe('book/dialog')
    expect(whereOf(place('<section><h2>The Craft Menu</h2><a id="t">x</a></section>'), '/craft-cafe')).toBe('craft-cafe/the-craft-menu')
  })

  it('prefers an explicit marker', () => {
    expect(whereOf(place('<section data-track-where="hero"><h2>Hi</h2><a id="t">x</a></section>'), '/')).toBe('home/hero')
  })
})

describe('parseTrackProps', () => {
  it('keeps short plain values and drops the rest', () => {
    expect(parseTrackProps('{"source":"invite","n":2,"ok":true,"obj":{"a":1},"Bad-Key":"x"}')).toEqual({ source: 'invite', n: 2, ok: true })
    expect(parseTrackProps('{"s":"' + 'x'.repeat(150) + '"}').s).toHaveLength(100)
  })

  it('never throws on bad markup', () => {
    expect(parseTrackProps('not json')).toEqual({})
    expect(parseTrackProps('[1,2]')).toEqual({})
    expect(parseTrackProps(undefined)).toEqual({})
  })
})

describe('autoEventFor', () => {
  function place(html: string) {
    document.body.innerHTML = html
    return document.getElementById('t')!
  }

  it('skips anything inside data-track-ignore (a host emailing guests is not a lead)', () => {
    expect(autoEventFor(place('<a id="t" href="mailto:a@b.co" data-track-ignore>Email</a>'), '/party')).toBeNull()
    expect(autoEventFor(place('<div data-track-ignore><a id="t" href="/book">Book</a></div>'), '/')).toBeNull()
  })

  it('reports a contact link as a lead', () => {
    expect(autoEventFor(place('<footer><a id="t" href="tel:+12565550100">Call</a></footer>'), '/')).toEqual({ kind: 'contact', method: 'phone', where: 'home/footer' })
  })

  it('reports one cta for a booking button, with its own label and place', () => {
    const el = place('<div data-track-where="sticky_bar"><button id="t" data-track-cta="party_book_button">Book your date</button></div>')
    expect(autoEventFor(el, '/book')).toEqual({ kind: 'cta', label: 'party_book_button', where: 'book/sticky_bar' })
    expect(autoEventFor(place('<section><h2>Hi</h2><a id="t" href="/book" data-open-booking>Book your date</a></section>'), '/book')).toEqual({
      kind: 'cta', label: 'Book your date', where: 'book/hi', href: '/book',
    })
  })

  it('reports a markup-declared event with its props', () => {
    const el = place(`<a href="https://calendar.google.com/x" data-track-event="add_to_calendar" data-track-props='{"source":"invite","type":"google"}'><span id="t">Google</span></a>`)
    expect(autoEventFor(el, '/invite')).toEqual({ kind: 'markup', event: 'add_to_calendar', props: { source: 'invite', type: 'google' } })
  })

  it('reports in-site header/footer menu links as navigation', () => {
    expect(autoEventFor(place('<header><nav><a id="t" href="/workshops">Workshops</a></nav></header>'), '/')).toEqual({
      kind: 'nav', label: 'Workshops', where: 'home/header', href: '/workshops',
    })
    // The header's book link stays a call-to-action, and links outside a menu aren't navigation.
    expect(autoEventFor(place('<header><nav><a id="t" href="/book">Book a Party</a></nav></header>'), '/')?.kind).toBe('cta')
    expect(autoEventFor(place('<section><a id="t" href="/workshops">x</a></section>'), '/')).toBeNull()
    expect(autoEventFor(place('<footer><nav><a id="t" href="https://instagram.com/x">IG</a></nav></footer>'), '/')).toBeNull()
  })

  it('reports the phone menu opening, not closing', () => {
    expect(autoEventFor(place('<button id="menu-button" aria-expanded="false"><span id="t"></span></button>'), '/')).toEqual({ kind: 'menu_open' })
    expect(autoEventFor(place('<button id="menu-button" aria-expanded="true"><span id="t"></span></button>'), '/')).toBeNull()
  })
})

describe('page-wide listeners', () => {
  it('reports a FAQ answer opened, once per open', () => {
    const capture = vi.fn()
    window.posthog = { capture } as unknown as Window['posthog']
    document.body.innerHTML = '<details id="t" data-track-faq="Can I bring food?"><summary>Can I bring food?</summary>Yes</details>'
    const el = document.getElementById('t') as HTMLDetailsElement
    el.open = true
    el.dispatchEvent(new Event('toggle'))
    el.open = false
    el.dispatchEvent(new Event('toggle'))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('faq_open', { question: 'Can I bring food?', where: 'home/page' })
    delete window.posthog
  })
})
