/** More › Activity: Craft Café check-ins and Undo read in plain words. */
import { describe, it, expect } from 'vitest'
import { activityWhat } from '@lib/activity'

describe('Activity lines for Craft Café', () => {
  it('check-in, Undo, a started waiver and a removed waiting family', () => {
    expect(activityWhat({ action: 'checkin.here', target: { kind: 'household', id: 'w1', label: 'Jane Doe' }, details: { where: 'craft-cafe', people: 3 } })).toBe('Checked Jane Doe in at Craft Café (3 people)')
    expect(activityWhat({ action: 'checkin.undone', target: { kind: 'household', id: 'w1', label: 'Jane Doe' }, details: { where: 'craft-cafe', people: 3 } })).toBe('Took Jane Doe off the Craft Café list (Undo)')
    expect(activityWhat({ action: 'waiver.started', target: { kind: 'craft-cafe-waiting', id: 'cw_1', label: 'Kim' }, details: { where: 'craft-cafe', how: 'qr' } })).toBe('Started Kim on a waiver at Craft Café (QR code)')
    expect(activityWhat({ action: 'waiver.waiting-removed', target: { kind: 'craft-cafe-waiting', id: 'cw_1', label: 'Kim' }, details: {} })).toBe('Took Kim off “Waiting on a waiver”')
  })

  it('a check-in at an event reads as before', () => {
    expect(activityWhat({ action: 'checkin.here', target: { kind: 'household', id: 'w1', label: 'Jane Doe' }, details: {} })).toBe('Checkin here: Jane Doe')
  })
})

describe('Activity lines for Craft Café texts and overrides', () => {
  it('a text that went, one that didn’t, and a retry', () => {
    const t = (details: Record<string, unknown>) => activityWhat({ action: 'waiver-link.sent', target: { kind: 'craft-cafe-waiting', id: 'cw_1', label: 'Kim' }, details: { where: 'craft-cafe', how: 'text', ...details } })
    expect(t({ sent: true })).toBe('Texted Kim the waiver link for Craft Café')
    expect(t({ sent: false })).toBe('Tried to text Kim the waiver link for Craft Café (it didn’t send)')
    expect(t({ sent: true, retry: true })).toBe('Texted Kim the waiver link for Craft Café (again, the first text didn’t send)')
    expect(activityWhat({ action: 'waiver-link.sent', target: { kind: 'household', id: 'w1', label: 'Jane' }, details: {} })).toBe('Waiver link sent: Jane')
  })

  it('“Mark here anyway” at Craft Café says so', () => {
    expect(activityWhat({ action: 'checkin.here', target: { kind: 'household', id: 'w1', label: 'Jane Doe' }, details: { where: 'craft-cafe', people: 1, anyway: true } }))
      .toBe('Checked Jane Doe in at Craft Café (1 person), anyway: their waiver needs signing again')
  })
})
