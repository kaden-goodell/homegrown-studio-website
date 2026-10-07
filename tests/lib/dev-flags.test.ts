import { describe, it, expect, vi, afterEach } from 'vitest'

let allowed = false
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => allowed }))

import { bypassDecision, paymentBypassEnabled } from '@lib/dev-flags'

describe('bypassDecision (the rule)', () => {
  it('needs the flag AND a preview or dev runtime', () => {
    expect(bypassDecision({ flag: 'true', simulatedAllowed: true })).toBe(true)
    expect(bypassDecision({ flag: 'true', simulatedAllowed: false })).toBe(false)
    expect(bypassDecision({ flag: undefined, simulatedAllowed: true })).toBe(false)
    expect(bypassDecision({ flag: 'false', simulatedAllowed: true })).toBe(false)
  })
})

describe('paymentBypassEnabled', () => {
  const saved = process.env.DEV_BYPASS_PAYMENT
  afterEach(() => {
    if (saved === undefined) delete process.env.DEV_BYPASS_PAYMENT
    else process.env.DEV_BYPASS_PAYMENT = saved
  })

  it('is on when the flag is set on a preview or dev', () => {
    process.env.DEV_BYPASS_PAYMENT = 'true'
    allowed = true
    expect(paymentBypassEnabled()).toBe(true)
  })
  it('is off in production or an unknown runtime, even with the flag', () => {
    process.env.DEV_BYPASS_PAYMENT = 'true'
    allowed = false
    expect(paymentBypassEnabled()).toBe(false)
  })
  it('is off without the flag', () => {
    delete process.env.DEV_BYPASS_PAYMENT
    allowed = true
    expect(paymentBypassEnabled()).toBe(false)
  })
})
