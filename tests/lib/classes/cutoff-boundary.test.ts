// Review (16 Nov 2026): sign-ups close at exactly the cutoff second, not a second later.
import { describe, it, expect } from 'vitest'
import { cutoffRefusal } from '@lib/classes/checkout'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

const START = '2026-12-05T01:00:00.000Z' // Fri Dec 4, 7 PM Central
function cls(hours: number | null, joinPartway = true): ScheduledClass {
  return {
    id: 'cls_cut', libraryId: null, libraryVersion: null,
    content: {
      name: 'Cutoff', description: '', imageUrl: null, instructor: null, rules: { ...defaultRules(), signupCutoffHours: hours, joinPartway },
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 120,
    },
    sessions: [
      { id: 's1', startIso: START, endIso: '2026-12-05T03:00:00.000Z', capacity: 10 },
      { id: 's2', startIso: '2026-12-12T01:00:00.000Z', endIso: '2026-12-12T03:00:00.000Z', capacity: 10 },
    ],
    status: 'open', square: null, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
  } as unknown as ScheduledClass
}
const at = (ms: number) => new Date(Date.parse(START) + ms)

describe('sign-up cutoff to the second', () => {
  it('24 hours: open one second before, closed at the exact second', () => {
    const c = cls(24)
    expect(cutoffRefusal(c, ['s1'], at(-24 * 3_600_000 - 1000))).toBeNull()
    expect(cutoffRefusal(c, ['s1'], at(-24 * 3_600_000))).not.toBeNull()
  })
  it('0 hours (the default with no questions): open until the start, closed at it', () => {
    const c = cls(null)
    expect(cutoffRefusal(c, ['s1'], at(-1000))).toBeNull()
    expect(cutoffRefusal(c, ['s1'], at(0))).not.toBeNull()
  })
  it('a class that can’t be joined partway closes as a whole from its first session', () => {
    const c = cls(0, false)
    expect(cutoffRefusal(c, ['s2'], at(0))).not.toBeNull()
    expect(cutoffRefusal(cls(0, true), ['s2'], at(0))).toBeNull()
  })
})
