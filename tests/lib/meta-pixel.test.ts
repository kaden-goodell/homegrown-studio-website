import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('meta pixel', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs() })

  it('runs only on the live site, never on waiver or staff pages', async () => {
    vi.stubEnv('PUBLIC_META_PIXEL_ID', '123456789012345')
    const { metaPixelAllowed } = await import('@lib/meta-pixel')
    expect(metaPixelAllowed('ourhometownstudio.com', '/')).toBe(true)
    expect(metaPixelAllowed('www.ourhometownstudio.com', '/workshops')).toBe(true)
    expect(metaPixelAllowed('dev--iridescent-croissant-494fc3.netlify.app', '/')).toBe(false)
    expect(metaPixelAllowed('localhost', '/')).toBe(false)
    expect(metaPixelAllowed('ourhometownstudio.com', '/waiver')).toBe(false)
    expect(metaPixelAllowed('ourhometownstudio.com', '/waiver/abc')).toBe(false)
    expect(metaPixelAllowed('ourhometownstudio.com', '/staff')).toBe(false)
    expect(metaPixelAllowed('ourhometownstudio.com', '/staffing-news')).toBe(true)
  })

  it('stays off with no pixel id', async () => {
    vi.stubEnv('PUBLIC_META_PIXEL_ID', '')
    const { metaPixelAllowed } = await import('@lib/meta-pixel')
    expect(metaPixelAllowed('ourhometownstudio.com', '/')).toBe(false)
  })

  it('maps our events to Meta standard events', async () => {
    const { toMetaEvent } = await import('@lib/meta-pixel')
    expect(toMetaEvent('view_item', { value: 40, items: [] })).toEqual(['ViewContent', { value: 40, currency: 'USD' }])
    expect(toMetaEvent('begin_checkout', { value: 80 })).toEqual(['InitiateCheckout', { value: 80, currency: 'USD' }])
    expect(toMetaEvent('notify_me_signup', { interest: 'x' })).toEqual(['Lead', {}])
    expect(toMetaEvent('nav_click', {})).toBeNull()
  })
})

describe('party host pages stay private', () => {
  it('the pixel never runs on a party host page (its address carries the host key)', async () => {
    vi.resetModules()
    vi.stubEnv('PUBLIC_META_PIXEL_ID', '123456789012345')
    const { metaPixelAllowed } = await import('@lib/meta-pixel')
    expect(metaPixelAllowed('ourhometownstudio.com', '/parties')).toBe(true)
    expect(metaPixelAllowed('ourhometownstudio.com', '/party/abc123')).toBe(false)
  })

  it('the party host page turns analytics off and the layout honours it', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/pages/party/[id].astro', 'utf8')
    const layout = readFileSync('src/layouts/Layout.astro', 'utf8')
    expect(page).toMatch(/<Layout[^>]*\bnoAnalytics\b/)
    expect(layout).toContain('{!noAnalytics && <PostHog')
    expect(layout).toContain('!noAnalytics && <Analytics />')
    expect(layout).toContain('<meta name="referrer" content="same-origin" />')
  })
})

describe('links that carry a party host key', () => {
  it('are never recorded by PostHog click capture', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/components/party/PartyModal.tsx', 'utf8')).toContain('<a href={hostPageUrl} className="btn btn-primary ph-no-capture">')
    expect(readFileSync('src/components/party/RecentPartyBanner.tsx', 'utf8')).toMatch(/href=\{hostPartyUrl\([^)]*\)\}\s*className="ph-no-capture"/)
  })
})
