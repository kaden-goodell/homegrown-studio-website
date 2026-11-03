/** D7 (Kaden 2 Nov): the waitlist closes 48 hours before the class starts, never inside the no-refund window. */
import { describe, expect, it } from 'vitest'
import { WAITLIST_CLOSE_HOURS, waitlistClosesIso, waitlistCutoffHours, waitlistOpen } from '@lib/classes/waitlist-rules'
import { defaultRules } from '@lib/classes/validate'
import { policyWindows } from '@config/policy-content'
import { consentText } from '@lib/classes/waitlist-words'

const cls = (waitlistCutoffHours?: number) => ({
  id: 'c', status: 'open',
  content: { questions: [], rules: { ...defaultRules(), ...(waitlistCutoffHours === undefined ? {} : { waitlistCutoffHours }) } },
  sessions: [{ id: 's1', startIso: '2026-11-14T16:00:00.000Z', endIso: '2026-11-14T18:00:00.000Z', capacity: 8 }],
}) as any

describe('waitlist closes 48 hours before the class (D7)', () => {
  it('is the no-refund window by default, and an older class saved with 2 hours still closes at 48', () => {
    expect(WAITLIST_CLOSE_HOURS).toBe(policyWindows.workshopRefundHours)
    expect(defaultRules().waitlistCutoffHours).toBe(48)
    expect(waitlistCutoffHours(cls())).toBe(48)
    expect(waitlistCutoffHours(cls(2))).toBe(48)
    expect(waitlistCutoffHours(cls(72))).toBe(72)
    expect(waitlistClosesIso(cls(2), ['s1'])).toBe('2026-11-12T16:00:00.000Z')
  })
  it('open until then, closed after (a freed seat is then anyone’s)', () => {
    expect(waitlistOpen(cls(2), ['s1'], new Date('2026-11-12T15:59:00.000Z'))).toBe(true)
    expect(waitlistOpen(cls(2), ['s1'], new Date('2026-11-12T16:00:00.000Z'))).toBe(false)
  })
  it('the consent sentence says why it closes then', () => {
    expect(consentText({ className: 'Looms', startIso: '2026-11-14T16:00:00.000Z', closesIso: '2026-11-12T16:00:00.000Z', maxCents: 2180 }))
      .toMatch(/never charged inside the 48-hour no-refund window/)
  })
})
