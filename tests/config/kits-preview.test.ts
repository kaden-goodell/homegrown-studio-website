// tests/config/kits-preview.test.ts — kits show on a namespaced sandbox preview only, never on production.
import { describe, it, expect } from 'vitest'
import { kitsEnabledFor } from '@config/kits-preview'

const preview = { KITS_ENABLED_PREVIEW: 'on', STORE_NAMESPACE: 'preview', SQUARE_ENVIRONMENT: 'sandbox' }

describe('kitsEnabledFor', () => {
  it('turns kits on for a namespaced sandbox preview with KITS_ENABLED_PREVIEW=on', () => {
    expect(kitsEnabledFor(false, preview)).toBe(true)
    expect(kitsEnabledFor(false, { ...preview, KITS_ENABLED_PREVIEW: ' ON ' })).toBe(true)
  })

  it('never on production: the live Square, no namespace, or CONTEXT=production', () => {
    expect(kitsEnabledFor(false, { ...preview, SQUARE_ENVIRONMENT: 'production' })).toBe(false)
    expect(kitsEnabledFor(false, { ...preview, STORE_NAMESPACE: '' })).toBe(false)
    expect(kitsEnabledFor(false, { ...preview, STORE_NAMESPACE: undefined })).toBe(false)
    expect(kitsEnabledFor(false, { ...preview, CONTEXT: 'production' })).toBe(false)
    // What production actually has: the flag set by mistake changes nothing.
    expect(kitsEnabledFor(false, { KITS_ENABLED_PREVIEW: 'on', SQUARE_ENVIRONMENT: 'production', CONTEXT: 'production' })).toBe(false)
  })

  it('needs the switch itself', () => {
    expect(kitsEnabledFor(false, { ...preview, KITS_ENABLED_PREVIEW: undefined })).toBe(false)
    expect(kitsEnabledFor(false, { ...preview, KITS_ENABLED_PREVIEW: 'true' })).toBe(false)
    expect(kitsEnabledFor(false, { ...preview, KITS_ENABLED_PREVIEW: 'off' })).toBe(false)
  })

  it('no env (the browser) keeps the config value', () => {
    expect(kitsEnabledFor(false, undefined)).toBe(false)
    expect(kitsEnabledFor(true, undefined)).toBe(true)
  })
})
