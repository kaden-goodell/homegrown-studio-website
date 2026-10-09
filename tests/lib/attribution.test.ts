import { describe, it, expect, beforeEach, vi } from 'vitest'
import { touchFrom, cleanAttribution, captureAttribution, readAttribution } from '@lib/attribution'

const NOW = new Date('2026-10-09T15:00:00Z')
const HOST = 'ourhometownstudio.com'

describe('touchFrom', () => {
  it('reads a campaign link', () => {
    const t = touchFrom('https://ourhometownstudio.com/book?utm_source=flyer&utm_medium=qr&utm_campaign=opening', '', NOW, HOST)!
    expect(t).toMatchObject({ source: 'flyer', medium: 'qr', campaign: 'opening', landing: '/book?utm_source=flyer&utm_medium=qr&utm_campaign=opening' })
  })

  it('calls a Google ad click paid Google, and a Facebook ad click paid Facebook', () => {
    expect(touchFrom('https://ourhometownstudio.com/?gclid=abc', '', NOW, HOST)).toMatchObject({ source: 'google', medium: 'cpc', gclid: 'abc' })
    expect(touchFrom('https://ourhometownstudio.com/?fbclid=xyz', '', NOW, HOST)).toMatchObject({ source: 'facebook', medium: 'cpc', fbclid: 'xyz' })
  })

  it('sorts other sites into search, social and referral', () => {
    expect(touchFrom('https://ourhometownstudio.com/', 'https://www.google.com/search?q=crafts', NOW, HOST)).toMatchObject({ source: 'google.com', medium: 'organic', referrer: 'google.com/search' })
    expect(touchFrom('https://ourhometownstudio.com/', 'https://m.facebook.com/', NOW, HOST)).toMatchObject({ medium: 'social' })
    expect(touchFrom('https://ourhometownstudio.com/', 'https://madisonmoms.org/fall', NOW, HOST)).toMatchObject({ source: 'madisonmoms.org', medium: 'referral' })
  })

  it('ignores moving around our own site and plain reloads', () => {
    expect(touchFrom('https://ourhometownstudio.com/book', 'https://www.ourhometownstudio.com/', NOW, HOST)).toBeNull()
    expect(touchFrom('https://ourhometownstudio.com/book', '', NOW, HOST)).toBeNull()
  })

  it('never keeps the query string of the other site', () => {
    const t = touchFrom('https://ourhometownstudio.com/', 'https://www.google.com/search?q=secret', NOW, HOST)!
    expect(t.referrer).not.toContain('secret')
  })
})

describe('cleanAttribution', () => {
  const touch = { source: 'flyer', medium: 'qr', landing: '/', at: NOW.toISOString() }

  it('keeps a good record and drops unknown fields', () => {
    const a = cleanAttribution({ first: { ...touch, evil: 'x' }, last: touch, visits: 3 })!
    expect(a.visits).toBe(3)
    expect((a.first as any).evil).toBeUndefined()
  })

  it('refuses junk', () => {
    expect(cleanAttribution(null)).toBeNull()
    expect(cleanAttribution('hi')).toBeNull()
    expect(cleanAttribution({ first: { source: 'x' } })).toBeNull()
  })

  it('cuts long values and fixes a bad visit count', () => {
    const a = cleanAttribution({ first: { ...touch, source: 'x'.repeat(500) }, visits: -4 })!
    expect(a.first.source.length).toBe(80)
    expect(a.last).toEqual(a.first)
    expect(a.visits).toBe(1)
  })
})

describe('captureAttribution', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    })
  })

  it('remembers the first visit as direct when nothing says otherwise', () => {
    captureAttribution()
    expect(readAttribution()).toMatchObject({ first: { source: 'direct', medium: 'none' }, visits: 1 })
  })

  it('keeps the first touch but updates the last one', () => {
    const old = { source: 'flyer', medium: 'qr', landing: '/', at: new Date().toISOString() }
    localStorage.setItem('hs_attribution', JSON.stringify({ first: old, last: old, visits: 1 }))
    history.replaceState(null, '', '/book?utm_source=instagram&utm_medium=social')
    captureAttribution()
    const a = readAttribution()!
    expect(a.first.source).toBe('flyer')
    expect(a.last.source).toBe('instagram')
    expect(a.visits).toBe(2)
    history.replaceState(null, '', '/')
  })

  it('forgets a visitor after 90 days', () => {
    const old = { source: 'flyer', medium: 'qr', landing: '/', at: '2020-01-01T00:00:00Z' }
    localStorage.setItem('hs_attribution', JSON.stringify({ first: old, last: old, visits: 1 }))
    expect(readAttribution()).toBeNull()
  })
})
