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
