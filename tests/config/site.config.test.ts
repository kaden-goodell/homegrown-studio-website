import { describe, it, expect } from 'vitest'
import { siteConfig, validateConfig } from '@config/site.config'

describe('site config', () => {
  it('has required identity fields', () => {
    expect(siteConfig.name).toBe('Homegrown Craft Studio')
    expect(siteConfig.contactEmail).toBeTruthy()
    expect(siteConfig.contactPhone).toBeTruthy()
  })

  it('has theme with all required color keys', () => {
    const requiredColors = ['primary', 'secondary', 'accent', 'background', 'text', 'muted']
    for (const key of requiredColors) {
      expect(siteConfig.theme.colors).toHaveProperty(key)
      expect(siteConfig.theme.colors[key as keyof typeof siteConfig.theme.colors]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('has feature toggles', () => {
    expect(typeof siteConfig.features.workshops).toBe('boolean')
    expect(typeof siteConfig.features.newsletter).toBe('boolean')
    expect(typeof siteConfig.features.gallery).toBe('boolean')
    expect(typeof siteConfig.features.coupons).toBe('boolean')
    expect(typeof siteConfig.features.parties.enabled).toBe('boolean')
  })

  it('has at least one event type configured', () => {
    expect(siteConfig.eventTypes.length).toBeGreaterThan(0)
  })

  it('each event type has required fields', () => {
    for (const et of siteConfig.eventTypes) {
      expect(et.id).toBeTruthy()
      expect(et.name).toBeTruthy()
      expect(['booking', 'quote']).toContain(et.flow)
      expect(et.duration).toBeGreaterThan(0)
    }
  })

  it('validates a valid config', () => {
    expect(() => validateConfig(siteConfig)).not.toThrow()
  })

  it('rejects config missing name', () => {
    const bad = { ...siteConfig, name: '' }
    expect(() => validateConfig(bad)).toThrow('name is required')
  })
})
