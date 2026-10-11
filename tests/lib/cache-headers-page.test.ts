import { describe, it, expect } from 'vitest'
import { publicPageHeaders } from '@lib/cache-headers'
import { previewCookieName } from '@lib/bookings-gate'

const req = (cookie = '') => new Request('https://ourhometownstudio.com/workshops', { headers: cookie ? { cookie } : {} })
const url = (q = '') => new URL(`https://ourhometownstudio.com/workshops${q}`)

describe('publicPageHeaders', () => {
  it('lets Netlify keep a copy of the plain page, refreshed behind the scenes', () => {
    const h = publicPageHeaders(req(), url())!
    expect(h['Netlify-CDN-Cache-Control']).toMatch(/durable, max-age=300, stale-while-revalidate=\d+/)
    expect(h['Cache-Control']).toBe('public, max-age=0, must-revalidate')
    expect(h['Netlify-Vary']).toContain(`cookie=${previewCookieName}`)
    expect(h['Netlify-Vary']).toContain('query')
  })

  it('still keeps a copy when only ad or share tags are on the link', () => {
    expect(publicPageHeaders(req(), url('?utm_source=facebook&fbclid=abc'))).not.toBeNull()
  })

  it('never stores a one-class link, the preview link, or a preview browser', () => {
    expect(publicPageHeaders(req(), url('?w=clsschi_abc123'))).toBeNull()
    expect(publicPageHeaders(req(), url('?preview=anything'))).toBeNull()
    expect(publicPageHeaders(req(`a=1; ${previewCookieName}=x`), url())).toBeNull()
  })
})
