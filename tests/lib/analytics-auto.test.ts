import { describe, it, expect } from 'vitest'
import { whereOf, contactMethod } from '@lib/analytics-auto'

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
