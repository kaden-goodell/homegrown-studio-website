import { describe, it, expect } from 'vitest'
import { withUtm } from '@lib/utm'

describe('withUtm', () => {
  const tag = { source: 'email', medium: 'email' as const, campaign: 'signup_news' }
  it('adds tags to a bare link and to one with a query', () => {
    expect(withUtm('https://x.com/book', tag)).toBe('https://x.com/book?utm_source=email&utm_medium=email&utm_campaign=signup_news')
    expect(withUtm('https://x.com/book?date=2026-10-24', tag)).toBe('https://x.com/book?date=2026-10-24&utm_source=email&utm_medium=email&utm_campaign=signup_news')
  })
  it('keeps a #section at the end', () => {
    expect(withUtm('https://x.com/policies#refunds', tag)).toBe('https://x.com/policies?utm_source=email&utm_medium=email&utm_campaign=signup_news#refunds')
  })
})
