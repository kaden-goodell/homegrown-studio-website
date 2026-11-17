// Background money problems in the own booking system text Kaden only, and only from the live site.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { alarmKaden, alarmFixed, alarmDeps } from '@lib/kaden-alarm'
import { ALERT_PHONE_DEFAULT } from '@config/alerts'

const raised = vi.fn(async () => true)
const fixed = vi.fn(async () => true)
let live = true
const saved = { ...alarmDeps }
beforeEach(() => {
  raised.mockClear(); fixed.mockClear(); live = true
  alarmDeps.raiseIncident = raised as any
  alarmDeps.resolveIncident = fixed as any
  alarmDeps.liveSiteHere = () => live
})
afterEach(() => Object.assign(alarmDeps, saved))

describe('alarmKaden', () => {
  it('on the live site: one urgent incident that waits for Got it (never closes by itself unless asked)', async () => {
    expect(await alarmKaden('money:waitlist:e1:1', 'WAITLIST CHARGE UNCLEAR: …')).toBe(true)
    expect(raised).toHaveBeenCalledWith({ key: 'money:waitlist:e1:1', text: 'WAITLIST CHARGE UNCLEAR: …', urgent: true, autoResolve: false })
  })
  it('previews, branch deploys and local runs stay quiet', async () => {
    live = false
    expect(await alarmKaden('k', 't')).toBe(false)
    await alarmFixed('k', 'Fixed')
    expect(raised).not.toHaveBeenCalled()
    expect(fixed).not.toHaveBeenCalled()
  })
  it('never throws', async () => {
    alarmDeps.raiseIncident = (async () => { throw new Error('store down') }) as any
    await expect(alarmKaden('k', 't')).resolves.toBe(false)
  })
  it('goes to Kaden’s number, never the owners list', () => {
    expect(ALERT_PHONE_DEFAULT.replace(/\D/g, '')).toMatch(/4029802907$/)
  })
})
