import { describe, it, expect, afterEach } from 'vitest'
import { bypassDecision, paymentBypassEnabled } from '@lib/dev-flags'

describe('bypassDecision (the rule)', () => {
  it('is on for a Netlify branch deploy', () => {
    expect(bypassDecision({ flag: 'true', context: 'branch-deploy', dev: false })).toBe(true)
  })
  it('is on for a Netlify deploy preview', () => {
    expect(bypassDecision({ flag: 'true', context: 'deploy-preview', dev: false })).toBe(true)
  })
  it('is on under the local dev server', () => {
    expect(bypassDecision({ flag: 'true', dev: true })).toBe(true)
  })
  it('is never on in production, even with the variable set', () => {
    expect(bypassDecision({ flag: 'true', context: 'production', dev: false })).toBe(false)
    expect(bypassDecision({ flag: 'true', context: 'production', dev: true })).toBe(false)
  })
  it('is off in an unknown runtime (no CONTEXT, not dev)', () => {
    expect(bypassDecision({ flag: 'true', dev: false })).toBe(false)
  })
  it('is off without the variable, whatever the context', () => {
    expect(bypassDecision({ context: 'branch-deploy', dev: false })).toBe(false)
    expect(bypassDecision({ flag: 'false', context: 'branch-deploy', dev: true })).toBe(false)
  })
})

describe('paymentBypassEnabled (reads process.env)', () => {
  const saved = { flag: process.env.DEV_BYPASS_PAYMENT, context: process.env.CONTEXT }
  afterEach(() => {
    for (const [k, v] of [['DEV_BYPASS_PAYMENT', saved.flag], ['CONTEXT', saved.context]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('follows the process environment on a branch deploy', () => {
    process.env.DEV_BYPASS_PAYMENT = 'true'
    process.env.CONTEXT = 'branch-deploy'
    expect(paymentBypassEnabled()).toBe(true)
  })
  it('stays off in production', () => {
    process.env.DEV_BYPASS_PAYMENT = 'true'
    process.env.CONTEXT = 'production'
    expect(paymentBypassEnabled()).toBe(false)
  })
  it('stays off when the variable is unset', () => {
    delete process.env.DEV_BYPASS_PAYMENT
    process.env.CONTEXT = 'branch-deploy'
    expect(paymentBypassEnabled()).toBe(false)
  })
})
