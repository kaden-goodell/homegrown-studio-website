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
