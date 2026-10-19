import { describe, it, expect } from 'vitest'
import { blobStoreName } from '@lib/blob-store'

describe('blobStoreName', () => {
  it('uses the live store name when no namespace is set', () => {
    expect(blobStoreName('waivers', {})).toBe('waivers')
    expect(blobStoreName('waivers', { NETLIFY: 'true', SQUARE_ENVIRONMENT: 'production' })).toBe('waivers')
  })
  it('keeps a preview branch in its own stores', () => {
    expect(blobStoreName('waivers', { STORE_NAMESPACE: 'preview', NETLIFY: 'true', SQUARE_ENVIRONMENT: 'sandbox' })).toBe('preview-waivers')
  })
  it('refuses live stores for a sandbox deploy on Netlify', () => {
    expect(() => blobStoreName('waivers', { NETLIFY: 'true', SQUARE_ENVIRONMENT: 'sandbox' })).toThrow(/sandbox/)
  })
  it('allows sandbox off Netlify (local dev keeps its own files)', () => {
    expect(blobStoreName('waivers', { SQUARE_ENVIRONMENT: 'sandbox' })).toBe('waivers')
  })
  it('refuses a namespace with odd characters', () => {
    expect(() => blobStoreName('waivers', { STORE_NAMESPACE: 'Preview!' })).toThrow()
  })
})
